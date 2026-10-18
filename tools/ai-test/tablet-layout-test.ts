/**
 * 平板(3:2 / iPad 4:3)适配复核
 *
 * 【真实问题 1】平板上开局后整张桌子缩在屏幕中间, 上下各留一条底色;
 * 而牌位是按"可见半高"贴屏幕边排的, 于是上家手牌整排压过桌沿、自家手牌坐到木框上 ——
 * 看上去就是"牌摆到桌子外面去了"。
 *
 * 根因两条, 都在"牌桌是固定尺寸、牌位却跟着屏幕走":
 *   1) 桌面是固定几何(近端半高 560 / 远端 530), 而可见半高 = 840 / 宽高比。
 *      16:9 时 472 < 530, 桌面上下都被裁掉, 屏幕里看不到桌沿(设计意图);
 *      3:2 时 560 > 530, 整张桌子就露出来了。
 *   2) 牌位直接拿 halfH 当边距, 屏幕越方 halfH 越大 → 牌越贴边 → 出了毡布。
 *
 * 【真实问题 2】桌面为了盖住屏幕被放大了 1.08~1.21 倍, 牌却一直是手机尺寸,
 * 于是平板上的牌相对桌子明显偏小、桌子显得空旷。现在牌也按可见高度等比放大
 * (`_applyTileScale`, 上限 1.14), 由满手 14 张手牌与"提示"按钮之间的净空决定。
 *
 * 锁住四组不变量(数值全部从真实源码提取):
 *   A 手机比例(≥16:9)上一根手指都不许动: 桌面缩放 = 1、牌尺寸 = 基准、牌位半高 = 可见半高;
 *   B 桌面永远盖住屏幕: 桌面远端 × 缩放 ≥ 可见半高;
 *   C 上家手牌上沿 / 自家手牌下沿 永远在毡布内;
 *   D 源码接线: _applyLayout 先算桌面缩放再夹牌位、牌尺寸倍率与重建入口都接上了;
 *   E 放大后的牌不撞常驻 UI(手牌 ↔ 提示按钮 / 听牌芯片 / 各家牌区互相之间)。
 */
declare const require: (m: string) => any;
declare const __dirname: string;
declare const process: { exit(code: number): never };
const fs = require('fs');
const path = require('path');

function findFile(rel: string): string {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        const p = path.join(dir, ...rel.split('/'));
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
        dir = path.dirname(dir);
    }
    throw new Error(`找不到 ${rel}`);
}

function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
}

function body(code: string, signature: string): string {
    const i = code.indexOf(signature);
    if (i < 0) return '';
    let depth = 0, started = false;
    for (let j = code.indexOf('{', i); j < code.length; j++) {
        const ch = code[j];
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') {
            depth--;
            if (started && depth === 0) return code.slice(code.indexOf('{', i), j + 1);
        }
    }
    return '';
}

function num(code: string, re: RegExp, label: string): number {
    const m = re.exec(code);
    if (!m) throw new Error(`提取不到 ${label}`);
    return parseFloat(m[1]);
}

let fails = 0;
function check(cond: boolean, label: string, detail = ''): void {
    if (cond) console.log(`  ✓ ${label}`);
    else { fails++; console.log(`  ✗ ${label} ${detail}`); }
}
function near(a: number, b: number, eps = 1e-6): boolean {
    return Math.abs(a - b) < eps;
}

const mainCode = stripComments(fs.readFileSync(findFile('assets/scripts/Main.ts'), 'utf8'));

// ---------------------------------------------------------------- 参数
const CONTENT_W = num(mainCode, /CONTENT_W\s*=\s*([\d.]+)/, 'CONTENT_W');
const CONTENT_HALF_W = CONTENT_W / 2;
// 牌尺寸一律从 BASE_* 取: TILE_W 等现在是运行期字段(= BASE × 倍率), 不是常量
const BASE_TILE_W = num(mainCode, /BASE_TILE_W\s*=\s*([\d.]+)/, 'BASE_TILE_W');
const BASE_TILE_H = num(mainCode, /BASE_TILE_H\s*=\s*([\d.]+)/, 'BASE_TILE_H');
const BASE_TOP_TILE_W = num(mainCode, /BASE_TOP_TILE_W\s*=\s*([\d.]+)/, 'BASE_TOP_TILE_W');
const BASE_SIDE_TILE_W = num(mainCode, /BASE_SIDE_TILE_W\s*=\s*([\d.]+)/, 'BASE_SIDE_TILE_W');
const BASE_RIVER_TILE_W = num(mainCode, /BASE_RIVER_TILE_W\s*=\s*([\d.]+)/, 'BASE_RIVER_TILE_W');
const TILE_REF_HALF_H = num(mainCode, /TILE_REF_HALF_H\s*=\s*([\d.]+)/, 'TILE_REF_HALF_H');
const TILE_SCALE_MAX = num(mainCode, /TILE_SCALE_MAX\s*=\s*([\d.]+)/, 'TILE_SCALE_MAX');
/**
 * 自家手牌倍率: 下限 `HAND_SCALE` / 目标 `HAND_SCALE_TARGET`，
 * 实际值由"满手 14 张塞进内容左缘与「你·听」标记之间"反算（复刻 Main._applyTileScale）
 */
const HAND_SCALE = num(mainCode, /HAND_SCALE\s*=\s*([\d.]+)/, 'HAND_SCALE');
const HAND_SCALE_TARGET = num(mainCode, /HAND_SCALE_TARGET\s*=\s*([\d.]+)/, 'HAND_SCALE_TARGET');
const HAND_EDGE_GAP = num(mainCode, /HAND_EDGE_GAP\s*=\s*([\d.]+)/, 'HAND_EDGE_GAP');
const OTHERS_SCALE = num(mainCode, /OTHERS_SCALE\s*=\s*([\d.]+)/, 'OTHERS_SCALE');
const OTHERS_SCALE_MIN = num(mainCode, /OTHERS_SCALE_MIN\s*=\s*([\d.]+)/, 'OTHERS_SCALE_MIN');
const TENPAI_MARK_INSET = num(mainCode, /TENPAI_MARK_INSET\s*=\s*([\d.]+)/, 'TENPAI_MARK_INSET');
const TENPAI_MARK_W = num(mainCode, /TENPAI_MARK_W\s*=\s*([\d.]+)/, 'TENPAI_MARK_W');
const TABLE_NEAR_HH = num(mainCode, /TABLE_NEAR_HH\s*=\s*([\d.]+)/, 'TABLE_NEAR_HH');
const TABLE_FAR_HH = num(mainCode, /TABLE_FAR_HH\s*=\s*([\d.]+)/, 'TABLE_FAR_HH');
const FELT_TILE_TOP = num(mainCode, /FELT_TILE_TOP\s*=\s*([\d.]+)/, 'FELT_TILE_TOP');
const FELT_TILE_BOTTOM = num(mainCode, /FELT_TILE_BOTTOM\s*=\s*([\d.]+)/, 'FELT_TILE_BOTTOM');
// 手牌两侧的常驻元素(它们的位置不能动, 牌只能放大到"不撞它们"为止)
const HINT_BTN_W = num(mainCode, /HINT_BTN_W\s*=\s*([\d.]+)/, 'HINT_BTN_W');
const HINT_BTN_GAP = num(mainCode, /HINT_BTN_GAP\s*=\s*([\d.]+)/, 'HINT_BTN_GAP');
const TENPAI_HAND_GAP = num(mainCode, /TENPAI_HAND_GAP\s*=\s*([\d.]+)/, 'TENPAI_HAND_GAP');
const LEFT_BTN_PAD = num(mainCode, /LEFT_BTN_PAD\s*=\s*([\d.]+)/, 'LEFT_BTN_PAD');
const CHIP_EDGE_PAD = num(mainCode, /CHIP_EDGE_PAD\s*=\s*([\d.]+)/, 'CHIP_EDGE_PAD');
const MELD_MARK_GAP = num(mainCode, /MELD_MARK_GAP\s*=\s*([\d.]+)/, 'MELD_MARK_GAP');
const TURN_DISC_R_MAX = num(mainCode, /TURN_DISC_R_MAX\s*=\s*([\d.]+)/, 'TURN_DISC_R_MAX');
const TURN_DISC_R_MIN = num(mainCode, /TURN_DISC_R_MIN\s*=\s*([\d.]+)/, 'TURN_DISC_R_MIN');
const TURN_DISC_MARGIN = num(mainCode, /TURN_DISC_MARGIN\s*=\s*([\d.]+)/, 'TURN_DISC_MARGIN');
/** 左/右家手牌列 / 弃牌河的 x(来自 Main.AI_LAYOUT) */
const SIDE_HAND_X = 620;
/** 左右家牌河的老位置 = 现在只作上限(反推出来更大时保持原位, 只许往桌心靠) */
const SIDE_RIVER_X_MAX = Math.abs(num(mainCode, /hH:\s*false,\s*dx:\s*(-?[\d.]+)/, 'AI_LAYOUT 左家 dx'));
/** 弃牌河列数 / 侧家牌河内缘净空(侧家牌河的 x 由它们反推, 见 Main._sideRiverX) */
const RIVER_COLS = num(mainCode, /private readonly RIVER_COLS\s*=\s*([\d.]+)/, 'RIVER_COLS');
const SIDE_RIVER_COLS = num(mainCode, /private readonly SIDE_RIVER_COLS\s*=\s*([\d.]+)/, 'SIDE_RIVER_COLS');
const SIDE_RIVER_GAP = num(mainCode, /private readonly SIDE_RIVER_GAP\s*=\s*([\d.]+)/, 'SIDE_RIVER_GAP');
/** 满手张数(含刚摸到的那张), 横向最坏情况 */
const FULL_HAND = 14;
/** 副露最坏情况: 4 组 × 4 张 */
const FULL_MELD = 16;

// 毡布梯形(_buildTable 里那一层: drawTrapBands(786, 526, ...)), 与桌面同一套透视
const FELT_NEAR_HW = 786;
const FELT_NEAR_HH = 526;
const FELT_FAR_HH = FELT_NEAR_HH * (TABLE_FAR_HH / TABLE_NEAR_HH);   // 497.75
const FAR_RATIO = 0.78;

/** 复刻 Main._applyTableScale */
function tableScale(halfH: number): number {
    return Math.max(1, (halfH + 10) / TABLE_FAR_HH);
}
/** 复刻 Main._applyTileScale */
function tileScale(halfH: number): number {
    return Math.max(1, Math.min(TILE_SCALE_MAX, halfH / TILE_REF_HALF_H));
}
/**
 * 复刻 Main._applyTileScale 里的手牌倍率: 目标 1.45, 但满手 14 张要让开
 * 「你·听」标记(内缘 = 内容右半宽 − TENPAI_MARK_INSET − 半个标记宽)
 */
function handScale(tk: number): number {
    const markInner = (CONTENT_HALF_W - TENPAI_MARK_INSET) - TENPAI_MARK_W / 2 - HAND_EDGE_GAP;
    return Math.max(HAND_SCALE, Math.min(HAND_SCALE_TARGET, markInner / (7 * BASE_TILE_W * tk)));
}
/**
 * 复刻 Main._applyTileScale 里"其他牌"的收缩系数: 默认 0.9,
 * 若底部三段把手牌挤到转盘最小半径以下(21:9 最先发生), 继续缩到 OTHERS_SCALE_MIN
 */
function othersScaleFor(tk: number, halfH: number, th: number): number {
    const bottomHalf = bottomHalfOf(halfH);
    const rivBase = BASE_RIVER_TILE_W * tk;
    const pitch = BASE_TILE_H / BASE_TILE_W;
    const roomOf = (rivH: number): number => (bottomHalf - th - 8 - 2 * MELD_MARK_GAP) - 3 * rivH;
    if (roomOf(rivBase * OTHERS_SCALE * pitch) >= TURN_DISC_R_MIN) return OTHERS_SCALE;
    const maxRivH = (bottomHalf - th - 8 - 2 * MELD_MARK_GAP - TURN_DISC_R_MIN) / 3;
    return Math.max(OTHERS_SCALE_MIN, Math.min(OTHERS_SCALE, maxRivH / (rivBase * pitch)));
}
/** 复刻 Main._applyLayout 里的牌位上限(上下各一个, 毡布不对称) */
function topHalfOf(halfH: number): number {
    return Math.min(halfH, FELT_TILE_TOP * tableScale(halfH));
}
function bottomHalfOf(halfH: number): number {
    return Math.min(halfH, FELT_TILE_BOTTOM * tableScale(halfH));
}
function aspectHalfH(aspect: number): number {
    return CONTENT_HALF_W / aspect;
}

/**
 * 侧家牌河的倾斜角(度) —— 与 Main.SIDE_EDGE_TILT 同一套桌面几何:
 * atan2(近端半宽 − 远端半宽, 近端半高 + 远端半高)。这里用上面提取到的桌面常量重算,
 * 桌面几何一改, 下面的净空断言会立刻变红。
 */
const SIDE_EDGE_TILT = Math.atan2(
    FELT_NEAR_HW - FELT_NEAR_HW * FAR_RATIO,
    FELT_NEAR_HH + FELT_NEAR_HH * (TABLE_FAR_HH / TABLE_NEAR_HH),
) * 180 / Math.PI;

/**
 * 侧家牌河"往桌心探"的深度。
 * 容器是斜的, 最靠桌心的不是容器原点, 而是靠桌心那条边上最内侧的牌角:
 *   (半排长 + 半张牌宽) × sin(倾角) + 半张牌高 × cos(倾角)
 * 写死 x=340 时手机这块会白留 87px 空档, 4:3 平板却只剩 3px —— 同一个数字不是一回事。
 */
function sideRiverOverhang(riverW: number, rivH: number): number {
    const tilt = (SIDE_EDGE_TILT * Math.PI) / 180;
    return (((SIDE_RIVER_COLS - 1) * riverW) / 2 + riverW / 2) * Math.sin(tilt)
        + (rivH / 2) * Math.cos(tilt);
}
/** 复刻 Main._sideRiverX */
function sideRiverX(riverW: number, rivH: number): number {
    return Math.min(SIDE_RIVER_X_MAX,
        (RIVER_COLS * riverW) / 2 + SIDE_RIVER_GAP + sideRiverOverhang(riverW, rivH));
}
/** 侧家牌河内缘 ↔ 自家/上家牌河外沿 的净空(<0 就是叠了) */
function sideRiverClearance(riverW: number, rivH: number): number {
    return sideRiverX(riverW, rivH) - sideRiverOverhang(riverW, rivH) - (RIVER_COLS * riverW) / 2;
}

const SCREENS: Array<[string, number]> = [
    ['16:9', 16 / 9], ['19.5:9', 19.5 / 9], ['21:9', 21 / 9],
    ['3:2', 3 / 2], ['4:3', 4 / 3],
];

console.log('\n=== 平板适配复核 ===\n');
console.log(`参数: 内容半宽 ${CONTENT_HALF_W} / 桌面近端半高 ${TABLE_NEAR_HH} / ` +
    `远端 ${TABLE_FAR_HH} / 牌位上限 上${FELT_TILE_TOP} 下${FELT_TILE_BOTTOM}\n` +
    `牌基准 ${BASE_TILE_W}×${BASE_TILE_H} / 参考半高 ${TILE_REF_HALF_H} / 放大上限 ${TILE_SCALE_MAX}\n`);

// ---------------------------------------------------------------- A 组
console.log('[A] 手机比例(≥16:9)排版不变');
for (const [name, aspect] of [['16:9', 16 / 9], ['19.5:9', 19.5 / 9], ['21:9', 21 / 9]] as Array<[string, number]>) {
    const halfH = aspectHalfH(aspect);
    const k = tableScale(halfH);
    const tk = tileScale(halfH);
    check(k === 1, `${name} 桌面缩放 = 1`, `实际 ${k.toFixed(3)}`);
    check(tk === 1, `${name} 桌面牌尺寸倍率 = 1(${BASE_TILE_W}×${BASE_TILE_H})`, `实际 ${tk.toFixed(3)}`);
    const hs = handScale(tk);
    check(near(BASE_TILE_W * tk * hs, BASE_TILE_W * hs) && near(BASE_TILE_H * tk * hs, BASE_TILE_H * hs),
        `${name} 手牌 = 基准 × ${hs.toFixed(2)}(目标 ${HAND_SCALE_TARGET}, 下限 ${HAND_SCALE})`,
        `实际 ${(BASE_TILE_W * tk * hs).toFixed(1)}×${(BASE_TILE_H * tk * hs).toFixed(1)}`);
    check(Math.abs(topHalfOf(halfH) - halfH) < 1e-6 && Math.abs(bottomHalfOf(halfH) - halfH) < 1e-6,
        `${name} 牌位半高 = 可见半高 ${halfH.toFixed(1)}`,
        `实际 上${topHalfOf(halfH).toFixed(1)} / 下${bottomHalfOf(halfH).toFixed(1)}`);
}

// ---------------------------------------------------------------- B 组
console.log('\n[B] 桌面永远盖住屏幕(远端越过屏幕顶边)');
for (const [name, aspect] of [['16:9', 16 / 9], ['3:2', 3 / 2], ['4:3', 4 / 3], ['1:1', 1]] as Array<[string, number]>) {
    const halfH = aspectHalfH(aspect);
    const k = tableScale(halfH);
    const farEdge = TABLE_FAR_HH * k;
    check(farEdge >= halfH, `${name} 桌面远端 ${farEdge.toFixed(0)} ≥ 可见半高 ${halfH.toFixed(0)}`);
    // 桌面宽度也要够: 毡布在中线处(桌面坐标 y=0)的半宽 × 缩放 ≥ 牌桌左右两侧的牌位
    const midFeltW = (FELT_NEAR_HW + (FELT_NEAR_HW * FAR_RATIO - FELT_NEAR_HW) *
        ((0 - -FELT_NEAR_HH) / (FELT_FAR_HH + FELT_NEAR_HH))) * k;
    check(midFeltW > 0, `${name} 中线毡布半宽 ${midFeltW.toFixed(0)}(参考值)`);
}

// ---------------------------------------------------------------- C 组
console.log('\n[C] 牌在毡布内(上下沿)');
for (const [name, aspect] of [['16:9', 16 / 9], ['3:2', 3 / 2], ['4:3', 4 / 3]] as Array<[string, number]>) {
    const halfH = aspectHalfH(aspect);
    const k = tableScale(halfH);
    const topHalf = topHalfOf(halfH);
    const bottomHalf = bottomHalfOf(halfH);
    // _applyLayout: handY = -bottomHalf + TILE_H/2 + 8 ; topHandY = topHalf - 8 - topTileH/2
    const handBottom = -bottomHalf + 8;
    const topHandTop = topHalf - 8;
    const feltNear = -FELT_NEAR_HH * k;
    const feltFar = FELT_FAR_HH * k;
    check(topHandTop <= feltFar, `${name} 上家手牌上沿 ${topHandTop.toFixed(0)} ≤ 毡布上沿 ${feltFar.toFixed(0)}`,
        `超出 ${(topHandTop - feltFar).toFixed(1)}px`);
    check(handBottom >= feltNear, `${name} 自家手牌下沿 ${handBottom.toFixed(0)} ≥ 毡布下沿 ${feltNear.toFixed(0)}`,
        `超出 ${(feltNear - handBottom).toFixed(1)}px`);
    // 别夹得太狠: 夹掉的量不超过可见半高的 15%, 否则等于把牌堆到桌心
    check(topHalf > halfH * 0.85 && bottomHalf > halfH * 0.85,
        `${name} 牌位半高 上${topHalf.toFixed(0)}/下${bottomHalf.toFixed(0)} 没有被夹得过狠(可见 ${halfH.toFixed(0)})`);
}

// ---------------------------------------------------------------- D 组
console.log('\n[D] 源码接线');
const applyLayout = body(mainCode, 'private _applyLayout(');
check(applyLayout.length > 0, '_applyLayout() 能定位到');
check(applyLayout.includes('_applyTableScale(halfH)'), '_applyLayout() 先算桌面缩放');
check(applyLayout.includes('_applyTileScale(halfH, tableK)'),
    '_applyLayout() 同时算牌尺寸倍率(带上桌面倍率, 其他牌要按纵向余量收缩)');
check(applyLayout.includes('FELT_TILE_TOP') && applyLayout.includes('FELT_TILE_BOTTOM'),
    '_applyLayout() 用 FELT_TILE_TOP / FELT_TILE_BOTTOM 夹牌位');
check(/handY\s*=\s*-bottomHalf/.test(applyLayout), 'handY 用夹过的 bottomHalf');
check(/topHandY\s*=\s*topHalf/.test(applyLayout), 'topHandY 用夹过的 topHalf');
check(applyLayout.includes('_rebuildTiles'), '_applyLayout() 在倍率变化后重建牌(否则牌尺寸改了不生效)');
// 2026-10-18: 手牌放大到 1.45 → 「听牌/提示」挪出**手牌行**, 放到副露行左侧
check(/setPosition\(bx, meldY, 0\)/.test(applyLayout) && applyLayout.includes('LEFT_BTN_PAD'),
    '「听牌/提示」放在副露行左侧, 不再占手牌行');
check(!/setPosition\([^)]*handY[^)]*\)[\s\S]{0,80}_hintBtn/.test(applyLayout),
    '两个按钮都不再贴在手牌行(否则手牌永远放不大)');
const chipBody = body(mainCode, 'private _placeTenpaiChip(');
check(chipBody.includes('CHIP_EDGE_PAD') && chipBody.includes('this.TILE_H / 2'),
    '_placeTenpaiChip() 贴内容右边缘, 并整块抬到手牌上方(不再压手牌上沿)');
check(chipBody.includes('RIVER_TILE_W'),
    '芯片左界以"满副露右沿"为界, 不再按手牌右缘(手牌已占满整行)');
const scaleBody = body(mainCode, 'private _applyTableScale(');
check(scaleBody.includes('setScale'), '_applyTableScale() 真的缩放了桌面节点');
check(scaleBody.includes('TABLE_FAR_HH'), '_applyTableScale() 用 TABLE_FAR_HH 算倍率');
const tileScaleBody = body(mainCode, 'private _applyTileScale(');
check(tileScaleBody.length > 0, '_applyTileScale() 能定位到');
check(tileScaleBody.includes('TILE_SCALE_MAX') && tileScaleBody.includes('TILE_REF_HALF_H'),
    '_applyTileScale() 用同一组倍率常量');
check(['TILE_W', 'TILE_H', 'TOP_TILE_W', 'SIDE_TILE_W', 'RIVER_TILE_W']
    .every(f => tileScaleBody.indexOf(`this.${f} =`) >= 0),
    '_applyTileScale() 覆盖了全部五档牌尺寸');
check(tileScaleBody.includes('OTHERS_SCALE') && tileScaleBody.includes('OTHERS_SCALE_MIN'),
    '_applyTileScale() 里的"其他牌"有收缩系数与下限');
const rebuildBody = body(mainCode, 'private _rebuildTiles(');
check(rebuildBody.length > 0, '_rebuildTiles() 能定位到');
check(['_refreshHand', '_refreshAIHand', '_refreshDiscard', '_refreshAIDiscard', '_refreshMelds']
    .every(f => rebuildBody.indexOf(f) >= 0),
    '_rebuildTiles() 覆盖手牌 / 牌河 / 副露');
check(rebuildBody.includes('_dealing'), '_rebuildTiles() 在发牌动画期间跳过(不打断飞入)');
// 左右家牌河的 x 不再是写死的 340, 而是按净空反推 —— 别又退回硬编码
const sideXBody = body(mainCode, 'private _sideRiverX(');
check(sideXBody.length > 0, '_sideRiverX() 能定位到');
check(sideXBody.includes('SIDE_RIVER_GAP') && sideXBody.includes('RIVER_COLS')
    && sideXBody.includes('SIDE_EDGE_TILT'),
    '_sideRiverX() 用"净空 + 牌河宽度 + 倾斜探出量"反推');
check(sideXBody.includes('Math.min'), '_sideRiverX() 被上限夹住(只许往桌心靠, 不许往外退)');
check(applyLayout.includes('_sideRiverX(rivH)'), '_applyLayout() 用 _sideRiverX 定位左右家牌河');
check(/setPosition\(i === 1 \? -sideRiverX : sideRiverX/.test(applyLayout),
    '左右家牌河按反推值镜像摆放');
// 桌面绘制与牌位上限必须共用同一组常量, 否则改桌面大小会漏
const tableBody = body(mainCode, 'private _buildTable(');
check(tableBody.includes('this.TABLE_NEAR_HH') && tableBody.includes('this.TABLE_FAR_HH'),
    '_buildTable() 用的是同一组 TABLE_* 常量');

// ---------------------------------------------------------------- E 组
console.log('\n[E] 放大后的牌不撞常驻 UI(横向最坏情况)');
// 「听牌 / 提示」已挪到**副露行左侧**: 右缘 = -840 + LEFT_BTN_PAD + 120 + 14 + 120
const btnRight = -CONTENT_HALF_W + LEFT_BTN_PAD + HINT_BTN_W * 2 + HINT_BTN_GAP;
// 手牌行的右端是常驻的「你·听」标记 —— 满手 14 张必须让开它的内缘
const markInner = CONTENT_HALF_W - TENPAI_MARK_INSET - TENPAI_MARK_W / 2;
// 听牌芯片: 抬到手牌上方后, 右缘贴内容边、左边以"满副露"右沿为界
const chipRightWide = CONTENT_HALF_W - CHIP_EDGE_PAD;
for (const [name, aspect] of [['16:9', 16 / 9], ['3:2', 3 / 2], ['4:3', 4 / 3]] as Array<[string, number]>) {
    const halfH = aspectHalfH(aspect);
    const tk = tileScale(halfH);
    const hs = handScale(tk);
    // 手牌按反算倍率; 上家 / 左右家 / 牌河再乘收缩系数(默认 0.9, 纵向不够时更低)
    const th = BASE_TILE_H * tk * hs;
    const others = othersScaleFor(tk, halfH, th);
    const tileW = BASE_TILE_W * tk * hs;
    const topW = BASE_TOP_TILE_W * tk * others;
    const sideW = BASE_SIDE_TILE_W * tk * others;
    const riverW = BASE_RIVER_TILE_W * tk * others;
    const handHalf = (FULL_HAND * tileW) / 2;

    // 1) 满手 14 张 ←→「你·听」标记内缘(右边)/ 内容左缘(左边)
    check(handHalf + HAND_EDGE_GAP <= markInner + 0.01,
        `${name} 满手14张半宽 ${handHalf.toFixed(0)} 让开「你·听」标记内缘 ${markInner.toFixed(0)}`,
        `重叠 ${(handHalf + HAND_EDGE_GAP - markInner).toFixed(1)}px`);
    check(handHalf <= CONTENT_HALF_W - 12,
        `${name} 满手半宽 ${handHalf.toFixed(0)} 不出内容左缘 ${-CONTENT_HALF_W}`);

    // 2) 按钮在副露行左侧: 只可能撞"满副露"的最左沿
    const meldHalfW = (FULL_MELD * riverW) / 2;
    check(btnRight + 12 <= -meldHalfW,
        `${name} 按钮右缘 ${btnRight.toFixed(0)} 让开满副露左沿 ${(-meldHalfW).toFixed(0)}`,
        `重叠 ${(btnRight + 12 + meldHalfW).toFixed(0)}px`);

    // 3) 听牌芯片: 抬到手牌上方, 左界是满副露右沿
    const chipMaxW = chipRightWide - (meldHalfW + 16);
    check(chipMaxW >= 240,
        `${name} 听牌芯片可用宽 ${chipMaxW.toFixed(0)} ≥ 240(不必缩到下限)`,
        `仅 ${chipMaxW.toFixed(0)}px`);

    // 4) 上家 14 张手牌 ←→ 左/右家手牌列(内缘)
    const topHalfW = (FULL_HAND * topW) / 2;
    const sideInner = SIDE_HAND_X - sideW / 2;
    check(topHalfW + 20 < sideInner,
        `${name} 上家手牌半宽 ${topHalfW.toFixed(0)} 不撞侧家手牌列 ${sideInner.toFixed(0)}`,
        `重叠 ${(topHalfW - sideInner).toFixed(0)}px`);

    // 5) 自家/上家 9 张牌河 ←→ 左/右家牌河(内缘) —— 牌放大后最挤的一条。
    //    侧家那块是斜的: 内缘 = x − [(半排长 + 半牌宽)·sin + 半牌高·cos],
    //    不能用 x − 牌宽/2(会高估净空), 见 sideRiverOverhang
    const riverHalfW = (RIVER_COLS * riverW) / 2;
    const rivH = (riverW * BASE_TILE_H) / BASE_TILE_W;
    const sideGap = sideRiverClearance(riverW, rivH);
    check(sideGap >= 0,
        `${name} 侧家牌河内缘 ${(riverHalfW + sideGap).toFixed(0)} 让开牌河外沿 ${riverHalfW.toFixed(0)}(净空 ${sideGap.toFixed(0)})`,
        `重叠 ${(-sideGap).toFixed(0)}px`);

    // 6) 副露最坏情况 16 张仍在内容宽度内
    check(meldHalfW + 20 < CONTENT_HALF_W,
        `${name} 满副露16张半宽 ${meldHalfW.toFixed(0)} 在内容宽度 ${CONTENT_HALF_W} 内`);

    // 7) 侧家 13 张手牌列纵向不超出可见区
    const sideColH = 13 * sideW;
    check(sideColH / 2 + 20 < halfH,
        `${name} 侧家手牌列半高 ${(sideColH / 2).toFixed(0)} 在可见半高 ${halfH.toFixed(0)} 内`);
}

// 4:3 是最"方"的目标屏幕: 牌放大到上限后, 中央转盘仍要拿到满半径(排版不能被挤变形)
{
    const halfH = aspectHalfH(4 / 3);
    const tk = tileScale(halfH);
    const th = BASE_TILE_H * tk * handScale(tk);
    const others43 = othersScaleFor(tk, halfH, th);
    const rivH = (BASE_RIVER_TILE_W * tk * others43 * BASE_TILE_H) / BASE_TILE_W;
    const topTileH = (BASE_TOP_TILE_W * tk * others43 * BASE_TILE_H) / BASE_TILE_W;
    const bottomHalf = bottomHalfOf(halfH);
    const topHalf = topHalfOf(halfH);
    const gap = MELD_MARK_GAP;
    // 复刻 _applyLayout: 底部 手牌 → 副露 → 牌河; 顶部 手牌 → 副露 → 牌河
    const handY = -bottomHalf + th / 2 + 8;
    const meldY = handY + th / 2 + rivH / 2 + gap;
    const discY = meldY + rivH / 2 + rivH / 2 + gap;
    const topHandY = topHalf - 8 - topTileH / 2;
    const topMeldY = topHandY - topTileH / 2 - rivH / 2 - gap;
    const topDiscY = topMeldY - rivH / 2 - rivH / 2 - gap;
    // 上下牌河(各按两行)之间留给转盘的空隙
    const bottomRiverTop = discY + rivH + rivH / 2;
    const topRiverBottom = topDiscY - rivH - rivH / 2;
    const discR = Math.min(TURN_DISC_R_MAX, Math.min(-bottomRiverTop, topRiverBottom) - TURN_DISC_MARGIN);
    check(near(tk, Math.min(TILE_SCALE_MAX, halfH / TILE_REF_HALF_H)),
        `4:3 牌尺寸倍率 ${tk.toFixed(2)}(公式 halfH/${TILE_REF_HALF_H}, 上限 ${TILE_SCALE_MAX})`,
        `实际 ${tk.toFixed(3)}`);
    // 1:1 / 竖屏这种更方的屏幕才会真正撞到上限
    check(near(tileScale(aspectHalfH(1)), TILE_SCALE_MAX),
        `1:1 牌尺寸达到上限 ${TILE_SCALE_MAX}`,
        `实际 ${tileScale(aspectHalfH(1)).toFixed(3)}`);
    check(discR >= TURN_DISC_R_MAX,
        `4:3 牌放大后中央转盘仍拿满半径 ${TURN_DISC_R_MAX}`,
        `实际 ${discR.toFixed(1)}(牌河挤到盘心)`);
}

// 手牌额外放大(HAND_SCALE)会把副露/牌河整体往上推 —— 超宽屏(21:9)最先被挤爆
console.log('\n[F] 超宽屏的中央转盘不会被手牌挤到牌河上');
for (const [name, aspect] of [['21:9', 21 / 9], ['19.5:9', 19.5 / 9], ['16:9', 16 / 9]] as Array<[string, number]>) {
    const halfH = aspectHalfH(aspect);
    const tk = tileScale(halfH);
    const th = BASE_TILE_H * tk * handScale(tk);
    const rivH = (BASE_RIVER_TILE_W * tk * othersScaleFor(tk, halfH, th) * BASE_TILE_H) / BASE_TILE_W;
    const bottomHalf = bottomHalfOf(halfH);
    // 复刻 _applyLayout 的底部三段(手牌 → 副露 → 牌河), 取到牌河上沿的距离
    const handY = -bottomHalf + th / 2 + 8;
    const meldY = handY + th / 2 + rivH / 2 + MELD_MARK_GAP;
    const discY = meldY + rivH / 2 + rivH / 2 + MELD_MARK_GAP;
    const riverTop = discY + rivH + rivH / 2;
    const room = -riverTop;
    // 转盘半径取 min(上限, room - 呼吸); 半径下限 30 不能超过 room, 否则盘会压牌
    const discR = Math.max(TURN_DISC_R_MIN, Math.min(TURN_DISC_R_MAX, room - TURN_DISC_MARGIN));
    check(discR <= room,
        `${name} 转盘半径 ${discR.toFixed(1)} ≤ 到牌河的距离 ${room.toFixed(1)}`,
        `压牌 ${(discR - room).toFixed(1)}px`);
}

console.log('\n[G] 左右家弃牌河"往桌心靠": 内缘净空恒定, 且绝不越过老位置');
for (const [name, aspect] of [['21:9', 21 / 9], ['19.5:9', 19.5 / 9], ['16:9', 16 / 9],
    ['3:2', 3 / 2], ['4:3', 4 / 3]] as Array<[string, number]>) {
    const halfH = aspectHalfH(aspect);
    const tk = tileScale(halfH);
    const riverW = BASE_RIVER_TILE_W * tk * othersScaleFor(tk, halfH, BASE_TILE_H * tk * handScale(tk));
    const rivH = (riverW * BASE_TILE_H) / BASE_TILE_W;
    const x = sideRiverX(riverW, rivH);
    const gap = sideRiverClearance(riverW, rivH);
    const overhang = sideRiverOverhang(riverW, rivH);
    check(x <= SIDE_RIVER_X_MAX + 1e-6,
        `${name} 侧家牌河 x=${x.toFixed(0)} 不越过老位置 ${SIDE_RIVER_X_MAX}(只往桌心靠)`,
        `跑到了 ${x.toFixed(0)}`);
    check(gap >= 0, `${name} 与自家/上家牌河净空 ${gap.toFixed(0)} ≥ 0(倾斜探出 ${overhang.toFixed(0)} 已扣掉)`,
        `重叠 ${(-gap).toFixed(0)}px`);
    if (tk <= 1.001) {
        // 手机: 反推值没撞上限, 应该正好贴到 SIDE_RIVER_GAP, 且比老位置至少挪 40px
        check(near(gap, SIDE_RIVER_GAP, 0.5), `${name} 净空 = SIDE_RIVER_GAP ${SIDE_RIVER_GAP}`,
            `实际 ${gap.toFixed(1)}`);
        check(x <= SIDE_RIVER_X_MAX - 40,
            `${name} 侧家牌河 ${x.toFixed(0)} 比老位置 ${SIDE_RIVER_X_MAX} 靠桌心 ${(SIDE_RIVER_X_MAX - x).toFixed(0)}px(≥40)`,
            `只挪了 ${(SIDE_RIVER_X_MAX - x).toFixed(0)}px`);
    }
    console.log(`     ${name.padEnd(7)} 牌宽 ${riverW.toFixed(0)} → x=${x.toFixed(0)} 内缘 ${(x - overhang).toFixed(0)} 净空 ${gap.toFixed(0)}`);
}

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
process.exit(fails === 0 ? 0 : 1);
