import {
    Node, Label, Graphics, UITransform, Color, Button, Sprite, view, screen, ResolutionPolicy,
    EventTouch,
} from 'cc';
import { TileSuit, SUIT_BG_COLORS } from '../core/TileDefine';
import { Tile } from '../core/Tile';
import { playButtonClick } from '../audio/Sound';

/**
 * UI工厂 - 程序化创建 UI 节点,无需预制体/美术资源
 *
 * 渲染方案: 使用 Graphics 组件绘制矢量麻将牌。
 * 利用 Cocos Graphics 的 path 提交机制(fill/stroke 提交当前路径,
 * 下一个 roundRect/circle/ellipse 经由 moveTo 开启新路径),
 * 在单个 Graphics 内叠加多层不同颜色的形状。
 *
 * 自家牌使用正面立体牌面(俯视可见牌身顶面 + 凹槽 + 薄顶侧厚度):
 *   ┌─────────────────────┐ ← 牌身顶面(奶白)
 *   │   ┌───────────┐     │ ← 凹槽外沿阴影(内陷暗边)
 *   │   │  图案/文字 │     │ ← 凹槽内牌面(略深,刻入感)
 *   │   └───────────┘     │
 *   └─────────────────────┘
 * 其他三家(上家/左右家)一律使用平面渲染(圆角矩形),不带立体效果。
 */

/** 颜色明暗调整,clamped 到 0~255 */
function adjust(c: Color, delta: number): Color {
    return new Color(
        Math.max(0, Math.min(255, c.r + delta)),
        Math.max(0, Math.min(255, c.g + delta)),
        Math.max(0, Math.min(255, c.b + delta)),
        c.a,
    );
}

/** 侧面内沿高光(米白偏亮) */
const SIDE_RIM_COLOR = new Color(244, 233, 205, 255);

/** 自适应圆角 */
function fitRadius(w: number, h: number, r: number): number {
    return Math.max(1, Math.min(r, Math.min(w, h) / 3));
}

/** 凹槽内缩量(各花色牌身共用) */
function getInset(w: number, h: number): number {
    return Math.max(2, Math.round(Math.min(w, h) * 0.08));
}

/** 正面视角露出的顶侧厚度(薄,避免整张牌错位造成"两层"观感) */
export function getFrontBand(w: number, h: number): number {
    return Math.max(2, Math.round(w * 0.1));
}

/** 立方贝塞尔近似 90° 圆弧的系数 */
const QUARTER_ARC_K = 0.5522847498307936;

/** 从当前点画一段 90° 圆弧(cw=false 逆时针, cw=true 顺时针) */
function quarterArc(
    g: Graphics,
    cx: number,
    cy: number,
    r: number,
    a0: number,
    cw = false,
): void {
    const s = cw ? -1 : 1;
    const a1 = a0 + (s * Math.PI) / 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const x0 = cx + r * c0;
    const y0 = cy + r * s0;
    const x1 = cx + r * c1;
    const y1 = cy + r * s1;
    const k = r * QUARTER_ARC_K;
    // 逆时针切向量
    const t0x = -s0;
    const t0y = c0;
    const t1x = -s1;
    const t1y = c1;
    g.bezierCurveTo(
        x0 + s * k * t0x, y0 + s * k * t0y,
        x1 - s * k * t1x, y1 - s * k * t1y,
        x1, y1,
    );
}

/** 按逆时针描一个圆角矩形路径(dx/dy 为整体偏移) */
function traceRoundRect(g: Graphics, w: number, h: number, r: number, dx = 0, dy = 0): void {
    const left = -w / 2 + dx;
    const right = w / 2 + dx;
    const top = h / 2 + dy;
    const bottom = -h / 2 + dy;
    g.moveTo(left, bottom + r);
    quarterArc(g, left + r, bottom + r, r, Math.PI);           // 左下角 → 底边
    g.lineTo(right - r, bottom);
    quarterArc(g, right - r, bottom + r, r, Math.PI * 1.5);    // 右下角 → 右边
    g.lineTo(right, top - r);
    quarterArc(g, right - r, top - r, r, 0);                   // 右上角 → 顶边
    g.lineTo(left + r, top);
    quarterArc(g, left + r, top - r, r, Math.PI / 2);          // 左上角 → 左边
    g.close();
}

/**
 * 绘制侧面挤出环: 外轮廓 = 背面按 (dx,dy) 错位, 内轮廓 = 正面。
 * 填充后中心会被随后的正面盖住, 露出的正是围绕正面的连续侧面
 * (含圆角), 不会像旧版那样整张牌错位叠成"两层"。
 */
function drawSideRing(g: Graphics, w: number, h: number, dx: number, dy: number, r: number, color: Color): void {
    g.fillColor = color;
    traceRoundRect(g, w, h, r, dx, dy);
    traceRoundRect(g, w, h, r, 0, 0);
    g.fill();
}

/**
 * 绘制自家的正面立体牌面(牌身3D + 凹槽嵌入,正面略俯视: 可见正面 + 顶侧面)
 * 其他三家一律用 drawTileFaceFlat 绘制平面牌面,不带立体效果。
 * 层次: 落地阴影 → 顶侧面(独立面) → 顶面 → 顶面渐变/倒角高光
 *       → 凹槽外沿阴影(左上暗) → 凹槽底面 → 凹槽内沿明暗
 */
function drawTileFace3D(
    g: Graphics,
    width: number,
    height: number,
    base: Color,
    radius = 6,
): void {
    g.clear();
    const w = width;
    const h = height;
    const r = fitRadius(w, h, radius);
    const inset = getInset(w, h);
    const faceW = w - inset * 2;
    const faceH = h - inset * 2;
    const faceR = Math.max(1, r - inset);

    const band = getFrontBand(w, h);
    // 1. 落地阴影(底部,柔和,只作投影不露底面)
    g.fillColor = new Color(0, 0, 0, 55);
    g.roundRect(-w / 2 + 2, -h / 2 - 4, w, h + 4, r);
    g.fill();

    // 2. 顶侧面(薄薄一条: 背面向上错位 band, 正面盖住中心)
    drawSideRing(g, w, h, 0, band, r, SIDE_RIM_COLOR);
    // 顶侧面最上沿高光
    g.fillColor = new Color(255, 255, 255, 85);
    g.roundRect(-w / 2 + 1.5, h / 2 + band - 2, w - 3, 1.5, 1);
    g.fill();

    // 3. 顶面(主色 + 深色描边,勾勒牌身轮廓)
    g.fillColor = base;
    g.strokeColor = adjust(base, -100);
    g.lineWidth = 2;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();
    g.stroke();

    // 4. 顶面明暗渐变(上亮下暗,模拟顶面受光)
    g.fillColor = new Color(255, 255, 255, 30);
    g.roundRect(-w / 2 + 2, h / 2 - h * 0.38, w - 4, h * 0.38, Math.max(1, r - 2));
    g.fill();
    g.fillColor = new Color(0, 0, 0, 22);
    g.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h * 0.28, Math.max(1, r - 2));
    g.fill();

    // 5. 顶面倒角高光(内缩细描边,增强圆角立体感)
    g.strokeColor = new Color(255, 255, 255, 70);
    g.lineWidth = 1.5;
    g.roundRect(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3, Math.max(1, r - 1.5));
    g.stroke();

    // 6. 凹槽外沿阴影(向右下偏移,暗边留在凹槽左上,模拟刻入)
    g.fillColor = new Color(0, 0, 0, 70);
    g.roundRect(-faceW / 2 + 1, -faceH / 2 - 1, faceW, faceH, faceR);
    g.fill();

    // 7. 凹槽底面(略深)
    g.fillColor = adjust(base, -12);
    g.roundRect(-faceW / 2, -faceH / 2, faceW, faceH, faceR);
    g.fill();

    // 8. 凹槽内沿明暗: 上/左暗,下/右亮(光源左上)
    g.fillColor = new Color(0, 0, 0, 50);
    g.roundRect(-faceW / 2 + 1, faceH / 2 - 2, faceW - 2, 2, 1);
    g.fill();
    g.fillColor = new Color(0, 0, 0, 35);
    g.roundRect(-faceW / 2, -faceH / 2 + 1, 2, faceH - 2, 1);
    g.fill();
    g.fillColor = new Color(255, 255, 255, 45);
    g.roundRect(-faceW / 2 + 1, -faceH / 2 + 0.5, faceW - 2, 1.5, 1);
    g.fill();
    g.fillColor = new Color(255, 255, 255, 28);
    g.roundRect(faceW / 2 - 2, -faceH / 2 + 1, 1.5, faceH - 2, 1);
    g.fill();
}

/** 平面牌面: 圆角矩形 + 细描边(其他三家使用,无 3D 立体效果) */
function drawTileFaceFlat(g: Graphics, w: number, h: number, base: Color, radius = 6): void {
    g.clear();
    const r = fitRadius(w, h, radius);
    g.fillColor = base;
    g.strokeColor = adjust(base, -80);
    g.lineWidth = 1.5;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();
    g.stroke();
}

/** 平面牌背: 圆角矩形 + 描边(其他三家手牌背面,无 3D 立体效果) */
function drawTileBackFlat(g: Graphics, w: number, h: number, base: Color, radius = 4): void {
    g.clear();
    const r = fitRadius(w, h, radius);
    g.fillColor = base;
    g.strokeColor = adjust(base, -80);
    g.lineWidth = 1.5;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();
    g.stroke();
    // 内沿细线(平面装饰,非立体)
    g.strokeColor = adjust(base, 45);
    g.lineWidth = 1;
    g.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, Math.max(1, r - 2));
    g.stroke();
}

/** 牌身绘制入口: frontView=true 自家正面立体牌面; false 其他三家平面牌面 */
function drawTileBg(g: Graphics, w: number, h: number, base: Color, frontView: boolean, radius = 6): void {
    if (frontView) drawTileFace3D(g, w, h, base, radius);
    else drawTileFaceFlat(g, w, h, base, radius);
}

/** 绘制3D按钮(保留原样式) */
export function draw3DButton(
    g: Graphics,
    width: number,
    height: number,
    base: Color,
    radius = 8,
): void {
    g.clear();
    const w = width;
    const h = height;
    const r = fitRadius(w, h, radius);
    const thickness = 3;

    g.fillColor = new Color(0, 0, 0, 70);
    g.roundRect(-w / 2 + 1, -h / 2 - thickness - 1, w + 1, h + 1, r);
    g.fill();

    g.fillColor = adjust(base, -55);
    g.roundRect(-w / 2, -h / 2 - thickness, w, h, r);
    g.fill();

    g.fillColor = base;
    g.strokeColor = adjust(base, -90);
    g.lineWidth = 1.5;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();
    g.stroke();

    g.fillColor = new Color(
        Math.min(255, base.r + 45),
        Math.min(255, base.g + 45),
        Math.min(255, base.b + 45),
        180,
    );
    g.roundRect(-w / 2 + 2, h / 2 - h * 0.4, w - 4, h * 0.35, Math.max(1, r - 2));
    g.fill();
}

// ==================== 按钮风格 ====================

/** 按钮视觉风格 */
export enum ButtonStyle {
    /** 立体倒角(对局内的按钮沿用,配牌桌的木色/玉色) */
    Bevel,
    /** 现代胶囊: 纯色填充 + 顶部高光(主按钮 / 选项选中态) */
    Pill,
    /** 描边胶囊: 极淡玻璃底 + 细描边(次按钮 / 选项未选中态) */
    PillGhost,
}

/**
 * 现代胶囊按钮: 底部柔影 + 同色外发光 + 纯色胶囊 + 顶部内高光
 * 扁平风格、不做立体倒角,靠 baseColor 区分主次(选中/未选中只换颜色)。
 */
export function drawPillButton(g: Graphics, width: number, height: number, base: Color): void {
    g.clear();
    const w = width;
    const h = height;
    const r = h / 2;

    // 底部柔影: 两层向下偏移的低透明度同形,做出柔和投影
    g.fillColor = new Color(0, 0, 0, 36);
    g.roundRect(-w / 2 - 2, -h / 2 - 7, w + 4, h + 2, r + 2);
    g.fill();
    g.fillColor = new Color(0, 0, 0, 26);
    g.roundRect(-w / 2, -h / 2 - 4, w, h, r);
    g.fill();

    // 同色外发光: 由粗到细两层,让按钮有"浮起来"的观感
    g.strokeColor = new Color(base.r, base.g, base.b, 32);
    g.lineWidth = 12;
    g.roundRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, r + 1);
    g.stroke();
    g.strokeColor = new Color(base.r, base.g, base.b, 72);
    g.lineWidth = 4;
    g.roundRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, r + 1);
    g.stroke();

    // 主体胶囊
    g.fillColor = base;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();

    // 顶部内高光: 两端避开圆角,只落在直边上
    g.fillColor = new Color(255, 255, 255, 40);
    g.roundRect(-w / 2 + r * 0.6, h / 2 - 3.5, w - r * 1.2, 2, 1);
    g.fill();
}

/**
 * 描边胶囊按钮(次要操作): 极淡玻璃底 + 细描边 + 顶部内高光
 * 与 drawPillButton 形成"实心主色 / 描边次要"的明确对比,不做外发光与投影。
 */
export function drawPillGhostButton(g: Graphics, width: number, height: number, base: Color): void {
    g.clear();
    const w = width;
    const h = height;
    const r = h / 2;

    // 极淡玻璃底: 比背景略亮一点,让按钮区域有"面"的存在感
    g.fillColor = new Color(255, 255, 255, 14);
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();
    // 细描边: 用传入色,保证与主色同族
    g.strokeColor = new Color(base.r, base.g, base.b, 170);
    g.lineWidth = 2;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.stroke();
    // 顶部内高光
    g.fillColor = new Color(255, 255, 255, 26);
    g.roundRect(-w / 2 + r * 0.6, h / 2 - 3.5, w - r * 1.2, 2, 1);
    g.fill();
}

/** 按风格绘制按钮底框 */
function paintButton(g: Graphics, width: number, height: number, base: Color, style: ButtonStyle): void {
    if (style === ButtonStyle.Pill) drawPillButton(g, width, height, base);
    else if (style === ButtonStyle.PillGhost) drawPillGhostButton(g, width, height, base);
    else draw3DButton(g, width, height, base, 8);
}

// ==================== 牌面图案(筒子/条子) ====================

/**
 * 筒子圆圈位置(归一化坐标 -1~1,基于凹槽中心)
 * 设计遵循真实麻将牌的几何规律:
 *  - 1筒: 单个大圆(铜钱/太阳)
 *  - 2-4筒: 线性/简单几何(纵向/品字/田字)
 *  - 5-7筒: 中心辐射/分层(梅花/2×3/梯形)
 *  - 8-9筒: 规则网格(4×2/3×3)
 * 坐标范围扩大至 ±0.45~0.55,配合 SPREAD 系数让图案铺满凹槽
 */
const TONG_POSITIONS: Record<number, [number, number][]> = {
    1: [[0, 0]],                                                                                                  // 1筒: 单大圆
    2: [[0, 0.55], [0, -0.55]],                                                                                   // 2筒: 上下纵向
    3: [[0, 0.5], [-0.45, -0.45], [0.45, -0.45]],                                                                 // 3筒: 品字形 上1下2
    4: [[-0.45, 0.45], [0.45, 0.45], [-0.45, -0.45], [0.45, -0.45]],                                              // 4筒: 2×2 田字
    5: [[-0.45, 0.45], [0.45, 0.45], [0, 0], [-0.45, -0.45], [0.45, -0.45]],                                      // 5筒: 梅花形 4角+中心
    6: [[-0.45, 0.35], [0, 0.35], [0.45, 0.35], [-0.45, -0.35], [0, -0.35], [0.45, -0.35]],                      // 6筒: 3×2 双层
    7: [[-0.24, 0.5], [0.24, 0.5], [0, 0.2], [-0.38, -0.05], [0.38, -0.05], [-0.38, -0.42], [0.38, -0.42]],          // 7筒: 上3倒三角▽ + 下4正方形2×2 梯形
    8: [[-0.52, 0.35], [-0.17, 0.35], [0.17, 0.35], [0.52, 0.35], [-0.52, -0.35], [-0.17, -0.35], [0.17, -0.35], [0.52, -0.35]], // 8筒: 4×2 网格
    9: [[-0.45, 0.45], [0, 0.45], [0.45, 0.45], [-0.45, 0], [0, 0], [0.45, 0], [-0.45, -0.45], [0, -0.45], [0.45, -0.45]], // 9筒: 3×3 九宫格
};

/**
 * 筒子颜色方案 (0=绿, 1=蓝, 2=红)
 * 严格遵循真实麻将牌色彩规律:
 *  - 2-4筒: 双色区分方向(上绿下蓝/对角同色)
 *  - 5-7筒: 关键标识(5筒红心/6筒分层/7筒红绿蓝交替)
 *  - 8-9筒: 色块分区(8筒棋盘格/9筒四角中心绿)
 */
const TONG_COLOR_PLAN: Record<number, number[]> = {
    2: [0, 1],                          // 2筒: 上绿下蓝
    3: [0, 1, 1],                       // 3筒: 上绿 下蓝蓝
    4: [0, 1, 1, 0],                    // 4筒: 对角同色(左上右下绿,右上左下蓝)
    5: [0, 0, 2, 0, 0],                 // 5筒: 四角绿 + 中心红(灵魂标识)
    6: [0, 0, 0, 1, 1, 1],              // 6筒: 上层全绿 下层全蓝
    7: [0, 0, 2, 0, 1, 1, 0],           // 7筒: 上3倒三角(绿绿红) 下4(绿蓝蓝绿对角)
    8: [0, 1, 0, 1, 1, 0, 1, 0],        // 8筒: 棋盘格红绿蓝交替
    9: [0, 1, 0, 1, 0, 1, 0, 1, 0],     // 9筒: 四角+中心绿,其余蓝(九宫格)
};

/**
 * 条子竹条位置(归一化坐标 -1~1,基于凹槽中心)
 * 设计遵循真实麻将牌的几何对称规律:
 *  - 低点数(2-4): 稀疏修长,简单轴对称
 *  - 中点数(5-7): 红绿相间,复合对称
 *  - 高点数(8-9): 紧密短粗,严格中心/轴对称
 * 坐标范围扩大至 ±0.45~0.5,配合 SPREAD 系数让图案铺满凹槽
 */
const TIAO_POSITIONS: Record<number, [number, number][]> = {
    1: [[0, 0]],                                                                              // 幺鸡(单独处理)
    2: [[-0.35, 0], [0.35, 0]],                                                               // 2根并排(横向平行)
    3: [[0, 0.5], [-0.4, -0.45], [0.4, -0.45]],                                              // 品字形: 上1下2
    4: [[-0.35, 0.42], [0.35, 0.42], [-0.35, -0.42], [0.35, -0.42]],                         // 2×2 矩形方阵
    5: [[-0.35, 0.48], [0.35, 0.48], [-0.48, -0.42], [0, -0.42], [0.48, -0.42]],             // 上2下3
    6: [[-0.48, 0.38], [0, 0.38], [0.48, 0.38], [-0.48, -0.38], [0, -0.38], [0.48, -0.38]],  // 3×2 双层对称
    7: [[-0.4, 0.45], [0, 0.45], [0.4, 0.45], [-0.38, -0.08], [0.38, -0.08], [-0.38, -0.42], [0.38, -0.42]], // 上3一字 + 下4正方形2×2
    8: [[-0.52, 0.38], [-0.17, 0.38], [0.17, 0.38], [0.52, 0.38], [-0.52, -0.38], [-0.17, -0.38], [0.17, -0.38], [0.52, -0.38]], // 4×2 四四对开
    9: [[-0.45, 0.48], [0, 0.48], [0.45, 0.48], [-0.45, 0], [0, 0], [0.45, 0], [-0.45, -0.48], [0, -0.48], [0.45, -0.48]], // 3×3 三层
};

/** 条子按行数计算竹条高度(行越多竹条越短,避免溢出) */
const TIAO_ROWS: Record<number, number> = {
    1: 1, 2: 1, 3: 2,    // 1-3条
    4: 2, 5: 2, 6: 2,    // 4-6条: 两行
    7: 2, 8: 2,          // 7,8条: 两行
    9: 3,                // 9条: 三行(三明治)
};

/** 条子按列数计算竹条宽度(列越多竹条越窄,仿真实麻将牌) */
const TIAO_COLS: Record<number, number> = {
    1: 1, 2: 2, 3: 2,    // 1-3条
    4: 2, 5: 3, 6: 3,    // 4-6条
    7: 2, 8: 4,          // 7条: 下4为2×2正方形按2列; 8条: 4列
    9: 3,                // 9条: 3列
};

/**
 * 条子颜色方案 (0=绿, 1=红, 2=深绿, 3=深红)
 * 严格遵循真实麻将牌色彩规律:
 *  - 2-4条: 纯绿为主(2条/3条纯绿,4条上绿下深绿区分)
 *  - 5-7条: 红绿相间(5条红绿混用,6条上层全绿下层全红,7条红绿交错)
 *  - 8-9条: 红绿强对比(8条棋盘格,9条绿-红-绿三明治)
 */
const TIAO_COLOR_PLAN: Record<number, number[]> = {
    2: [0, 0],                          // 2条: 双绿
    3: [0, 0, 0],                       // 3条: 纯绿
    4: [0, 0, 2, 2],                    // 4条: 上绿下深绿
    5: [0, 1, 1, 0, 1],                 // 5条: 上(绿红) 下(红绿红)
    6: [0, 0, 0, 1, 1, 1],              // 6条: 上层全绿 下层全红
    7: [0, 1, 0, 1, 0, 0, 1],           // 7条: 上3(绿红绿) 下4(红绿绿红对角)
    8: [0, 1, 0, 1, 1, 0, 1, 0],        // 8条: 棋盘格(上绿红绿红/下红绿红绿)
    9: [0, 0, 0, 1, 1, 1, 0, 0, 0],     // 9条: 绿-红-绿 三明治
};

/** 图案铺开系数(归一化坐标 → 像素的缩放,1.0 = 铺到凹槽边缘) */
const SPREAD_X = 1.08;
const SPREAD_Y = 1.08;

/**
 * 绘制单个筒子(四层环结构,仿真实麻将牌)
 * 层次: 外深边 → 主色环 → 内白心 → 中心点
 */
function drawTongCircle(g: Graphics, cx: number, cy: number, r: number, ringColor: Color): void {
    const ivory = new Color(248, 238, 210, 255);
    // 1. 外深色边(模拟铜钱外沿)
    g.fillColor = adjust(ringColor, -60);
    g.circle(cx, cy, r);
    g.fill();
    // 2. 主色环
    g.fillColor = ringColor;
    g.circle(cx, cy, r * 0.88);
    g.fill();
    // 3. 内白心(象牙色,空心效果)
    g.fillColor = ivory;
    g.circle(cx, cy, r * 0.52);
    g.fill();
    // 4. 中心点(主色小圆)
    g.fillColor = ringColor;
    g.circle(cx, cy, r * 0.18);
    g.fill();
    // 5. 中心高光(小白点,增加立体感)
    g.fillColor = adjust(ivory, 15);
    g.circle(cx - r * 0.04, cy + r * 0.04, r * 0.07);
    g.fill();
}

/** 筒子圆圈颜色定义 (索引对应 TONG_COLOR_PLAN 中的值) */
const TONG_PALETTE: Color[] = [
    new Color(36, 132, 56, 255),   // 0: 绿
    new Color(36, 76, 176, 255),   // 1: 蓝
    new Color(196, 36, 36, 255),   // 2: 红
];

/** 筒子按列数计算圆半径(列越多圆越小,避免重叠) */
const TONG_COLS: Record<number, number> = {
    2: 1, 3: 2, 4: 2, 5: 2, 6: 3, 7: 2, 8: 4, 9: 3,
};

/**
 * 绘制1筒(超大同心圆,铜钱/太阳样式)
 * 层次: 外深绿边 → 主绿环 → 中红环 → 内白心 → 中心红点 → 高光
 */
function drawTongOne(g: Graphics, w: number, h: number): void {
    const minDim = Math.min(w, h);
    const r = minDim * 0.36;
    const green = TONG_PALETTE[0];
    const red = TONG_PALETTE[2];
    const ivory = new Color(248, 238, 210, 255);

    // 1. 外深绿边(铜钱外沿)
    g.fillColor = adjust(green, -60);
    g.circle(0, 0, r);
    g.fill();
    // 2. 主绿环
    g.fillColor = green;
    g.circle(0, 0, r * 0.92);
    g.fill();
    // 3. 中红环(铜钱中层)
    g.fillColor = adjust(red, -30);
    g.circle(0, 0, r * 0.74);
    g.fill();
    g.fillColor = red;
    g.circle(0, 0, r * 0.66);
    g.fill();
    // 4. 内白心(象牙色)
    g.fillColor = ivory;
    g.circle(0, 0, r * 0.5);
    g.fill();
    // 5. 内环描边(绿,模拟铜钱方孔外圈)
    g.strokeColor = adjust(green, -40);
    g.lineWidth = 1.2;
    g.circle(0, 0, r * 0.5);
    g.stroke();
    // 6. 中心红点(太阳核心)
    g.fillColor = red;
    g.circle(0, 0, r * 0.18);
    g.fill();
    // 7. 中心高光(小白点,增加立体感)
    g.fillColor = adjust(ivory, 15);
    g.circle(-r * 0.04, r * 0.04, r * 0.06);
    g.fill();
    // 8. 四向小放射纹(模拟铜钱刻线,绿)
    g.strokeColor = adjust(green, -50);
    g.lineWidth = 1;
    const lineD = r * 0.32;
    g.moveTo(0, lineD); g.lineTo(0, r * 0.46); g.stroke();
    g.moveTo(0, -lineD); g.lineTo(0, -r * 0.46); g.stroke();
    g.moveTo(lineD, 0); g.lineTo(r * 0.46, 0); g.stroke();
    g.moveTo(-lineD, 0); g.lineTo(-r * 0.46, 0); g.stroke();
}

/**
 * 绘制筒子圆圈图案
 *  - 1筒: 超大铜钱(外绿中红内白多层嵌套)
 *  - 2-9筒: 按几何规律与色彩方案绘制同心圆(绿/蓝/红)
 *    · 低点数(2-4): 线性/品字/田字,双色区分方向
 *    · 中点数(5-7): 梅花/2×3/梯形,关键标识(5筒红心)
 *    · 高点数(8-9): 4×2/3×3网格,色块分区
 */
function drawTongPattern(g: Graphics, rank: number, w: number, h: number): void {
    if (rank === 1) {
        drawTongOne(g, w, h);
        return;
    }
    const positions = TONG_POSITIONS[rank] || [];
    const colorPlan = TONG_COLOR_PLAN[rank] || [];
    const minDim = Math.min(w, h);
    // 圆半径按列数自适应(列越多圆越小)
    const cols = TONG_COLS[rank] || 2;
    const rOuter = minDim * (cols >= 4 ? 0.072 : cols === 3 ? 0.085 : cols === 2 ? 0.1 : 0.13);
    const hx = (w / 2) * SPREAD_X;
    const hy = (h / 2) * SPREAD_Y;

    for (let i = 0; i < positions.length; i++) {
        const [nx, ny] = positions[i];
        const colorIdx = colorPlan[i] ?? 1;
        const ringColor = TONG_PALETTE[colorIdx] || TONG_PALETTE[1];
        drawTongCircle(g, nx * hx, ny * hy, rOuter, ringColor);
    }
}

/** 条子竹条颜色定义 (索引对应 TIAO_COLOR_PLAN 中的值) */
const TIAO_PALETTE: { fill: Color; dark: Color }[] = [
    { fill: new Color(36, 132, 56, 255),  dark: new Color(22, 86, 38, 255)  }, // 0: 绿
    { fill: new Color(196, 36, 36, 255),  dark: new Color(132, 22, 22, 255) }, // 1: 红
    { fill: new Color(26, 100, 42, 255),  dark: new Color(16, 64, 28, 255)  }, // 2: 深绿
    { fill: new Color(160, 28, 28, 255),  dark: new Color(108, 16, 16, 255) }, // 3: 深红
];

/** 绘制单根竹条(圆角竖条 + 左侧高光 + 右侧暗边 + 竹节横线) */
function drawBambooStick(
    g: Graphics, cx: number, cy: number,
    bw: number, bh: number,
    fill: Color, dark: Color,
): void {
    // 竹竿主体(圆角竖条)
    g.fillColor = fill;
    g.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, bw / 2);
    g.fill();
    // 左侧高光(细亮线,模拟圆柱反光)
    g.fillColor = adjust(fill, 50);
    g.roundRect(cx - bw / 2 + 1, cy - bh / 2 + 2, bw * 0.26, bh - 4, bw * 0.13);
    g.fill();
    // 右侧暗边(增加立体感)
    g.fillColor = dark;
    g.roundRect(cx + bw / 2 - bw * 0.22, cy - bh / 2 + 2, bw * 0.18, bh - 4, bw * 0.09);
    g.fill();
    // 竹节横线(竹条足够长时绘制,模拟竹节)
    g.strokeColor = dark;
    g.lineWidth = 1;
    if (bh > bw * 2.5) {
        g.moveTo(cx - bw / 2 + 1, cy);
        g.lineTo(cx + bw / 2 - 1, cy);
        g.stroke();
    }
    if (bh > bw * 4) {
        g.moveTo(cx - bw / 2 + 1, cy - bh * 0.3);
        g.lineTo(cx + bw / 2 - 1, cy - bh * 0.3);
        g.stroke();
        g.moveTo(cx - bw / 2 + 1, cy + bh * 0.3);
        g.lineTo(cx + bw / 2 - 1, cy + bh * 0.3);
        g.stroke();
    }
}

/** 绘制1条(幺鸡): 居中竹竿 + 顶部鸟头 + 鸟眼 + 鸟嘴 + 根部绿叶 */
function drawTiaoOne(g: Graphics, w: number, h: number): void {
    const minDim = Math.min(w, h);
    const green = TIAO_PALETTE[0].fill;
    const darkGreen = TIAO_PALETTE[0].dark;
    const bambooW = minDim * 0.16;
    const bambooH = minDim * 0.52;

    // 竹竿主体
    drawBambooStick(g, 0, 0, bambooW, bambooH, green, darkGreen);

    // 鸟头(红色圆,立于竹竿顶端)
    const headY = bambooH / 2 + bambooW * 0.55;
    const headR = bambooW * 0.72;
    g.fillColor = adjust(TIAO_PALETTE[1].fill, -60);
    g.circle(0, headY, headR + 1);
    g.fill();
    g.fillColor = TIAO_PALETTE[1].fill;
    g.circle(0, headY, headR);
    g.fill();

    // 鸟冠(顶部红色小弧)
    g.fillColor = adjust(TIAO_PALETTE[1].fill, -30);
    g.ellipse(0, headY + headR * 0.85, headR * 0.35, headR * 0.4);
    g.fill();

    // 鸟眼(白色眼底 + 黑色瞳孔)
    g.fillColor = new Color(255, 255, 255, 255);
    g.circle(headR * 0.25, headY + headR * 0.15, headR * 0.24);
    g.fill();
    g.fillColor = new Color(30, 30, 30, 255);
    g.circle(headR * 0.3, headY + headR * 0.15, headR * 0.12);
    g.fill();

    // 鸟嘴(橙色三角,向右伸出)
    g.fillColor = new Color(232, 168, 40, 255);
    g.moveTo(headR * 0.6, headY);
    g.lineTo(headR * 1.25, headY + headR * 0.18);
    g.lineTo(headR * 0.6, headY + headR * 0.36);
    g.close();
    g.fill();
    g.strokeColor = new Color(160, 110, 20, 255);
    g.lineWidth = 0.8;
    g.stroke();

    // 竹竿根部装饰(底部小绿叶)
    g.fillColor = adjust(green, 20);
    g.ellipse(-bambooW * 0.6, -bambooH / 2 + bambooW * 0.2, bambooW * 0.3, bambooW * 0.5);
    g.fill();
    g.ellipse(bambooW * 0.6, -bambooH / 2 + bambooW * 0.2, bambooW * 0.3, bambooW * 0.5);
    g.fill();
}

/**
 * 绘制条子竹条图案
 *  - 1条: 幺鸡(竹竿+鸟)
 *  - 2-9条: 按几何对称与色彩规律绘制竹条(绿/红/深绿/深红)
 *    · 低点数(2-4): 稀疏修长,纯绿为主
 *    · 中点数(5-7): 红绿相间,复合对称
 *    · 高点数(8-9): 紧密短粗,严格对称
 */
function drawTiaoPattern(g: Graphics, rank: number, w: number, h: number): void {
    if (rank === 1) {
        drawTiaoOne(g, w, h);
        return;
    }

    const positions = TIAO_POSITIONS[rank] || [];
    const colorPlan = TIAO_COLOR_PLAN[rank] || [];
    const rows = TIAO_ROWS[rank] || 2;
    const cols = TIAO_COLS[rank] || 3;
    const minDim = Math.min(w, h);
    const hx = (w / 2) * SPREAD_X;
    const hy = (h / 2) * SPREAD_Y;

    // 竹条尺寸按行数/列数自适应: 行越多越短,列越多越窄
    const bambooW = minDim * (cols <= 2 ? 0.13 : cols === 3 ? 0.1 : 0.075);
    const bambooH = minDim * (rows === 1 ? 0.5 : rows === 2 ? 0.3 : 0.21);

    for (let i = 0; i < positions.length; i++) {
        const [nx, ny] = positions[i];
        const colorIdx = colorPlan[i] ?? 0;
        const palette = TIAO_PALETTE[colorIdx] || TIAO_PALETTE[0];
        const cx = nx * hx;
        const cy = ny * hy;
        drawBambooStick(g, cx, cy, bambooW, bambooH, palette.fill, palette.dark);
    }
}

// ==================== 万子牌面(由TileView用Label渲染) ====================

/** 在凹槽内绘制牌面图案(筒子/条子画图案;万子/字牌用Label) */
export function drawTilePattern(g: Graphics, tile: Tile, w: number, h: number, selected = false): void {
    g.clear();
    switch (tile.suit) {
        case TileSuit.TONG:
            drawTongPattern(g, tile.rank, w, h);
            break;
        case TileSuit.TIAO:
            drawTiaoPattern(g, tile.rank, w, h);
            break;
        default:
            break; // WAN/FENG/JIAN 由 Label 显示文字
    }
}

// ==================== 安全点击(按下可拖出取消) ====================

/**
 * 给按钮节点绑定"可取消"的点击回调。
 * Cocos Creator 没有 Node.EventType.CLICK,Button 组件也不会自动派发 click 事件,
 * 所以这里自己监听 TOUCH_START/MOVE/END/CANCEL 实现:
 *   手指按下 → 按钮缩放反馈
 *   手指保持在按钮上抬起 → 触发回调 + 音效
 *   手指拖出按钮范围再抬起 → 不触发(用户取消)
 *   系统打断(来电等) → 不触发
 */
export function bindSafeClick(node: Node, callback: () => void, target?: unknown): void {
    let inside = false;
    let pressed = false;

    const t = node.getComponent(UITransform);
    const halfW = t ? t.width / 2 : 0;
    const halfH = t ? t.height / 2 : 0;

    const onStart = (e: EventTouch): void => {
        pressed = true;
        inside = true;
    };
    const onMove = (e: EventTouch): void => {
        if (!pressed || !inside) return;
        if (!t) return;
        // 把 UI 坐标转换成按钮的局部坐标
        const uiLoc = e.touch.getUILocation();
        const local = t.convertToNodeSpaceAR({ x: uiLoc.x, y: uiLoc.y });
        if (Math.abs(local.x) > halfW || Math.abs(local.y) > halfH) {
            inside = false;
        }
    };
    const onEnd = (_e: EventTouch): void => {
        if (pressed && inside) {
            callback.call(target);
        }
        pressed = false;
        inside = false;
    };
    const onCancel = (): void => {
        pressed = false;
        inside = false;
    };

    node.on(Node.EventType.TOUCH_START, onStart, node);
    node.on(Node.EventType.TOUCH_MOVE, onMove, node);
    node.on(Node.EventType.TOUCH_END, onEnd, node);
    node.on(Node.EventType.TOUCH_CANCEL, onCancel, node);
}

// ==================== 节点工厂 ====================

/**
 * 创建一张麻将牌节点
 * 结构: TileNode > Bg(牌身3D) + Pattern(凹槽内图案) + Label(文字)
 * 调用方随后 addComponent(TileView) 挂载交互逻辑
 */
export function createTileNode(width = 70, height = 100, frontView = false): Node {
    const node = new Node('Tile');

    const transform = node.addComponent(UITransform);
    transform.setContentSize(width, height);

    const inset = getInset(width, height);
    const faceW = width - inset * 2;
    const faceH = height - inset * 2;

    // ---- 背景: 自家用正面立体牌身(含凹槽),其他三家平面牌面 ----
    const bgNode = new Node('Bg');
    bgNode.parent = node;
    const bgTransform = bgNode.addComponent(UITransform);
    bgTransform.setContentSize(width, height);
    const g = bgNode.addComponent(Graphics);
    drawTileBg(g, width - 2, height - 2, new Color(248, 238, 210, 255), frontView);

    // ---- 牌面图片层: 凹槽内显示真实牌面图片,由 TileView 按需设置 ----
    const faceNode = new Node('Face');
    faceNode.parent = node;
    const faceTransform = faceNode.addComponent(UITransform);
    faceTransform.setContentSize(faceW - 2, faceH - 2);
    const faceSprite = faceNode.addComponent(Sprite);
    faceSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    faceSprite.type = Sprite.Type.SIMPLE;
    faceNode.active = false; // 默认隐藏,TileView.setData 传入牌面图片后开启

    // ---- 图案层: 凹槽内图案(筒子/条子),由 TileView 按需绘制 ----
    const patternNode = new Node('Pattern');
    patternNode.parent = node;
    const patternTransform = patternNode.addComponent(UITransform);
    patternTransform.setContentSize(faceW - 2, faceH - 2);
    patternNode.addComponent(Graphics);
    patternNode.active = false; // 默认隐藏,TileView.setData 按花色开启

    // ---- 文字标签: 万子(数字行)/字牌 ----
    const labelNode = new Node('Label');
    labelNode.parent = node;
    const labelTransform = labelNode.addComponent(UITransform);
    labelTransform.setContentSize(faceW - 2, faceH - 2);
    const label = labelNode.addComponent(Label);
    label.fontSize = 34;
    label.lineHeight = 40;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.color = new Color(50, 50, 50, 255);
    label.overflow = Label.Overflow.SHRINK;

    // ---- 万字标签: 万子专用(显示"萬"大字,与数字行分开着色/字号) ----
    const labelWanNode = new Node('LabelWan');
    labelWanNode.parent = node;
    const labelWanTransform = labelWanNode.addComponent(UITransform);
    labelWanTransform.setContentSize(faceW - 2, faceH - 2);
    const labelWan = labelWanNode.addComponent(Label);
    labelWan.fontSize = 34;
    labelWan.lineHeight = 40;
    labelWan.horizontalAlign = Label.HorizontalAlign.CENTER;
    labelWan.verticalAlign = Label.VerticalAlign.CENTER;
    labelWan.color = new Color(196, 36, 36, 255);
    labelWan.overflow = Label.Overflow.SHRINK;
    labelWanNode.active = false; // 默认隐藏,仅万子启用

    return node;
}

/**
 * 创建一张牌背节点(用于显示其他三家手牌背面)
 * 结构: TileBackNode > Bg(平面牌背,无 3D 效果)
 */
export function createTileBackNode(width = 40, height = 56): Node {
    const node = new Node('TileBack');
    const transform = node.addComponent(UITransform);
    transform.setContentSize(width, height);

    const bgNode = new Node('Bg');
    bgNode.parent = node;
    const bgTransform = bgNode.addComponent(UITransform);
    bgTransform.setContentSize(width, height);
    const g = bgNode.addComponent(Graphics);
    drawTileBackFlat(g, width - 2, height - 2, new Color(60, 90, 160, 255), 4);

    return node;
}

/**
 * 设置牌节点的背景色(按花色区分),重绘牌身
 * @param frontView true=自家正面立体牌面; false(其他三家)=平面牌面
 */
export function setTileBgColor(node: Node, suit: TileSuit, frontView = false): void {
    const bgNode = node.getChildByName('Bg');
    if (!bgNode) return;
    const g = bgNode.getComponent(Graphics);
    const bgTransform = bgNode.getComponent(UITransform);
    if (!g || !bgTransform) return;
    const [r, gC, b] = SUIT_BG_COLORS[suit] ?? [248, 238, 210];
    drawTileBg(g, bgTransform.width - 2, bgTransform.height - 2,
        new Color(r, gC, b, 255), frontView);
}

/**
 * 创建纯文字标签节点
 * @param text 文本
 * @param fontSize 字号
 * @param color 颜色
 * @param width 文本域宽度(不变换节点位置: 文本域以节点为居中锚点)
 * @param height 文本域高度; 0=按单行计算。多行文本(含 \n)务必显式传入,
 *               否则 SHRINK 溢出策略会把多行压进单行的高度里,字被缩得很小
 * @param alignLeft true=文本在文本域内左对齐(默认居中)
 */
export function createLabelNode(
    text: string,
    fontSize = 32,
    color: Color = new Color(255, 255, 255, 255),
    width = 600,
    height = 0,
    alignLeft = false,
): Node {
    const node = new Node('Label');
    const transform = node.addComponent(UITransform);
    transform.setContentSize(width, height > 0 ? height : fontSize + 12);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 8;
    label.horizontalAlign = alignLeft ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.color = color;
    label.overflow = Label.Overflow.SHRINK;
    return node;
}

/**
 * 按钮底框绘制函数表(节点 → 重画函数)
 *
 * 原生(JSB)平台上 Graphics 的顶点数据会丢: 组件 onLoad 期间画的图形上不了屏,
 * 页面隐藏过之后再显示也只有文字、底框整块消失(牌桌/底板/转盘已在 Main 里用
 * "首帧后重画"规避)。按钮同样会被隐藏(切页面/开局),所以这里把"怎么画"记下来,
 * 需要时用 repaintButtons 补画一次。
 */
const buttonPainters = new WeakMap<Node, () => void>();

/**
 * 重画一棵子树里所有按钮的底框(含自身),用于页面/面板重新显示时补画
 *
 * 幂等: draw3DButton 内部先 clear 再画,重复调用不会叠加(原生平台必须 clear,
 * 否则旧顶点无法被替换)。
 */
export function repaintButtons(root: Node | null): void {
    if (!root) return;
    const paint = buttonPainters.get(root);
    if (paint) paint();
    for (const child of root.children) repaintButtons(child);
}

/**
 * 创建按钮节点
 * 结构: ButtonNode(UITransform + Graphics + Button) > Label(文字)
 * @param baseColor 按钮主色,默认蓝色;可传金色/灰色区分不同操作
 * @param style 底框风格,默认立体倒角(对局内);主菜单/设置页传 Pill 用现代胶囊样式
 */
export function createButtonNode(
    text: string,
    width = 160,
    height = 56,
    baseColor: Color = new Color(70, 130, 200, 255),
    style: ButtonStyle = ButtonStyle.Bevel,
): Node {
    const node = new Node('Btn_' + text);
    const transform = node.addComponent(UITransform);
    transform.setContentSize(width, height);

    const g = node.addComponent(Graphics);
    const paint = (): void => paintButton(g, transform.width, transform.height, baseColor, style);
    buttonPainters.set(node, paint);
    paint();

    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.duration = 0.08;
    button.zoomScale = 0.9;

    // 点击音效: 只有真正松手点击确认时才响(手指拖出去不触发)
    bindSafeClick(node, playButtonClick, node);

    const labelNode = new Node('Label');
    labelNode.parent = node;
    const labelTransform = labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width, height);
    const label = labelNode.addComponent(Label);
    label.string = text;
    label.fontSize = 28;
    label.lineHeight = 34;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.color = new Color(255, 255, 255, 255);

    return node;
}

/** 默认按钮主色(蓝) */
export const BTN_COLOR_BLUE = new Color(70, 130, 200, 255);
/** 次要按钮主色(灰) */
export const BTN_COLOR_GREY = new Color(96, 104, 116, 255);

/**
 * 计算并应用设计分辨率,返回设计尺寸
 *
 * 把设计分辨率扩成与屏幕相同的比例(且不小于 1920×1080),从而铺满整个屏幕、不留黑边。
 * 牌桌与菜单共用这一份计算,避免两处各写一套导致缩放不一致。
 */
export function applyDesignResolution(baseW = 1920, baseH = 1080): { width: number; height: number } {
    const frameW = screen.windowSize.width;
    const frameH = screen.windowSize.height;
    const aspect = (frameW > 0 && frameH > 0) ? frameW / frameH : baseW / baseH;
    const designW = Math.round(Math.max(baseW, baseH * aspect));
    const designH = Math.round(Math.max(baseH, baseW / aspect));
    view.setDesignResolutionSize(designW, designH, ResolutionPolicy.SHOW_ALL);
    return { width: designW, height: designH };
}

/**
 * 重绘按钮底框(换主色用):
 * 菜单里的"选项按钮"需要按选中态切换金/灰两色,这里按同样的风格重画一遍。
 */
export function restyleButton(node: Node, baseColor: Color, style: ButtonStyle = ButtonStyle.Bevel): void {
    const g = node.getComponent(Graphics);
    const t = node.getComponent(UITransform);
    if (!g || !t) return;
    const paint = (): void => paintButton(g, t.width, t.height, baseColor, style);
    // 记住新的画法,页面重新显示时按最新配色补画
    buttonPainters.set(node, paint);
    paint();
}
