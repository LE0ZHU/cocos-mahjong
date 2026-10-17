/**
 * 平板(3:2 / iPad 4:3)适配复核
 *
 * 【真实问题】平板上开局后整张桌子缩在屏幕中间, 上下各留一条底色;
 * 而牌位是按"可见半高"贴屏幕边排的, 于是上家手牌整排压过桌沿、自家手牌坐到木框上 ——
 * 看上去就是"牌摆到桌子外面去了"。
 *
 * 根因两条, 都在"牌桌是固定尺寸、牌位却跟着屏幕走":
 *   1) 桌面是固定几何(近端半高 560 / 远端 530), 而可见半高 = 840 / 宽高比。
 *      16:9 时 472 < 530, 桌面上下都被裁掉, 屏幕里看不到桌沿(设计意图);
 *      3:2 时 560 > 530, 整张桌子就露出来了。
 *   2) 牌位直接拿 halfH 当边距, 屏幕越方 halfH 越大 → 牌越贴边 → 出了毡布。
 *
 * 锁住四条不变量(数值从真实源码提取):
 *   A 手机比例(≥16:9)上一根手指都不许动: 桌面缩放 = 1、牌位半高 = 可见半高;
 *   B 桌面永远盖住屏幕: 桌面远端 × 缩放 ≥ 可见半高;
 *   C 上家手牌上沿 / 自家手牌下沿 永远在毡布内;
 *   D 接线: _applyLayout 先算桌面缩放再夹牌位, handY/topHandY 用的是夹过的值。
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

const mainCode = stripComments(fs.readFileSync(findFile('assets/scripts/Main.ts'), 'utf8'));

// ---------------------------------------------------------------- 参数
const CONTENT_W = num(mainCode, /CONTENT_W\s*=\s*([\d.]+)/, 'CONTENT_W');
const TILE_W = num(mainCode, /TILE_W\s*=\s*([\d.]+)/, 'TILE_W');
const TILE_H = num(mainCode, /TILE_H\s*=\s*([\d.]+)/, 'TILE_H');
const TOP_TILE_W = num(mainCode, /TOP_TILE_W\s*=\s*([\d.]+)/, 'TOP_TILE_W');
const TABLE_NEAR_HH = num(mainCode, /TABLE_NEAR_HH\s*=\s*([\d.]+)/, 'TABLE_NEAR_HH');
const TABLE_FAR_HH = num(mainCode, /TABLE_FAR_HH\s*=\s*([\d.]+)/, 'TABLE_FAR_HH');
const FELT_TILE_TOP = num(mainCode, /FELT_TILE_TOP\s*=\s*([\d.]+)/, 'FELT_TILE_TOP');
const FELT_TILE_BOTTOM = num(mainCode, /FELT_TILE_BOTTOM\s*=\s*([\d.]+)/, 'FELT_TILE_BOTTOM');
const CONTENT_HALF_W = CONTENT_W / 2;

// 毡布梯形(_buildTable 里那一层: drawTrapBands(786, 526, ...)), 与桌面同一套透视
const FELT_NEAR_HW = 786;
const FELT_NEAR_HH = 526;
const FELT_FAR_HH = FELT_NEAR_HH * (TABLE_FAR_HH / TABLE_NEAR_HH);   // 497.75
const FAR_RATIO = 0.78;

/** 复刻 Main._applyTableScale */
function tableScale(halfH: number): number {
    return Math.max(1, (halfH + 10) / TABLE_FAR_HH);
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

console.log('\n=== 平板适配复核 ===\n');
console.log(`参数: 内容半宽 ${CONTENT_HALF_W} / 桌面近端半高 ${TABLE_NEAR_HH} / ` +
    `远端 ${TABLE_FAR_HH} / 牌位上限 上${FELT_TILE_TOP} 下${FELT_TILE_BOTTOM} / 牌 ${TILE_W}×${TILE_H}\n`);

// ---------------------------------------------------------------- A 组
console.log('[A] 手机比例(≥16:9)排版不变');
for (const [name, aspect] of [['16:9', 16 / 9], ['19.5:9', 19.5 / 9], ['21:9', 21 / 9]] as Array<[string, number]>) {
    const halfH = aspectHalfH(aspect);
    const k = tableScale(halfH);
    check(k === 1, `${name} 桌面缩放 = 1`, `实际 ${k.toFixed(3)}`);
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
const topTileH = (TOP_TILE_W * TILE_H) / TILE_W;
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
check(applyLayout.includes('FELT_TILE_TOP') && applyLayout.includes('FELT_TILE_BOTTOM'),
    '_applyLayout() 用 FELT_TILE_TOP / FELT_TILE_BOTTOM 夹牌位');
check(/handY\s*=\s*-bottomHalf/.test(applyLayout), 'handY 用夹过的 bottomHalf');
check(/topHandY\s*=\s*topHalf/.test(applyLayout), 'topHandY 用夹过的 topHalf');
const scaleBody = body(mainCode, 'private _applyTableScale(');
check(scaleBody.includes('setScale'), '_applyTableScale() 真的缩放了桌面节点');
check(scaleBody.includes('TABLE_FAR_HH'), '_applyTableScale() 用 TABLE_FAR_HH 算倍率');
// 桌面绘制与牌位上限必须共用同一组常量, 否则改桌面大小会漏
const tableBody = body(mainCode, 'private _buildTable(');
check(tableBody.includes('this.TABLE_NEAR_HH') && tableBody.includes('this.TABLE_FAR_HH'),
    '_buildTable() 用的是同一组 TABLE_* 常量');

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
process.exit(fails === 0 ? 0 : 1);
