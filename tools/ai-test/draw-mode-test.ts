/**
 * 抽牌模式复核 —— 从真实源码提取常量 + 用真 DrawGame 模拟整局
 *
 * 复核四组(对应 2026-10-18 的三项优化):
 *  1. 分帧建牌/销牌: 每帧批量有界、回合交接不再按定值排程、代次号作废旧 chunk
 *  2. 收牌列几何: 各分辨率下 34 张代表牌摆得下、不压牌阵、不出内容区
 *  3. 收牌排序: 按 sortKey 从大到小、同分稳定(用真 DrawGame 模拟一整局验证)
 *  4. 接线: _applyDraw 收牌 / start 清侧栏 / 玩法说明页两侧分列文案同源
 *
 * 【为什么要跑数字】侧栏是"每列几张 × 最多几列"的算术, 超宽屏列数会变多、
 * 竖屏一列见底 —— 电脑上肉眼只看当前这一版, 各比例的容量必须断言。
 */
import { DrawGame, DRAW_ROWS, DRAW_COLS, DRAW_CELLS, tilePoint } from '../../assets/scripts/game/DrawGame';
import { Tile } from '../../assets/scripts/core/Tile';
import { TileSuit } from '../../assets/scripts/core/TileDefine';

declare const require: (m: string) => any;
declare const __dirname: string;
declare const process: { exit(code: number): never };
const fs = require('fs');
const path = require('path');

function findFile(rel: string): string {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        const p = path.join(dir, ...rel.split('/'));
        if (fs.existsSync(p)) return p;
        dir = path.dirname(dir);
    }
    throw new Error(`找不到 ${rel}`);
}

const src = fs.readFileSync(findFile('assets/scripts/ui/DrawModeUI.ts'), 'utf8');
const helpSrc = fs.readFileSync(findFile('assets/scripts/ui/MenuUI.ts'), 'utf8');

let fails = 0;
function check(cond: boolean, name: string, extra = ''): void {
    if (cond) console.log(`  [OK] ${name}`);
    else { fails++; console.log(`  [FAIL] ${name}${extra ? ' → ' + extra : ''}`); }
}

/** 从源码里取数值常量(模块级 const 与类字段都认, 表达式递归求值) */
const constCache: Record<string, number> = {};
function num(file: string, name: string): number {
    const key = `${name}@${file.length}`;
    if (constCache[key] !== undefined) return constCache[key];
    const m = new RegExp(`(?:const|readonly)\\s+${name}\\s*(?::[^=]*)?=\\s*([^;\\n]+);`).exec(file);
    if (!m) throw new Error(`源码里找不到常量 ${name}`);
    const expr = m[1].trim().replace(/,$/, '');
    let v: number;
    if (/^-?[\d.]+$/.test(expr)) {
        v = Number(expr);
    } else {
        const args: string[] = [];
        const vals: number[] = [];
        for (const ref of expr.match(/[A-Z][A-Z0-9_]*/g) || []) {
            if (args.indexOf(ref) >= 0) continue;
            if (!new RegExp(`(?:const|readonly)\\s+${ref}\\s*(?::[^=]*)?=`).test(file)) continue;
            args.push(ref);
            vals.push(num(file, ref));
        }
        v = Number(new Function(...args, `return (${expr});`)(...vals));
    }
    if (Number.isNaN(v)) throw new Error(`常量 ${name} 求值失败: ${expr}`);
    constCache[key] = v;
    return v;
}

function stripComments(s: string): string {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// ---- 提取真实常量 ----
const CONTENT_W = num(src, 'CONTENT_W');
const GRID_MARGIN_X = num(src, 'GRID_MARGIN_X');
const GRID_TOP_OFFSET = num(src, 'GRID_TOP_OFFSET');
const GRID_BOTTOM_PAD = num(src, 'GRID_BOTTOM_PAD');
// 阵型行/列数直接 import(唯一真源在 core/game 层, 不从 UI 源码抄)
const TILE_W_MAX = num(src, 'TILE_W_MAX');
const TILE_W_MIN = num(src, 'TILE_W_MIN');
const TILE_SCALE_MAX = num(src, 'TILE_SCALE_MAX');
const TILE_REF_HALF_H = num(src, 'TILE_REF_HALF_H');
const BUILD_BATCH = num(src, 'BUILD_BATCH');
const CLEAR_BATCH = num(src, 'CLEAR_BATCH');
const SIDE_W_MAX = num(src, 'SIDE_W_MAX');
const SIDE_W_MIN = num(src, 'SIDE_W_MIN');
const SIDE_COL_GAP = num(src, 'SIDE_COL_GAP');
const SIDE_ROW_GAP = num(src, 'SIDE_ROW_GAP');
const SIDE_PAD = num(src, 'SIDE_PAD');
const SIDE_INNER_PAD = num(src, 'SIDE_INNER_PAD');
const SIDE_EDGE_PAD = num(src, 'SIDE_EDGE_PAD');
const SIDE_TOP_GAP = num(src, 'SIDE_TOP_GAP');
const SIDE_TAG_H = num(src, 'SIDE_TAG_H');
const SIDE_TAG_GAP = num(src, 'SIDE_TAG_GAP');
const HUD_ROW_DY = num(src, 'HUD_ROW_DY');
const HUD_STATUS_DY = num(src, 'HUD_STATUS_DY');
const CHIP_H = num(src, 'CHIP_H');
const CHIP_GAP = num(src, 'CHIP_GAP');
const CHIP_EDGE_PAD = num(src, 'CHIP_EDGE_PAD');
const STATUS_H = num(src, 'STATUS_H');
const STATUS_PAD = num(src, 'STATUS_PAD');
const STATUS_DOT_R = num(src, 'STATUS_DOT_R');
const STATUS_DOT_GAP = num(src, 'STATUS_DOT_GAP');
const ANNOUNCE_FONT = num(src, 'ANNOUNCE_FONT');
const ANNOUNCE_PAD_X = num(src, 'ANNOUNCE_PAD_X');
const ANNOUNCE_IN = num(src, 'ANNOUNCE_IN');
const ANNOUNCE_HOLD = num(src, 'ANNOUNCE_HOLD');
const ANNOUNCE_OUT = num(src, 'ANNOUNCE_OUT');
const ANNOUNCE_GAP = num(src, 'ANNOUNCE_GAP');
const PULSE_TIMES = num(src, 'PULSE_TIMES');
const SIDE_TAG_FONT = num(src, 'SIDE_TAG_FONT');
const SIDE_TAG_PAD = num(src, 'SIDE_TAG_PAD');
const SIDE_PANEL_BOTTOM_MIN = num(src, 'SIDE_PANEL_BOTTOM_MIN');
const SIDE_BOTTOM_PAD = num(src, 'SIDE_BOTTOM_PAD');
const SIDE_MAX = num(src, 'SIDE_MAX');
const COLLECT_FLY = num(src, 'COLLECT_FLY');
const COLLECT_SHIFT = num(src, 'COLLECT_SHIFT');
const INTRO_STAGGER = num(src, 'INTRO_STAGGER');
const INTRO_FLY = num(src, 'INTRO_FLY');

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

/** 复刻 _fitSideW: 从牌库牌宽往下试, 取能装下 SIDE_MAX 张的最大牌宽 */
function fitSideW(tileW: number, stripW: number, tilesTop: number, sideBottom: number) {
    const cap = Math.min(SIDE_W_MAX, Math.round(tileW));
    for (let w = cap; w >= SIDE_W_MIN; w--) {
        const h = (w * 4) / 3;
        const cols = Math.max(1, Math.floor((stripW + SIDE_COL_GAP) / (w + SIDE_COL_GAP)));
        const rows = Math.max(1, Math.floor((tilesTop - sideBottom + SIDE_ROW_GAP) / (h + SIDE_ROW_GAP)));
        if (cols * rows >= SIDE_MAX) return { w, cols, rows };
    }
    const h = (SIDE_W_MIN * 4) / 3;
    return {
        w: SIDE_W_MIN,
        cols: Math.max(1, Math.floor((stripW + SIDE_COL_GAP) / (SIDE_W_MIN + SIDE_COL_GAP))),
        rows: Math.max(1, Math.floor((tilesTop - sideBottom + SIDE_ROW_GAP) / (h + SIDE_ROW_GAP))),
    };
}

/** 复刻 DrawModeUI.applyLayout 的几何: 传入可见半高, 返回牌阵与侧栏的关键尺寸 */
function layoutAt(halfH: number) {
    // 平板按可见半高放大牌宽(手机倍率恒 1) —— 与 applyLayout 同口径
    const tileK = clamp(halfH / TILE_REF_HALF_H, 1, TILE_SCALE_MAX);
    const maxW = TILE_W_MAX * tileK;
    const byW = (CONTENT_W - GRID_MARGIN_X * 2) / DRAW_COLS;
    const gridMaxH = Math.max(140, halfH * 2 - GRID_TOP_OFFSET - GRID_BOTTOM_PAD);
    const byH = (gridMaxH / DRAW_ROWS) * 0.75;
    const tileW = clamp(Math.min(maxW, byW, byH), TILE_W_MIN, maxW);
    const gridW = DRAW_COLS * tileW;

    // 面板矩形(正数口径)与内部布局: 标签浮在面板上方, 面板内只有 SIDE_INNER_PAD 一个内边距;
    // 面板**按装满 34 张所需的大小收缩**(实测每局都收满 34:34, 满局时四边留白才一致)
    const panelX0 = gridW / 2 + SIDE_PAD;
    const tagTop = halfH - SIDE_TOP_GAP;
    const tagCY = tagTop - SIDE_TAG_H / 2;
    const panelTop = tagTop - SIDE_TAG_H - SIDE_TAG_GAP;
    const sideTop = panelTop - SIDE_INNER_PAD;
    const sideBottom = -halfH + SIDE_BOTTOM_PAD;
    const availW = (CONTENT_W / 2 - SIDE_EDGE_PAD) - panelX0;
    const stripW = availW - SIDE_INNER_PAD * 2;
    const fit = fitSideW(tileW, stripW, sideTop, sideBottom);
    const sideW = fit.w;
    const sideH = (sideW * 4) / 3;
    const maxCols = fit.cols;
    const perCol = fit.rows;
    const usedCols = Math.min(fit.cols, Math.ceil(SIDE_MAX / fit.rows));
    const panelW = SIDE_INNER_PAD * 2 + usedCols * sideW + (usedCols - 1) * SIDE_COL_GAP;
    const panelX1 = panelX0 + panelW;
    const capBottom = sideTop - (fit.rows - 1) * (sideH + SIDE_ROW_GAP) - sideH;
    const panelBottom = Math.max(-halfH + SIDE_PANEL_BOTTOM_MIN, capBottom - SIDE_INNER_PAD);
    return {
        halfH, tileW, gridW, sideW, sideH, sideTop, tagCY, sideBottom, perCol, maxCols, stripW,
        panelX0, panelX1, panelTop, panelBottom, usedCols, capBottom,
    };
}

// ================================================================ 1
console.log('\n[1] 分帧建牌/销牌: 批量有界 + 交接按实际落地时刻排程');
{
    check(BUILD_BATCH >= 8 && BUILD_BATCH <= 32,
        `每帧建 ${BUILD_BATCH} 张(8~32: 少了帧数过多, 多了又卡)`);
    check(CLEAR_BATCH >= 8 && CLEAR_BATCH <= 48, `每帧销毁 ${CLEAR_BATCH} 张(同样有界)`);
    // 136 张的分帧耗时: 帧数 × 帧间隔 ≈ 16.7ms
    const frames = Math.ceil(DRAW_CELLS / BUILD_BATCH);
    check(frames <= 12, `建牌分 ${frames} 帧(≤ 12 帧 ≈ ${(frames * 16.7 / 1000).toFixed(2)}s 摊开, 不再一帧卡完)`);
    check(!/INTRO_TOTAL/.test(stripComments(src)), '定值 INTRO_TOTAL 已删除(分帧后落地时刻由最后一块 chunk 排)');

    const code = stripComments(src);
    check(/_buildSeq = 0/.test(code) && /const seq = \+\+this\._buildSeq/.test(code),
        '建牌有代次号(chunk 回调靠它作废)');
    check(/if \(seq !== this\._buildSeq\) return;/.test(code), 'chunk 回调先校验代次号再动手');
    check(/lastDelay \+ INTRO_FLY \+ 0\.05/.test(code), '回合交接排在最后一张牌落地之后');
    check(/scheduleOnce\(step, CLEAR_FADE \+ 0\.02\)/.test(code), '旧牌淡出后再分帧销毁');
    // ⚠️ 引擎 Scheduler 对"同一 target + 同一回调引用"去重: 一次性定时器触发完就自我
    // 移除, 所以分帧回调若用**同一个闭包**自我递归 scheduleOnce, 第 2 帧的排程会被
    // 吞掉 —— 真机上表现为"摆了两排零两个(恰好 2×18 张)就卡住"。必须每帧包新箭头。
    check(!/scheduleOnce\(step, 0\)/.test(code), '不存在同闭包自我递归 scheduleOnce(step, 0)(调度器会去重吞掉)');
    const wrapped = (code.match(/scheduleOnce\(\(\) => step\(\), 0\)/g) || []).length;
    check(wrapped === 2, `建牌/销毁两处都改为新闭包排程(实测 ${wrapped} 处)`);
    // 摆牌总时长仍要短(动画分帧加长有限): 最后一张延迟 + 飞行
    const introTotal = (DRAW_CELLS - 1) * INTRO_STAGGER + INTRO_FLY + frames * 0.0167;
    check(introTotal <= 2.6, `摆牌总时长(含分帧) ${(introTotal).toFixed(2)}s ≤ 2.6s(与发牌动画同一上限口径)`);
}

// ================================================================ 2
console.log('\n[2] 收牌列几何: 各分辨率 34 张摆得下、不压牌阵、不出内容区');
{
    // 内容半高 840 / 屏幕宽高比: 21:9 手机 / 19.5:9 / 16:9 / 3:2 平板 / 4:3 / 竖屏
    const ratios: [string, number][] = [
        ['21:9 超宽', 350], ['19.5:9', 387], ['16:9', 472],
        ['3:2 平板', 560], ['4:3 平板', 630], ['竖屏', 1867],
    ];
    for (const [name, halfH] of ratios) {
        const L = layoutAt(halfH);
        check(L.perCol * L.maxCols >= SIDE_MAX,
            `[${name}] 容量 ${L.perCol}×${L.maxCols}=${L.perCol * L.maxCols} ≥ ${SIDE_MAX} 张`,
            `perCol=${L.perCol} maxCols=${L.maxCols}`);
        // 第一列不压牌阵, 且与牌阵边缘保持"隔离带"宽(牌阵边缘 → 面板内缘 → 首列牌)
        const firstX = L.gridW / 2 + SIDE_PAD + SIDE_INNER_PAD + L.sideW / 2;
        const gapToGrid = SIDE_PAD + SIDE_INNER_PAD;
        check(gapToGrid >= 50, `[${name}] 首列牌左缘距牌阵边缘 ${gapToGrid}(≥ 50, 不再贴着牌库)`);
        check(firstX > L.gridW / 2, `[${name}] 首列中心 ${firstX.toFixed(0)} 在牌阵边缘 ${L.gridW.toFixed(0)} 之外`);
        // 收牌全落在面板内: 四边留白必须都是 SIDE_INNER_PAD(用户反馈过"顶部留白偏大")
        check(Math.abs((firstX - L.sideW / 2) - L.panelX0 - SIDE_INNER_PAD) < 0.01,
            `[${name}] 首列牌离面板内缘 ${SIDE_INNER_PAD}(与顶边 / 底边同宽)`);
        check(Math.abs(L.panelTop - L.sideTop - SIDE_INNER_PAD) < 0.01,
            `[${name}] 首行牌离面板顶边 ${SIDE_INNER_PAD}(不再被标题挤成两倍)`);
        check(L.tagCY - SIDE_TAG_H / 2 >= L.panelTop + SIDE_TAG_GAP - 0.01,
            `[${name}] 归属标签浮在面板**上方**(不占面板内部空间)`);
        // 最远一列不出内容区(容下 SIDE_MAX 张时列数 ≤ maxCols)
        const lastCol = Math.ceil(SIDE_MAX / L.perCol) - 1;
        const lastX = firstX + lastCol * (L.sideW + SIDE_COL_GAP);
        check(lastX + L.sideW / 2 <= CONTENT_W / 2 - SIDE_EDGE_PAD + 0.01,
            `[${name}] 最远列右缘 ${(lastX + L.sideW / 2).toFixed(0)} ≤ 面板外缘 ${CONTENT_W / 2 - SIDE_EDGE_PAD}`,
            `lastCol=${lastCol}`);
        // 槽位纵向不出屏
        const topSlotTop = L.sideTop;
        const rows = Math.min(SIDE_MAX, L.perCol);
        const bottomSlotBottom = L.sideTop - (rows - 1) * (L.sideH + SIDE_ROW_GAP) - L.sideH;
        check(bottomSlotBottom >= -halfH - 0.01,
            `[${name}] 最底槽位底边 ${bottomSlotBottom.toFixed(0)} ≥ 屏幕下缘 ${-halfH}`);
        void topSlotTop;
        // 面板: 包住全部收牌牌, 且不出屏
        check(bottomSlotBottom >= L.panelBottom - 0.01,
            `[${name}] 面板底 ${L.panelBottom.toFixed(0)} 包住最底一张牌`);
        check(L.panelBottom >= -halfH - 0.01, `[${name}] 面板底不出屏`);
        check(L.panelX1 - L.panelX0 > 0, `[${name}] 面板宽 ${(L.panelX1 - L.panelX0).toFixed(0)} > 0`);
        // 满局(34:34 是常态, 实测每局都收满)时四边留白一致
        check(Math.abs((L.panelX1 - (lastX + L.sideW / 2)) - SIDE_INNER_PAD) < 0.01,
            `[${name}] 满局时末列右缘距面板外缘 ${SIDE_INNER_PAD}`);
        check(bottomSlotBottom - L.panelBottom >= SIDE_INNER_PAD - 2,
            `[${name}] 满局时最底牌距面板底 ${(bottomSlotBottom - L.panelBottom).toFixed(0)}(≈ ${SIDE_INNER_PAD})`);
    }
    // 重叠校验: 行距 ≥ 牌高(同一列相邻两张不压)、列距 ≥ 牌宽
    check(SIDE_ROW_GAP >= 0, '行间距非负');
    const L16 = layoutAt(472);
    check(L16.sideW + SIDE_COL_GAP >= L16.sideW, '列间距不挤压牌宽(恒真, 防手滑删常量)');

    // ---- 平板牌幅(2026-10-18): 平板上牌必须明显大于手机, 手机一个像素不变 ----
    check(Math.abs(L16.tileW - TILE_W_MAX) < 0.01,
        `16:9 牌宽 ${L16.tileW.toFixed(1)} == 基准 ${TILE_W_MAX}(手机排版不变)`);
    check(layoutAt(387).tileW <= TILE_W_MAX + 0.01, '19.5:9 牌宽未超过手机基准(仍受纵向限)');
    check(layoutAt(350).tileW <= TILE_W_MAX + 0.01, '21:9 牌宽未超过手机基准(仍受纵向限)');
    for (const [name, halfH] of [['3:2 平板', 560], ['4:3 平板', 630], ['竖屏', 1867]] as [string, number][]) {
        const L = layoutAt(halfH);
        check(L.tileW >= TILE_W_MAX * 1.15,
            `[${name}] 牌宽 ${L.tileW.toFixed(1)} ≥ 手机 ${TILE_W_MAX} 的 1.15 倍(明显更大)`);
        check(L.tileW <= TILE_W_MAX * TILE_SCALE_MAX + 0.01,
            `[${name}] 牌宽 ${L.tileW.toFixed(1)} 不超 ${TILE_SCALE_MAX} 倍上限`);
        // 牌变大后牌阵仍不出屏(顶部固定让开信息区)
        const gridBottom = halfH - GRID_TOP_OFFSET - DRAW_ROWS * (L.tileW * 4 / 3);
        check(gridBottom >= -halfH,
            `[${name}] 牌阵底边 ${gridBottom.toFixed(0)} ≥ 屏幕下缘 ${-halfH}(牌放大后仍不溢出)`);
    }
    // 倍率上限的来历: 再往上(1.4)牌阵占满横向, 侧栏只剩 2 列 × 17 行, 容量刚好卡死没余量
    check(TILE_SCALE_MAX <= 1.37, `倍率上限 ${TILE_SCALE_MAX} 不越过侧栏容量的天花板`);

    // ---- 收牌牌尺寸(2026-10-18): 用户要求"已抽的牌和牌库一样大"(面板已能区分) ----
    check(L16.sideW === Math.round(L16.tileW),
        `16:9 收牌牌宽 ${L16.sideW} == 牌库 ${L16.tileW.toFixed(0)}(一样大)`);
    const LP = layoutAt(1867);
    check(LP.sideW === Math.round(LP.tileW),
        `竖屏 收牌牌宽 ${LP.sideW} == 牌库 ${LP.tileW.toFixed(0)}(一样大)`);
    check(layoutAt(350).sideW >= layoutAt(350).tileW - 2,
        `21:9 收牌牌宽 ${layoutAt(350).sideW} 贴近牌库 ${layoutAt(350).tileW.toFixed(1)}`);
    check(layoutAt(387).sideW >= layoutAt(387).tileW - 4,
        `19.5:9 收牌牌宽 ${layoutAt(387).sideW} 贴近牌库 ${layoutAt(387).tileW.toFixed(1)}`);
    // 平板: 侧栏净空装不下 34 张同尺寸的牌, 退到能装下的最大值(仍要比旧的固定 40 大)
    for (const [name, halfH] of [['3:2 平板', 560], ['4:3 平板', 630]] as [string, number][]) {
        const L = layoutAt(halfH);
        check(L.sideW <= L.tileW, `[${name}] 收牌牌宽 ${L.sideW} ≤ 牌库 ${L.tileW.toFixed(0)}(受容量所限)`);
        check(L.sideW >= 40, `[${name}] 收牌牌宽 ${L.sideW} ≥ 40(不回到旧的固定小尺寸)`);
    }
    // 归属标签塞得进最窄的面板(4:3 平板): "电脑抽的" = 4 个汉字
    const L43 = layoutAt(630);
    const tagW = SIDE_TAG_FONT * 4 + SIDE_TAG_PAD * 2;
    check(tagW <= L43.panelX1 - L43.panelX0,
        `标签宽 ${tagW} ≤ 最窄面板宽 ${(L43.panelX1 - L43.panelX0).toFixed(0)}`);
    // 状态胶囊最长的文案("电脑抽到 九萬 ×2 · +10 分" 约 16 字)不会横穿整个屏幕
    const longStatus = STATUS_PAD * 2 + STATUS_DOT_R * 2 + STATUS_DOT_GAP + 16 * 24;
    check(longStatus < CONTENT_W * 0.5, `最长状态胶囊 ${longStatus} < 半屏宽(不横穿屏幕)`);
}

// ================================================================ 3
console.log('\n[3] 收牌排序: sortKey 从大到小、同分稳定(真 DrawGame 模拟整局)');
{
    // 复刻 _collectTile 的插入逻辑(源码口径): 插在第一张比它小的牌之前
    function insertSorted(arr: Tile[], t: Tile): void {
        const p = tilePoint(t);
        let at = arr.length;
        for (let i = 0; i < arr.length; i++) {
            if (tilePoint(arr[i]) < p) { at = i; break; }
        }
        arr.splice(at, 0, t);
    }

    // 同分稳定性: 相同点数的牌保持先来后到
    const mk = ((id: number) => new Tile(id, TileSuit.WAN, 5));
    const stable: Tile[] = [];
    insertSorted(stable, mk(1));
    insertSorted(stable, mk(2));
    insertSorted(stable, mk(3));
    check(stable.length === 3 && stable[0].id === 1 && stable[2].id === 3,
        '同分牌保持先来后到(稳定插入)');

    // 同点数**不同花色**不按花色分组: 9 条 先抽到就排在 9 萬 前面
    {
        const same: Tile[] = [];
        insertSorted(same, new Tile(200, TileSuit.TONG, 9));
        insertSorted(same, new Tile(201, TileSuit.WAN, 9));
        insertSorted(same, new Tile(202, TileSuit.TIAO, 9));
        check(same.map(t => t.id).join(',') === '200,201,202',
            '同点数不同花色保持抽到先后(不按花色排)');
        // 字牌一律 10 点, 与数牌的 9 点相比排在前面
        insertSorted(same, new Tile(203, TileSuit.FENG, 1));
        check(same[0].id === 203, '字牌(10 点)排在数牌 9 点之前');
    }

    // 多轮插入后整体有序(按点数大 → 小)
    let id = 100;
    const mixed: Tile[] = [];
    const suits = [TileSuit.WAN, TileSuit.TIAO, TileSuit.TONG, TileSuit.FENG, TileSuit.JIAN];
    for (let i = 0; i < 40; i++) {
        const s = suits[i % suits.length];
        const rank = (i * 7) % 9 + 1;
        insertSorted(mixed, new Tile(id++, s, rank));
    }
    let sorted = true;
    for (let i = 1; i < mixed.length; i++) {
        if (tilePoint(mixed[i - 1]) < tilePoint(mixed[i])) { sorted = false; break; }
    }
    check(sorted && mixed.length === 40, `40 张乱序插入后整体按点数有序(${mixed.length} 张)`);

    // 真 DrawGame: 模拟一整局(双方都贪心), 每家收的代表牌 ≤ SIDE_MAX 且与逻辑层一致
    let games = 0;
    let maxSide = 0;
    for (let seed = 0; seed < 20; seed++) {
        const g = new DrawGame();
        let guard = 0;
        while (!g.isOver && guard++ < 200) {
            if (g.seat === 1) {
                const p = g.aiPick();
                if (!p) break;
                g.draw(p.a, p.b);
            } else {
                // 玩家也用贪心(逻辑层验证不需要真 UI)
                const ps = g.pairs();
                if (ps.length === 0) break;
                let best = ps[0];
                for (const p of ps) if (p.value > best.value) best = p;
                g.draw(best.a, best.b);
            }
        }
        games++;
        for (const seat of [0, 1]) {
            const got = g.collected(seat);
            maxSide = Math.max(maxSide, got.length);
            check(got.length <= SIDE_MAX, `第 ${seed} 局 座位 ${seat} 收 ${got.length} 张 ≤ ${SIDE_MAX}`);
            // 逻辑层计分与代表牌一致: 每组记一张, 总分 = Σ点数
            let sum = 0;
            for (const t of got) sum += tilePoint(t);
            check(sum === g.scoreOf(seat), `第 ${seed} 局 座位 ${seat} 分数与代表牌点数一致(${sum})`);
        }
    }
    console.log(`  模拟 ${games} 局, 单侧最多收 ${maxSide} 张(容量上限 ${SIDE_MAX})`);
    check(maxSide <= SIDE_MAX, `实测单侧峰值 ${maxSide} ≤ ${SIDE_MAX}`);
}

// ================================================================ 4
console.log('\n[4] 接线: 收牌飞入 / 新局清侧栏 / 说明页文案同源');
{
    const code = stripComments(src);
    check(/if \(tile\) this\._collectTile\(tile, seat, a\);/.test(code), '_applyDraw 抽牌后收代表牌');
    check(/_clearSides\(\)/.test(code) && code.indexOf('_clearSides()') < code.indexOf('applyLayout(this._halfH)'),
        'start() 开新局先清空两侧收牌列');
    check(/node\.addComponent\(TileView\)\.setData\(tile, -1\);/.test(code), '收牌节点也走 TileView 显示牌面');
    check(/tween\(n\)\.to\(COLLECT_SHIFT, \{ position: this\._sideSlot\(seat, i\) \}/.test(code),
        '插入点之后的牌平滑让位');
    check(/to\(COLLECT_FLY, \{ position: this\._sideSlot\(seat, at\), scale: new Vec3\(1, 1, 1\) \}/.test(code),
        '新牌从牌阵格位飞向侧栏槽位');
    check(COLLECT_FLY >= 0.2 && COLLECT_FLY <= 0.8, `飞行动画 ${COLLECT_FLY}s 在 0.2~0.8s(看得清又不拖沓)`);
    check(COLLECT_SHIFT >= 0.1 && COLLECT_SHIFT <= 0.5, `让位动画 ${COLLECT_SHIFT}s 在 0.1~0.5s`);
    // _removeTileNode 仍在(阵上的两张要消失), 且销毁前先清选中金框
    check(/private _removeTileNode\(index: number\)/.test(code), '阵上被抽走的牌仍有消失动画');

    // 玩法说明: 抽牌段的"两侧分列"文案与实现同口径(电脑在左、你在右、一对一张)
    const help = stripComments(helpSrc);
    check(/电脑在左、你在右, 按点数从大到小排开, 一对只摆一张/.test(help),
        '说明页"两侧分列"文案与实现同口径');
    check(/dir = seat === 1 \? -1 : 1/.test(code), '电脑(seat 1)在左、玩家(seat 0)在右');
    // 排序口径同源: 实时插入与重建都只按**点数**(字牌 10 点), 不掺花色权重
    check(/tiles\.sort\(\(a, b\) => tilePoint\(b\) - tilePoint\(a\)\);/.test(code),
        '重建收牌列按点数降序');
    check(/const point = tilePoint\(tile\);/.test(code) && /if \(tilePoint\(tiles\[i\]\) < point\)/.test(code),
        '实时插入与重建用同一排序口径(点数)');
    check(!/sortKey/.test(code), 'DrawModeUI 里不再出现 sortKey(花色权重只属于麻将理牌)');

    // 两侧收牌区: 整块面板 + 归属标题(2026-10-18 二次反馈 —— 细线小胶囊看不见)
    check(/_repaintSideChrome\(\);/.test(code) && /onShow\(\): void \{[\s\S]*?_repaintSideChrome/.test(code),
        '面板/标签在 onShow + applyLayout 补画(原生平台隐藏期 Graphics 会丢)');
    const chrome = code.slice(code.indexOf('private _repaintSideChrome'), code.indexOf('private _setChip'));
    check(/g\.fillColor = SIDE_PANEL_FILL/.test(chrome) && /roundRect\(cx - w \/ 2, this\._panelBottom, w, h/.test(chrome),
        '每侧画一块实心面板底(不再是背景里那条 2px 细线)');
    check(/g\.strokeColor = SIDE_PANEL_EDGE/.test(chrome), '面板有金色描边(与毡布区分)');
    // 面板必须在收牌牌之下(节点先建 → 渲染层级更低), 否则牌会被面板盖住
    check(code.indexOf("'SidePanelAI'") < code.indexOf("'SideAI'"),
        '面板节点先于收牌容器创建(渲染在牌之下)');
    check(/_makeSideTag\('电脑抽的', true\)/.test(code) && /_makeSideTag\('你抽的', false\)/.test(code),
        '归属标题写明"电脑抽的 / 你抽的"(不是只有一个字)');
    check(/TAG_AI_FILL/.test(chrome) && /TAG_ME_FILL/.test(chrome),
        '两侧标签按归属分色(电脑冷蓝 / 你暖金)');
    check(!/moveTo\(-dx, lineTop\)/.test(code), '旧的背景细线已移除(改由面板边缘分隔)');

    // 收牌尺寸与面板内边距(2026-10-18 第三次反馈)
    check(/private _fitSideW\(stripW: number/.test(code) && /const fit = this\._fitSideW\(/.test(code),
        '收牌尺寸走 _fitSideW(从牌库牌宽往下试, 装不下才退)');
    check(/const cap = Math\.min\(SIDE_W_MAX, Math\.round\(this\._tileW\)\);/.test(code),
        '_fitSideW 的上限就是牌库牌宽(手机上和牌库一样大)');
    check(/const stripW = availW - SIDE_INNER_PAD \* 2;/.test(code),
        '可用宽度扣掉左右各一个 SIDE_INNER_PAD(与顶边同宽)');
    check(/const panelW = SIDE_INNER_PAD \* 2 \+ usedCols \* this\._sideW \+ \(usedCols - 1\) \* SIDE_COL_GAP;/.test(code),
        '面板按装满所需列数收缩(满局时末列右缘也正好留 SIDE_INNER_PAD)');
    check(/const tilesTop = this\._panelTop - SIDE_INNER_PAD;/.test(code),
        '首行牌离面板顶边 = SIDE_INNER_PAD(顶部不再多一截留白)');
    check(/this\._panelTop = tagTop - SIDE_TAG_H - SIDE_TAG_GAP;/.test(code),
        '归属标签浮在面板上方(不占面板内部空间)');

    // 顶部信息区: 两行版式 + 状态胶囊(2026-10-18 第三次反馈: 原来三行 + 一行裸文字太丑)
    check(/this\._chipY = topY;/.test(code), '信息芯片与按钮同一行(顶部从三行压到两行)');
    check(/private _setStatus\(text: string, tone: StatusTone = 'info'\)/.test(code),
        '状态改成带语气的胶囊(你的回合 / 电脑回合 / 中性 / 驳回)');
    const st = code.slice(code.indexOf('private _setStatus'), code.indexOf('private _refreshHud'));
    check(/g\.circle\(-w \/ 2 \+ STATUS_PAD \+ STATUS_DOT_R, 0, STATUS_DOT_R\)/.test(st),
        '胶囊左侧有状态圆点(余光就能看出轮到谁)');
    check(/g\.roundRect\(-w \/ 2, -STATUS_H \/ 2, w, STATUS_H, STATUS_H \/ 2\)/.test(st),
        '状态底是圆角胶囊(不再是裸文字)');
    check(/this\._statusTone = tone;/.test(st) && /this\._statusText = text;/.test(st),
        '文案/语气记下来, 重排时原样重画');

    // 开局"谁先抽"的宣告(2026-10-18 第四次反馈: 先手一闪就过去了, 看不清)
    check(/const wait = this\._showAnnounce\(ai \? '电脑先抽' : '你先抽'/.test(code),
        '_beginTurn 先播先手宣告');
    check(/}, wait\);/.test(code), '宣告播完才把回合交出去(不再一进来就抽)');
    const beginBody = code.slice(code.indexOf('private _beginTurn'), code.indexOf('private _showAnnounce'));
    check(/this\._locked = true;/.test(beginBody) && /this\._locked = false;/.test(beginBody),
        '宣告期间锁输入, 交回玩家时解锁');
    check(/private _showAnnounce\(/.test(code) && /private _pulseSide\(/.test(code)
        && /private _hideAnnounce\(/.test(code), '宣告 / 面板闪烁 / 收起 三个方法齐全');
    const ann = code.slice(code.indexOf('private _showAnnounce'), code.indexOf('private _refreshHud'));
    check(/tween\(node\)\.to\(ANNOUNCE_IN, \{ scale: new Vec3\(1, 1, 1\) \}, \{ easing: 'backOut' \}\)/.test(ann),
        '宣告淡入时带 backOut 弹出');
    check(/this\._pulseSide\(seat\);/.test(ann), '同时让先手一侧的面板闪烁');
    check(ANNOUNCE_IN >= 0.15 && ANNOUNCE_HOLD >= 0.8 && ANNOUNCE_OUT >= 0.15,
        `节奏 ${ANNOUNCE_IN}/${ANNOUNCE_HOLD}/${ANNOUNCE_OUT}s(停留 ≥0.8s 才读得完四个字)`);
    const announceTotal = ANNOUNCE_IN + ANNOUNCE_HOLD + ANNOUNCE_OUT + ANNOUNCE_GAP;
    check(announceTotal >= 1.2 && announceTotal <= 2.6,
        `从摆完牌到回合开始 ${announceTotal.toFixed(2)}s(1.2~2.6s: 看得清又不拖沓)`);
    check(PULSE_TIMES >= 2, `先手一侧闪 ${PULSE_TIMES} 次(至少两下才看得出是"闪")`);
    const pulse = code.slice(code.indexOf('private _pulseSide'), code.indexOf('private _hideAnnounce'));
    check(/this\._sidePanels\[seat\], this\._sideTags\[seat\]/.test(pulse), '闪烁覆盖面板与归属标题');
    check(/ensureOpacity\(n\)/.test(pulse) && /\{ opacity: 110 \}/.test(pulse),
        '用 UIOpacity 变暗再亮回(不动 Graphics, 原生平台也安全)');
    // 复位: 开局 / 中断都要收回宣告并还原透明度, 否则闪到一半停下会留半透明面板
    const newRoundBody = code.slice(code.indexOf('newRound(): void'), code.indexOf('private _beginTurn'));
    check(/_hideAnnounce\(\);/.test(newRoundBody), 'newRound 收起上一局的宣告');
    const abortBody = code.slice(code.indexOf('abort(): void'), code.indexOf('newRound(): void'));
    check(/_hideAnnounce\(\);/.test(abortBody), 'abort(返回主页面)也收起宣告并复位透明度');
    // 宣告胶囊尺寸: "电脑先抽"4 个字 + 左右内边距, 不横穿屏幕
    const annW = ANNOUNCE_FONT * 4 + ANNOUNCE_PAD_X * 2;
    check(annW < CONTENT_W * 0.5, `宣告胶囊宽 ${annW} < 半屏宽(居中不横穿)`);
    // 版式算术: 状态行让开芯片行; 标签让开状态行
    check(HUD_STATUS_DY >= HUD_ROW_DY + CHIP_H / 2 + STATUS_H / 2,
        `状态行(${HUD_STATUS_DY})让开芯片行(${HUD_ROW_DY}+${CHIP_H}/2+${STATUS_H}/2)`);
    check(SIDE_TOP_GAP >= HUD_STATUS_DY + STATUS_H / 2 + 4,
        `标签行(${SIDE_TOP_GAP})让开状态胶囊(${HUD_STATUS_DY}+${STATUS_H}/2)`);
    // 芯片右对齐: 最左一枚的左缘不压到左侧按钮(按钮右缘 -436)
    check(CHIP_EDGE_PAD <= 16, `芯片距右缘 ${CHIP_EDGE_PAD}(贴边排)`);

    // 玩法说明页标签: 首次进入只有"麻将"选中(创建时占位样式 + 构建末尾落定选中态)
    const menuCode = stripComments(helpSrc);
    check(/_styleHelpTabs\(\);[\s\S]{0,80}_createScrollPage\('HelpScrollView'/.test(menuCode),
        '说明页构建末尾调用 _styleHelpTabs() 落定初始选中态');
    check(/_helpTabDraw = createButtonNode\('抽牌', HELP_TAB_W, HELP_TAB_H, LINE_GHOST, MENU_GHOST_STYLE\)/.test(menuCode),
        '两个标签创建时都是未选描边样式(不再都给 BTN_PRIMARY)');
    const setModeBody = menuCode.slice(menuCode.indexOf('private _setHelpMode'),
        menuCode.indexOf('private _paintHelpDividers'));
    check(/_styleHelpTabs\(\);/.test(setModeBody), '切换玩法也走 _styleHelpTabs(选中态只有一处写法)');
}

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
process.exit(fails === 0 ? 0 : 1);

