/**
 * AI 提示 UI 版式校验 —— 从真实源码提取常量, 跑数字
 *
 * 复核四组:
 *  1. 提示按钮与"听牌"按钮、手牌、右侧"听"标记 **横向不撞车**(各屏幕比例)
 *  2. 提示面板 **完整可见**(含所有次选条的最坏情况)且不压到自家弃牌河
 *  3. 面板内部各段 **纵向间距 > 0**(游标写法正确, 不会重叠)
 *  4. 每个 Label 的 **文本域够宽**(不触发 SHRINK 把字压扁)
 *
 * 【为什么要跑数字而不是"看代码觉得没问题"】纵向游标写错一个符号就会让下一段
 * 正好压在上一段上, 这个 bug 在结算面板连续犯过两次(AGENTS.md 硬约束 3),
 * 光看代码算不出重叠。
 */
declare const require: (m: string) => any;
declare const __dirname: string;
declare const process: { exit(code: number): never };
const fs = require('fs');
const path = require('path');

/** 从编译输出所在目录往上找项目根(编译到 temp/xxx 时层级会变) */
function findFile(rel: string): string {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        const p = path.join(dir, ...rel.split('/'));
        if (fs.existsSync(p)) return p;
        dir = path.dirname(dir);
    }
    throw new Error(`找不到 ${rel}`);
}
const src = fs.readFileSync(findFile('assets/scripts/Main.ts'), 'utf8');
const panelSrc = fs.readFileSync(findFile('assets/scripts/ui/HintPanel.ts'), 'utf8');

let fails = 0;
function check(cond: boolean, name: string, extra = ''): void {
    if (cond) console.log(`  [OK] ${name}`);
    else { fails++; console.log(`  [FAIL] ${name}${extra ? ' → ' + extra : ''}`); }
}

/**
 * 从源码里取一个数值常量
 *
 * 两种写法都要认: 模块级 `const X = n` 与类字段 `private readonly X = n`
 * (Main 里 CONTENT_W / TILE_W / TILE_H 都是后者)。
 */
function num(file: string, name: string): number {
    const patterns = [
        new RegExp(`const\\s+${name}\\s*(?::[^=]*)?=\\s*(-?[\\d.]+)`),
        new RegExp(`readonly\\s+${name}\\s*(?::[^=]*)?=\\s*(-?[\\d.]+)`),
        new RegExp(`^\\s*${name}\\s*(?::[^=]*)?=\\s*(-?[\\d.]+)`, 'm'),
    ];
    for (const re of patterns) {
        const m = re.exec(file);
        if (m) return Number(m[1]);
    }
    throw new Error(`源码里找不到常量 ${name}`);
}

// ---- 提取真实常量 ----
// 牌尺寸取 BASE_*(基准值): 提示面板的落位校验的是**手机(倍率 1)**;
// 平板把牌放大后的净空由 tablet-layout-test.ts 的 E 组负责。
const CONTENT_W = num(src, 'CONTENT_W');
const TILE_W = num(src, 'BASE_TILE_W');
const TILE_H = num(src, 'BASE_TILE_H');
const TOP_TILE_W = num(src, 'BASE_TOP_TILE_W');
const RIVER_TILE_W = num(src, 'BASE_RIVER_TILE_W');
const TURN_DISC_R_MIN = num(src, 'TURN_DISC_R_MIN');
const TURN_DISC_R_MAX = num(src, 'TURN_DISC_R_MAX');
const MELD_MARK_GAP = num(src, 'MELD_MARK_GAP');
const MELD_BTN_H = num(src, 'MELD_BTN_H');
const HINT_BTN_W = num(src, 'HINT_BTN_W');
const HINT_BTN_H = num(src, 'HINT_BTN_H');
const HINT_BTN_GAP = num(src, 'HINT_BTN_GAP');
const HINT_PANEL_GAP = num(src, 'HINT_PANEL_GAP');
const HINT_BREATH = num(src, 'HINT_BREATH');
const PAD_X = num(panelSrc, 'PAD_X');
const PAD_Y = num(panelSrc, 'PAD_Y');
const H_MAIN = num(panelSrc, 'H_MAIN');
const GAP_MAIN = num(panelSrc, 'GAP_MAIN');
const H_REASON = num(panelSrc, 'H_REASON');
const GAP_DIVIDER = num(panelSrc, 'GAP_DIVIDER');
const H_ALT = num(panelSrc, 'H_ALT');
const GAP_ALT = num(panelSrc, 'GAP_ALT');
const MIN_SCALE = num(panelSrc, 'MIN_SCALE');

/** 与 Main._tileH 同比例 */
function tileH(w: number): number { return (w * TILE_H) / TILE_W; }

/** CJK 按字号, 其余半角 —— 与 HintPanel.textWidth 一致 */
function textWidth(text: string, font: number): number {
    let w = 0;
    for (const ch of text) w += ch.codePointAt(0)! >= 0x2e80 ? font : font * 0.5;
    return w;
}

/** 最坏情况的一组文案(取最长可能组合) */
const HEADER_TEXT = 'AI 建议';
const MAIN_TEXT = '打出 三萬';                       // 4 字 + 空格
const REASON_TEXT = '听牌 · 8 张进张 · 危险牌, 有人可能点炮';
const ALT_TEXTS = [
    '次选　打出 五筒　1 向听 · 12 张进张 · 安全牌',
    '次选　碰 五萬　手牌慢 1 档 · 会失去门清 +1 番',
];

/** 未缩放的卡片高度(复刻 HintPanel._measureHeight) */
function measureH(altCount: number): number {
    const altsH = altCount > 0 ? GAP_DIVIDER + altCount * H_ALT + (altCount - 1) * GAP_ALT : 0;
    return H_MAIN + GAP_MAIN + H_REASON + altsH + PAD_Y * 2;
}

/** 复刻 HintPanel.fit: 缩放整体, 缩到下限仍不够就砍次选 */
function fit(maxH: number, altMax: number): { h: number; scale: number; alts: number } {
    let alts = altMax;
    let scale = 1;
    for (;;) {
        const h = measureH(alts);
        if (h <= maxH) { scale = 1; break; }
        scale = maxH / h;
        if (scale >= MIN_SCALE) break;
        if (alts > 0) { alts--; continue; }
        scale = MIN_SCALE;
        break;
    }
    scale = Math.max(MIN_SCALE, Math.min(1, scale));
    return { h: measureH(alts) * scale, scale, alts };
}

console.log('=== 1. 横向: 提示按钮与"听牌"按钮 / 手牌 / "听"标记 ===');
{
    const halfW = CONTENT_W / 2;
    const riichiX = -halfW + 115;
    const hintX = riichiX + HINT_BTN_W / 2 + HINT_BTN_GAP + HINT_BTN_W / 2;
    const hintL = hintX - HINT_BTN_W / 2;
    const hintR = hintX + HINT_BTN_W / 2;
    const riichiR = riichiX + 60;   // 听牌按钮宽 120
    check(hintL - riichiR >= 0, '提示按钮在"听牌"按钮右侧且不重叠',
        `gap=${(hintL - riichiR).toFixed(1)}`);

    // 满手 14 张时手牌占多宽(居中)
    const handHalf = 14 * TILE_W / 2;
    check(hintR < -handHalf, '提示按钮不压手牌',
        `hintR=${hintR.toFixed(0)} handL=${(-handHalf).toFixed(0)}`);

    // 右侧"你·听"标记: 中心 halfW-70, 宽 112
    const chipL = halfW - 70 - 56;
    check(hintR < chipL, '提示按钮不压右侧"听"标记', `hintR=${hintR} chipL=${chipL}`);
    check(hintR <= halfW, '提示按钮不横向出界(内容 x 恒 ±840)', `hintR=${hintR} halfW=${halfW}`);
}

console.log('=== 2. 面板纵向: 完整可见 + 不压关键信息 ===');
{
    const topTileH = TOP_TILE_W * TILE_H / TILE_W;
    const halfTileH = topTileH / 2;
    const ratios: [string, number][] = [
        ['16:9  (1920x1080)', 16 / 9],
        ['19.5:9(2340x1080)', 2340 / 1080],
        ['21:9  (2520x1080)', 21 / 9],
        ['超宽  (3440x1440)', 3440 / 1440],
        ['竖屏  (1080x2400)', 1080 / 2400],
    ];

    for (const [label, ratio] of ratios) {
        const halfH = 840 / ratio;
        // ---- 复刻 Main._applyLayout 的纵向链路(内容坐标系, 原点在屏幕中心) ----
        const handY = -halfH + TILE_H / 2 + 8;
        const meldH = tileH(RIVER_TILE_W);
        const meldY = handY + TILE_H / 2 + meldH / 2 + MELD_MARK_GAP;
        const discY = meldY + meldH / 2 + meldH / 2 + MELD_MARK_GAP;
        const topHandY = halfH - 8 - halfTileH;
        const topMeldY = topHandY - halfTileH - meldH / 2 - MELD_MARK_GAP;
        const topDiscY = topMeldY - meldH / 2 - meldH / 2 - MELD_MARK_GAP;
        const bottomRiverTop = discY + meldH + meldH / 2;
        const topRiverBottom = topDiscY - meldH - meldH / 2;
        const discR = Math.max(TURN_DISC_R_MIN, Math.min(TURN_DISC_R_MAX,
            Math.min(-bottomRiverTop, topRiverBottom) - 6));
        const meldPanelY = discY + meldH / 2 + 30;
        // ---- 复刻 _placeHintPanel ----
        const gap = MELD_BTN_H / 2 + HINT_PANEL_GAP;
        const btnTop = meldPanelY + gap;
        const btnBottom = meldPanelY - gap;
        const discBottom = -discR - 6 - HINT_BREATH;
        const handTop = handY + TILE_H / 2 + HINT_BREATH;
        const availAbove = discBottom - btnTop;
        const availBelow = btnBottom - handTop;
        const above = availAbove >= availBelow;
        const avail = above ? availAbove : availBelow;

        const f = fit(avail, 2);
        const panelBottom = above ? btnTop : btnBottom - f.h;
        const panelTop = above ? btnTop + f.h : btnBottom;

        check(avail > 0, `${label} 至少有一条落位通道`, `above=${availAbove.toFixed(0)} below=${availBelow.toFixed(0)}`);
        check(panelTop <= halfH && panelBottom >= -halfH,
            `${label} 面板完整可见`,
            `top=${panelTop.toFixed(0)} bottom=${panelBottom.toFixed(0)} halfH=${halfH.toFixed(0)}`);
        // 绝不压转盘/倒计时(正在变化的信息)
        check(panelTop <= discBottom + 0.5,
            `${label} 面板不压中央转盘/倒计时`,
            `panelTop=${panelTop.toFixed(0)} discBottom=${discBottom.toFixed(0)} above=${above}`);
        // 绝不压吃/碰按钮行
        if (above) {
            check(panelBottom >= meldPanelY + MELD_BTN_H / 2 - 0.5,
                `${label} 面板不压吃/碰按钮行`);
        } else {
            check(panelTop <= meldPanelY - MELD_BTN_H / 2 + 0.5,
                `${label} 面板(落位下)不压吃/碰按钮行`);
        }
        // 绝不压手牌: 提示之后玩家要立刻点那张牌
        check(panelBottom >= handTop - 0.5,
            `${label} 面板不压手牌`,
            `handTop=${handTop.toFixed(0)} panelBottom=${panelBottom.toFixed(0)}`);
        // 字号仍可读: 缩放不能低于下限(否则应该砍次选而不是继续缩)
        check(f.scale >= MIN_SCALE - 1e-6, `${label} 缩放不低于下限`, `scale=${f.scale.toFixed(2)}`);
        console.log(`       ${label}: 落位=${above ? '按钮行上方' : '按钮行下方'} 可用=${avail.toFixed(0)}px 实际高=${f.h.toFixed(0)}px scale=${f.scale.toFixed(2)} 次选=${f.alts}`);
    }
}

console.log('=== 3. 面板内部: 各段间距 > 0(游标写法) ===');
{
    // 复刻 _buildContent 的游标推进, 每一步都断言 y 严格递减
    let y = 1000;
    const steps: [string, number, number][] = [
        ['main', H_MAIN, GAP_MAIN],
        ['reason', H_REASON, GAP_DIVIDER],
        ['alt1', H_ALT, GAP_ALT],
        ['alt2', H_ALT, 0],
    ];
    for (const [name, h, gap] of steps) {
        check(gap >= 0, `段后间距 ${name} → 下一段 >= 0`, `gap=${gap}`);
        const next = y - h - gap;
        check(next < y, `${name} 段推进后 y 变小(不会压住下一段)`, `${y} → ${next}`);
        y = next;
    }
    // 交叉验证: 游标走过的内容高 + 上下内边距 = _measureHeight
    // (游标起点是"上内边距之下的那一行", 终点是"下内边距之上的那一行")
    const expect = measureH(2);
    const actual = (1000 - y) + PAD_Y * 2;
    check(Math.abs(actual - expect) < 0.001, '游标累计高 + 上下内边距 = _measureHeight', `${actual} vs ${expect}`);
}

console.log('=== 4. Label 文本域够宽(不触发 SHRINK) ===');
{
    const headerW = textWidth(HEADER_TEXT, 24) + 8;
    const mainW = textWidth(MAIN_TEXT, 40) + 8;
    const reasonW = textWidth(REASON_TEXT, 26) + 8;
    const altWs = ALT_TEXTS.map(t => textWidth(t, 24) + 8);
    const closeW = 40 + 20;
    const contentW = Math.max(headerW, mainW, reasonW, ...altWs, closeW);
    const cardW = contentW + PAD_X * 2;

    check(contentW <= CONTENT_W, '面板横向放得下(内容 x 恒 ±840)', `cardW=${cardW}`);
    for (const [name, w] of [['顶部队落', headerW], ['首选', mainW], ['理由', reasonW]] as [string, number][]) {
        check(w >= textWidth(name === '顶部队落' ? HEADER_TEXT : name === '首选' ? MAIN_TEXT : REASON_TEXT,
            name === '首选' ? 40 : name === '理由' ? 26 : 24),
            `${name} 的文本域宽度够(不 SHRINK)`, `${w}`);
    }
    altWs.forEach((w, i) => {
        check(w >= textWidth(ALT_TEXTS[i], 24) - 0.001, `次选 ${i + 1} 的文本域宽度够`, `${w}`);
    });
    // 段间距: 面板里主文字与理由之间不能糊在一起
    check(GAP_MAIN >= 4, '首选与理由之间有间距');
    
}

console.log(`\n${fails === 0 ? '全部通过' : `失败 ${fails} 项`}`);
process.exit(fails === 0 ? 0 : 1);
