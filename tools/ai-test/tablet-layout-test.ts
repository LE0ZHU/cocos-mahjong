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
/** 自家手牌的额外放大倍率(只作用于手牌, 见 Main.HAND_SCALE) */
const HAND_SCALE = num(mainCode, /HAND_SCALE\s*=\s*([\d.]+)/, 'HAND_SCALE');
const TABLE_NEAR_HH = num(mainCode, /TABLE_NEAR_HH\s*=\s*([\d.]+)/, 'TABLE_NEAR_HH');
const TABLE_FAR_HH = num(mainCode, /TABLE_FAR_HH\s*=\s*([\d.]+)/, 'TABLE_FAR_HH');
const FELT_TILE_TOP = num(mainCode, /FELT_TILE_TOP\s*=\s*([\d.]+)/, 'FELT_TILE_TOP');
const FELT_TILE_BOTTOM = num(mainCode, /FELT_TILE_BOTTOM\s*=\s*([\d.]+)/, 'FELT_TILE_BOTTOM');
// 手牌两侧的常驻元素(它们的位置不能动, 牌只能放大到"不撞它们"为止)
const HINT_BTN_W = num(mainCode, /HINT_BTN_W\s*=\s*([\d.]+)/, 'HINT_BTN_W');
const HINT_BTN_GAP = num(mainCode, /HINT_BTN_GAP\s*=\s*([\d.]+)/, 'HINT_BTN_GAP');
const RIICHI_X_OFFSET = num(mainCode, /riichiX\s*=\s*-halfW\s*\+\s*([\d.]+)/, 'riichiX 偏移');
const TENPAI_HAND_GAP = num(mainCode, /TENPAI_HAND_GAP\s*=\s*([\d.]+)/, 'TENPAI_HAND_GAP');
const LEFT_BTN_PAD = num(mainCode, /LEFT_BTN_PAD\s*=\s*([\d.]+)/, 'LEFT_BTN_PAD');
const CHIP_EDGE_PAD = num(mainCode, /CHIP_EDGE_PAD\s*=\s*([\d.]+)/, 'CHIP_EDGE_PAD');
const MELD_MARK_GAP = num(mainCode, /MELD_MARK_GAP\s*=\s*([\d.]+)/, 'MELD_MARK_GAP');
const TURN_DISC_R_MAX = num(mainCode, /TURN_DISC_R_MAX\s*=\s*([\d.]+)/, 'TURN_DISC_R_MAX');
const TURN_DISC_R_MIN = num(mainCode, /TURN_DISC_R_MIN\s*=\s*([\d.]+)/, 'TURN_DISC_R_MIN');
const TURN_DISC_MARGIN = num(mainCode, /TURN_DISC_MARGIN\s*=\s*([\d.]+)/, 'TURN_DISC_MARGIN');
/** 左/右家手牌列 / 弃牌河的 x(来自 Main.AI_LAYOUT) */
const SIDE_HAND_X = 620;
const SIDE_RIVER_X = 340;
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
    check(near(BASE_TILE_W * tk * HAND_SCALE, BASE_TILE_W * HAND_SCALE) &&
        near(BASE_TILE_H * tk * HAND_SCALE, BASE_TILE_H * HAND_SCALE),
        `${name} 手牌 = 基准 × HAND_SCALE ${HAND_SCALE}`,
        `实际 ${(BASE_TILE_W * tk * HAND_SCALE).toFixed(1)}×${(BASE_TILE_H * tk * HAND_SCALE).toFixed(1)}`);
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
check(applyLayout.includes('_applyTileScale(halfH)'), '_applyLayout() 同时算牌尺寸倍率');
check(applyLayout.includes('FELT_TILE_TOP') && applyLayout.includes('FELT_TILE_BOTTOM'),
    '_applyLayout() 用 FELT_TILE_TOP / FELT_TILE_BOTTOM 夹牌位');
check(/handY\s*=\s*-bottomHalf/.test(applyLayout), 'handY 用夹过的 bottomHalf');
check(/topHandY\s*=\s*topHalf/.test(applyLayout), 'topHandY 用夹过的 topHalf');
check(applyLayout.includes('_rebuildTiles'), '_applyLayout() 在倍率变化后重建牌(否则牌尺寸改了不生效)');
// 平板要让位: 手牌行两侧的按钮 / 芯片不挪走, 牌就永远卡在 1.14
check(applyLayout.includes('wideTiles'), '_applyLayout() 分出"牌被放大"的平板分支');
check(applyLayout.includes('LEFT_BTN_PAD'), '平板分支把听牌/提示按钮竖排贴左边缘');
const chipBody = body(mainCode, 'private _placeTenpaiChip(');
check(chipBody.includes('CHIP_EDGE_PAD') && chipBody.includes('TENPAI_MARK_H'),
    '_placeTenpaiChip() 贴内容右边缘, 并抬到「你·听」标记上方(横向错开手牌)');
const scaleBody = body(mainCode, 'private _applyTableScale(');
check(scaleBody.includes('setScale'), '_applyTableScale() 真的缩放了桌面节点');
check(scaleBody.includes('TABLE_FAR_HH'), '_applyTableScale() 用 TABLE_FAR_HH 算倍率');
const tileScaleBody = body(mainCode, 'private _applyTileScale(');
check(tileScaleBody.length > 0, '_applyTileScale() 能定位到');
check(tileScaleBody.includes('TILE_SCALE_MAX') && tileScaleBody.includes('TILE_REF_HALF_H'),
    '_applyTileScale() 用同一组倍率常量');
check(['TILE_W', 'TILE_H', 'TOP_TILE_W', 'SIDE_TILE_W', 'RIVER_TILE_W']
    .every(f => tileScaleBody.indexOf(`this.${f} = this.BASE`) >= 0),
    '_applyTileScale() 覆盖了全部五档牌尺寸');
const rebuildBody = body(mainCode, 'private _rebuildTiles(');
check(rebuildBody.length > 0, '_rebuildTiles() 能定位到');
check(['_refreshHand', '_refreshAIHand', '_refreshDiscard', '_refreshAIDiscard', '_refreshMelds']
    .every(f => rebuildBody.indexOf(f) >= 0),
    '_rebuildTiles() 覆盖手牌 / 牌河 / 副露');
check(rebuildBody.includes('_dealing'), '_rebuildTiles() 在发牌动画期间跳过(不打断飞入)');
// 桌面绘制与牌位上限必须共用同一组常量, 否则改桌面大小会漏
const tableBody = body(mainCode, 'private _buildTable(');
check(tableBody.includes('this.TABLE_NEAR_HH') && tableBody.includes('this.TABLE_FAR_HH'),
    '_buildTable() 用的是同一组 TABLE_* 常量');

// ---------------------------------------------------------------- E 组
console.log('\n[E] 放大后的牌不撞常驻 UI(横向最坏情况)');
// 手机: 两个按钮横排, "提示"右缘 = -840 + 115 + 120 + 14 + 60
const hintRightMobile = -CONTENT_HALF_W + RIICHI_X_OFFSET + HINT_BTN_W + HINT_BTN_GAP + HINT_BTN_W / 2;
// 平板: 竖排贴左边缘, 右缘 = -840 + 20 + 120
const stackRight = -CONTENT_HALF_W + LEFT_BTN_PAD + HINT_BTN_W;
// 平板: 听牌芯片右缘贴内容边
const chipRightWide = CONTENT_HALF_W - CHIP_EDGE_PAD;
// 手机(k = 1)仍走横排按钮, 老约束必须继续成立
check((FULL_HAND * BASE_TILE_W) / 2 + 28 <= -hintRightMobile,
    `手机 满手14张半宽 ${((FULL_HAND * BASE_TILE_W) / 2).toFixed(0)} 让开横排按钮右缘 ${(-hintRightMobile).toFixed(0)}`,
    `净空只剩 ${(-hintRightMobile - (FULL_HAND * BASE_TILE_W) / 2).toFixed(1)}px`);
check(-CONTENT_HALF_W + LEFT_BTN_PAD >= -CONTENT_HALF_W,
    `平板竖排按钮左缘 ${(-CONTENT_HALF_W + LEFT_BTN_PAD).toFixed(0)} 在内容坐标内`);
for (const [name, aspect] of [['3:2', 3 / 2], ['4:3', 4 / 3]] as Array<[string, number]>) {
    const halfH = aspectHalfH(aspect);
    const tk = tileScale(halfH);
    // 手牌额外乘 HAND_SCALE; 上家 / 左右家 / 牌河只看 tk
    const tileW = BASE_TILE_W * tk * HAND_SCALE;
    const topW = BASE_TOP_TILE_W * tk;
    const sideW = BASE_SIDE_TILE_W * tk;
    const riverW = BASE_RIVER_TILE_W * tk;

    // 1) 满手 14 张手牌 ←→ 左侧竖排按钮右缘(留 24px 呼吸)
    const handRight = (FULL_HAND * tileW) / 2;
    check(handRight + 24 <= -stackRight,
        `${name} 满手14张半宽 ${handRight.toFixed(0)} 让开竖排按钮右缘 ${(-stackRight).toFixed(0)}`,
        `净空只剩 ${(-stackRight - handRight).toFixed(1)}px`);

    // 2) 听牌芯片(平板分支): 右缘贴内容边, 左边以满手 14 张为界
    const chipMaxW = chipRightWide - (handRight + TENPAI_HAND_GAP);
    check(chipMaxW >= 150,
        `${name} 听牌芯片可用宽 ${chipMaxW.toFixed(0)} ≥ 150(缩放下限之上)`,
        `仅 ${chipMaxW.toFixed(0)}px`);

    // 3) 上家 14 张手牌 ←→ 左/右家手牌列(内缘)
    const topHalfW = (FULL_HAND * topW) / 2;
    const sideInner = SIDE_HAND_X - sideW / 2;
    check(topHalfW + 20 < sideInner,
        `${name} 上家手牌半宽 ${topHalfW.toFixed(0)} 不撞侧家手牌列 ${sideInner.toFixed(0)}`,
        `重叠 ${(topHalfW - sideInner).toFixed(0)}px`);

    // 4) 自家/上家 9 张牌河 ←→ 左/右家牌河(内缘) —— 牌放大后最挤的一条
    const riverHalfW = (9 * riverW) / 2;
    const sideRiverInner = SIDE_RIVER_X - riverW / 2;
    check(riverHalfW + 20 < sideRiverInner,
        `${name} 牌河半宽 ${riverHalfW.toFixed(0)} 不撞侧家牌河 ${sideRiverInner.toFixed(0)}`,
        `重叠 ${(sideRiverInner - riverHalfW).toFixed(0)}px 余量不足`);

    // 5) 副露最坏情况 16 张仍在内容宽度内
    const meldHalfW = (FULL_MELD * riverW) / 2;
    check(meldHalfW + 20 < CONTENT_HALF_W,
        `${name} 满副露16张半宽 ${meldHalfW.toFixed(0)} 在内容宽度 ${CONTENT_HALF_W} 内`);

    // 6) 侧家 13 张手牌列纵向不超出可见区
    const sideColH = 13 * sideW;
    check(sideColH / 2 + 20 < halfH,
        `${name} 侧家手牌列半高 ${(sideColH / 2).toFixed(0)} 在可见半高 ${halfH.toFixed(0)} 内`);
}

// 4:3 是最"方"的目标屏幕: 牌放大到上限后, 中央转盘仍要拿到满半径(排版不能被挤变形)
{
    const halfH = aspectHalfH(4 / 3);
    const tk = tileScale(halfH);
    const th = BASE_TILE_H * tk * HAND_SCALE;
    const rivH = (BASE_RIVER_TILE_W * tk * BASE_TILE_H) / BASE_TILE_W;
    const topTileH = (BASE_TOP_TILE_W * tk * BASE_TILE_H) / BASE_TILE_W;
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
    const th = BASE_TILE_H * tk * HAND_SCALE;
    const rivH = (BASE_RIVER_TILE_W * tk * BASE_TILE_H) / BASE_TILE_W;
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

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
process.exit(fails === 0 ? 0 : 1);
