/**
 * 设置规则页版式复核(可滚动的全屏列表)
 *
 * 从 MenuUI.ts **提取真实常量**, 不手抄 —— 手抄会与实现漂移。
 * 复核四组:
 *  ① 滚动模型: 内容比视口高多少(能滚)、首行完整可见、内容底边与留白对得上
 *  ② 段落: 行内间距 < 行间间距(层次铁律)、行与行不重叠、说明块不越界
 *  ③ 横向: 文字列与按钮列不撞车、每条文案都放得下(字号加大后最容易超宽)
 *  ④ 可读性设施: 阅读底板(遮罩) + 滚动指示条 + 字号下限 + 原生补画
 *
 * 【2026-10-16 晚改版背景】用户反馈"文字和背景密密麻麻" → 字号整体加大
 * (标题 30→36, 说明 20→26), 内容因此超过一屏, 于是真正启用滚动, 并加整页阅读底板。
 * 这一版把断言从"一屏装得下"改成了"滚动量合理 + 首屏首行完整可见"。
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
        if (fs.existsSync(p)) return p;
        dir = path.dirname(dir);
    }
    throw new Error(`找不到 ${rel}`);
}
const src = fs.readFileSync(findFile('assets/scripts/ui/MenuUI.ts'), 'utf8');

let fails = 0;
function check(cond: boolean, label: string, detail = ''): void {
    if (cond) console.log(`  ✓ ${label}`);
    else { fails++; console.log(`  ✗ ${label} ${detail}`); }
}

/** 剥注释(源码级断言用) */
function strip(s: string): string {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
const code = strip(src);

const constCache: Record<string, number> = {};
/** 取常量值(支持引用其它常量的表达式) */
function num(name: string): number {
    if (constCache[name] !== undefined) return constCache[name];
    const m = src.match(new RegExp(`const ${name}\\s*(?::[^=]*)?=\\s*([^;\\n]+);`));
    if (!m) throw new Error(`找不到常量 ${name}`);
    const expr = m[1].trim();
    let v: number;
    if (/^-?[\d.]+$/.test(expr)) {
        v = Number(expr);
    } else {
        const keys: string[] = [];
        const vals: number[] = [];
        for (const ref of expr.match(/[A-Z][A-Z0-9_]*/g) || []) {
            if (keys.indexOf(ref) >= 0 || ref === name) continue;
            if (!new RegExp(`const ${ref}\\s*(?::[^=]*)?=`).test(src)) continue;
            keys.push(ref);
            vals.push(num(ref));
        }
        v = Number(new Function(...keys, `return (${expr});`)(...vals));
    }
    if (Number.isNaN(v)) throw new Error(`常量 ${name} 求值失败: ${expr}`);
    constCache[name] = v;
    return v;
}

function str(name: string): string {
    const m = src.match(new RegExp(`const ${name}\\s*(?::[^=]*)?=\\s*\\n?\\s*'([^']*)'`));
    if (!m) throw new Error(`找不到字符串常量 ${name}`);
    return m[1];
}

/**
 * 跨行拼接的字符串常量(如 RULES_TIPS_TEXT 用 + 拼三行)
 *
 * 【坑】不能取"第一个分号"——文案里本身就有分号, 会把第一行截断。要取行尾那个分号;
 * 源码里的 \\n 是转义写法, 解析完要还原成真换行(否则"三行"的断言全部落空)。
 */
function joinedStr(name: string): string {
    const i = src.indexOf(`const ${name} = `);
    if (i < 0) throw new Error(`找不到常量 ${name}`);
    const m = new RegExp(`const ${name} = ([\\s\\S]*?);\\n`).exec(src.slice(i));
    if (!m) throw new Error(`解析不到常量 ${name}`);
    const parts = (m[1].match(/'([^']*)'/g) || []).map(p => p.slice(1, -1));
    return parts.join('').split('\\n').join('\n');
}

/** CJK 按字号, 其余半角 —— 与 MenuUI.textWidth 一致 */
function textWidth(text: string, font: number): number {
    let w = 0;
    for (const ch of text) w += ch.codePointAt(0)! >= 0x2e80 ? font : font * 0.5;
    return w;
}

// ---- 提取真实常量 ----
const MENU_H = num('MENU_CONTENT_H');
const PANEL_W = num('PANEL_W');
const PAD = num('RULES_PAD');
const TEXT_W = num('RULES_TEXT_W');
const BTN_W = num('RULES_BTN_W');
const BTN_H = num('RULES_BTN_H');
const BTN_GAP = num('RULES_BTN_GAP');
const CAP_DY = num('RULES_CAPTION_DY');
const HINT_DY = num('RULES_HINT_DY');
const H_CAP = num('H_CAP_LINE');
const H_HINT = num('H_HINT_LINE');
const PITCH = num('RULES_ROW_PITCH');
const ROW_TOP = num('RULES_ROW_TOP');
const ROW_COUNT = num('RULES_ROW_COUNT');
const TIPS_W = num('RULES_TIPS_W');
const TIPS_H = num('RULES_TIPS_H');
const TIPS_LINES = num('RULES_TIPS_LINES');
const TIPS_LINE_H = num('RULES_TIPS_LINE_H');
const TIPS_GAP = num('RULES_TIPS_GAP');
const CONTENT_BOTTOM = num('RULES_CONTENT_BOTTOM');
const F_CAP = num('RULES_CAPTION_FONT');
const F_HINT = num('RULES_HINT_FONT');
const F_TIPS = num('RULES_TIPS_FONT');
const TOP_Y = num('RULES_TOP_Y');
const TOP_BTN_H = num('RULES_TOP_BTN_H');
const BACK_X = num('RULES_BACK_X');
const BACK_Y = num('RULES_BACK_Y');
const VIEW_W = num('PAGE_VIEW_W');
const VIEW_TOP_GAP = num('PAGE_VIEW_TOP_GAP');
const BAR_W = num('SCROLL_BAR_W');
const BAR_RIGHT = num('SCROLL_BAR_RIGHT');
const BAR_PAD = num('SCROLL_BAR_PAD');
const BAR_MIN_H = num('SCROLL_BAR_MIN_H');
const TIPS_TEXT = joinedStr('RULES_TIPS_TEXT');

/** 选项按钮字号(写在 _buildChoiceGroup 里) */
const F_OPTION = Number(/buttonLabel\(btn\);\s*\n\s*if \(bl\) bl\.fontSize = (\d+);/.exec(code)![1]);

// ---- 复刻排版 ----
const rowY = (i: number): number => ROW_TOP - i * PITCH;
const capTop = (i: number): number => rowY(i) + CAP_DY + H_CAP / 2;
const capBottom = (i: number): number => rowY(i) + CAP_DY - H_CAP / 2;
const hintTop = (i: number): number => rowY(i) + HINT_DY + H_HINT / 2;
const hintBottom = (i: number): number => rowY(i) + HINT_DY - H_HINT / 2;
const tipsTop = hintBottom(ROW_COUNT - 1) - TIPS_GAP;
const contentH = -(tipsTop - TIPS_H) + CONTENT_BOTTOM;

const viewTop = TOP_Y - TOP_BTN_H / 2 - VIEW_TOP_GAP;
const viewBottom = -MENU_H / 2 + 8;
const viewH = viewTop - viewBottom;
const scrTop = MENU_H / 2;

console.log('=== 提取到的版式 ===');
console.log(`  视口 ${viewTop.toFixed(0)} → ${viewBottom.toFixed(0)}(高 ${viewH.toFixed(0)})  内容高 ${contentH.toFixed(0)}`);
console.log(`  行: ${ROW_COUNT} 行 × 间距 ${PITCH}, 首行中心 ${ROW_TOP}  字号: 标题 ${F_CAP} / 说明 ${F_HINT} / 按钮 ${F_OPTION}`);
console.log(`  说明块: ${TIPS_LINES} 行 × ${TIPS_LINE_H} = ${TIPS_H}px`);

const groups = src.match(/_buildChoiceGroup\(host, \{[\s\S]*?\n        \}\);/g) || [];
const keys: string[] = [];
const hints: string[] = [];
const captions: string[] = [];
for (const g of groups) {
    const k = g.match(/key: '([^']+)'/);
    keys.push(k ? k[1] : '?');
    const c = g.match(/caption: '([^']+)'/);
    captions.push(c ? c[1] : '?');
    const h = g.match(/hint: '([^']+)'/);
    hints.push(h ? h[1] : '');
}
console.log(`  选项组: ${keys.join(', ')}`);

// ---------------------------------------------------------------- ①
console.log('\n=== ① 滚动模型 ===');
check(groups.length === ROW_COUNT, `选项组数(${groups.length}) == RULES_ROW_COUNT(${ROW_COUNT})`);
check(contentH > viewH, `内容(${contentH.toFixed(0)})比视口(${viewH.toFixed(0)})高 → 真的能滚`);
check(contentH - viewH >= 40, `滚动量 ${(contentH - viewH).toFixed(0)}px ≥ 40(值得滚)`);
check(contentH - viewH <= MENU_H * 0.5, `滚动量 ${(contentH - viewH).toFixed(0)}px 不至于长到"翻半天"`);
// 首行必须完整落在视口里(内容顶边 = 视口顶 = 内容局部 y=0)
check(capTop(0) <= 0, `首行标题上沿 ${capTop(0).toFixed(0)} ≤ 0(不被 Mask 裁掉)`);
check(capTop(0) > -12, `首行标题离视口顶很近(${capTop(0).toFixed(0)} > -12, 不浪费空间)`);
check(hintBottom(ROW_COUNT - 1) > -(contentH - CONTENT_BOTTOM), '末行说明在内容范围内');
check(-(tipsTop - TIPS_H) + CONTENT_BOTTOM === contentH, '内容高 = 说明块底边 + 底部留白');
check(Math.abs(viewTop - (TOP_Y - TOP_BTN_H / 2 - VIEW_TOP_GAP)) < 0.01 && viewTop < scrTop,
    `视口顶在顶部按钮行下方(${viewTop.toFixed(0)} < ${(TOP_Y - TOP_BTN_H / 2).toFixed(0)})`);
check(viewBottom > -scrTop + 4, `视口底 ${viewBottom.toFixed(0)} 在屏幕内`);
check(VIEW_W <= 1680, `视口宽 ${VIEW_W} ≤ 内容坐标系宽 1680`);
check(Math.abs(BACK_X) > 200 && Math.abs(BACK_Y - TOP_Y) < 20, '返回按钮仍在左上角顶部行');

// ---------------------------------------------------------------- ②
console.log('\n=== ② 段落间距 ===');
const inner = (capBottom(0) - hintTop(0));
const outer = hintBottom(0) - capTop(1);
check(inner > 0, `行内间距 ${inner.toFixed(1)} > 0(标题与说明不重叠)`);
check(outer > 0, `行间间距 ${outer.toFixed(1)} > 0`);
check(inner < outer, `层次正确: 行内(${inner.toFixed(0)}) < 行间(${outer.toFixed(0)})`);
check(outer >= 24, `行间间距 ${outer.toFixed(0)} ≥ 24(各项分得开)`);
for (let i = 0; i < ROW_COUNT - 1; i++) {
    const gap = hintBottom(i) - capTop(i + 1);
    check(Math.abs(gap - outer) < 0.01, `第 ${i + 1}→${i + 2} 行间距一致(${gap.toFixed(1)})`);
}
check(hintBottom(ROW_COUNT - 1) - tipsTop === TIPS_GAP, `说明块与末行间距 ${TIPS_GAP}`);
check(TIPS_H >= TIPS_LINES * F_TIPS, `说明块高 ${TIPS_H} ≥ ${TIPS_LINES} 行 × 字号 ${F_TIPS}(不被压扁)`);

// ---------------------------------------------------------------- ③
console.log('\n=== ③ 横向: 文字列 / 按钮列 / 文案宽度 ===');
const TEXT_LEFT = -PANEL_W / 2 + PAD;
const BTN_RIGHT = PANEL_W / 2 - PAD;
const textRight = TEXT_LEFT + TEXT_W;
const maxOpts = 4;   // 音量档 4 个按钮最宽
const availW = BTN_RIGHT - textRight - 8;
const fitW = (availW - (maxOpts - 1) * BTN_GAP) / maxOpts;
const btnW = Math.min(BTN_W, fitW);
const btnLeft = BTN_RIGHT - (maxOpts * btnW + (maxOpts - 1) * BTN_GAP);
console.log(`  文字列 [${TEXT_LEFT} ~ ${textRight.toFixed(0)}]  按钮列 [${btnLeft.toFixed(0)} ~ ${BTN_RIGHT}] 每键 ${btnW.toFixed(0)}px`);
check(btnLeft >= textRight + 8, `按钮列左缘 ${btnLeft.toFixed(0)} ≥ 文字列右缘 + 8`);
const need2 = textWidth('静音', F_OPTION) + 16;
check(need2 <= btnW, `音量档按钮放得下"静音"(${need2} ≤ ${btnW.toFixed(0)})`);
check(textWidth('恢复默认', F_OPTION) + 16 <= 220, '顶部按钮放得下"恢复默认"');
check(BTN_H >= F_OPTION + 24, `选项按钮高 ${BTN_H} ≥ 字号 ${F_OPTION} + 24`);
// 说明块的每一行都要放得下(字号 26 下 1000px 只能放约 38 个汉字)
const tipsLines = TIPS_TEXT.split('\n');
check(tipsLines.length === TIPS_LINES, `说明块实际 ${tipsLines.length} 行 == RULES_TIPS_LINES(${TIPS_LINES})`);
for (const l of tipsLines) {
    const need = textWidth(l, F_TIPS) + 8;
    check(need <= TIPS_W, `说明行放得下(${need.toFixed(0)} ≤ ${TIPS_W}): "${l.slice(0, 12)}…"`);
}

for (let i = 0; i < captions.length; i++) {
    const cw = textWidth(captions[i], F_CAP) + 8;
    check(cw <= TEXT_W, `标题 "${captions[i]}" 放得下(${cw.toFixed(0)} ≤ ${TEXT_W})`);
    const hw = textWidth(hints[i], F_HINT) + 8;
    check(hw <= TEXT_W, `说明 "${hints[i]}" 放得下(${hw.toFixed(0)} ≤ ${TEXT_W})`,
        hw > TEXT_W ? '字号加大后文案要收短, 不能靠 SHRINK 压小' : '');
}

// ---------------------------------------------------------------- ④
console.log('\n=== ④ 可读性设施: 阅读底板 / 滚动条 / 字号下限 / 原生补画 ===');
// 阅读底板: 整页压暗(压背景照片的干扰)
const dimAlpha = Number(/const PAGE_DIM_COLOR = new Color\((\d+), (\d+), (\d+), (\d+)\)/.exec(code)![4]);
check(dimAlpha >= 150, `阅读底板不透明度 ${dimAlpha} ≥ 150(背景压得下去)`);
const dimAt = code.indexOf('this._addPageDim(page)');
const firstBtnAt = code.indexOf('createButtonNode(', code.indexOf('private _buildRulesPage'));
check(dimAt > 0 && dimAt < firstBtnAt, '底板在页面内容之前创建(压在文字底下)');
check(/_paintPageDims\(\)/.test(code) && /redrawBackdrop\(\)[\s\S]{0,400}?_paintPageDims\(\)/.test(code),
    'redrawBackdrop 会补画底板(Main 首帧后那条路)');
check(/showRules\(\): void \{[\s\S]{0,600}?_paintPageDims\(\)/.test(code), 'showRules 会补画底板');

// 滚动条: 滑块永远在轨道内, 且一眼能看见
const trackH = viewH - BAR_PAD * 2;
const thumbH = Math.max(BAR_MIN_H, trackH * Math.min(1, viewH / contentH));
check(thumbH <= trackH + 0.01, `滑块高 ${thumbH.toFixed(0)} ≤ 轨道高 ${trackH.toFixed(0)}`);
check(thumbH >= BAR_MIN_H, `滑块高 ${thumbH.toFixed(0)} ≥ ${BAR_MIN_H}(看得见、点得住)`);
const barX = VIEW_W / 2 - BAR_RIGHT;
check(barX + BAR_W / 2 <= VIEW_W / 2, `滚动条在视口内(x=${barX}, 视口右缘 ${VIEW_W / 2})`);
check(barX - BAR_W / 2 >= 0, '滚动条在视口右半边(不压中间的文字与按钮)');
check(barX - BAR_W / 2 > BTN_RIGHT + 8, `滚动条让开按钮列(${(barX - BAR_W / 2).toFixed(0)} > ${BTN_RIGHT})`);
check(/getMaxScrollOffset\(\)/.test(code) && /getScrollOffset\(\)/.test(code),
    '滚动条位置由 ScrollView 的 API 反推(不自己算边界)');
check(/max <= 1 \|\| viewH <= 0 \|\| contentH <= 0\) return;/.test(code),
    '内容没超出视口时不画滚动条');
check(/update\(\): void \{[\s\S]{0,300}?_paintScrollBar/.test(code), 'update() 里按需重画滚动条');
check(/if \(this\._rulesScroll\) this\._rulesScroll\.barKey = '#';/.test(code),
    'showRules 强制重画滚动条(原生补画)');

// 字号下限: 防止以后又缩回去
check(F_CAP >= 34, `标题字号 ${F_CAP} ≥ 34`);
check(F_HINT >= 24, `说明字号 ${F_HINT} ≥ 24`);
check(F_TIPS >= 24, `说明块字号 ${F_TIPS} ≥ 24`);
check(F_OPTION >= 30, `按钮字号 ${F_OPTION} ≥ 30`);

// 旧的"居中面板/标题/上下渐变"仍然不许回来
check(!code.includes('_paintRulesCard'), '居中面板绘制仍然没有');
check(!code.includes("'RulesCard'"), '不创建 RulesCard 节点');
check(!code.includes('_paintRulesFade') && !code.includes('RulesFade'), '上下黑色渐变遮罩仍然没有');
check(!code.includes("createLabelNode('规则设置'"), '设置页仍然没有标题(标题归说明页)');

// 滚动页的接线
check(/ct\.setAnchorPoint\(0\.5, 1\)/.test(code), '内容锚点 (0.5, 1): 局部 y=0 即内容顶边');
check(/content\.setPosition\(0, viewH \/ 2, 0\)/.test(code), '内容顶边对齐视口顶(初始就在最上面)');
check(/sv\.vertical = true;/.test(code) && /sv\.horizontal = false;/.test(code), '只启用纵向滚动');
check(/sv\.elastic = false;/.test(code), '关掉回弹(内容不会飘出边界)');
check(/addComponent\(Mask\)/.test(code), '视口带 Mask(拖动时内容不溢出到顶部按钮上)');
check(/this\._commitScrollContent\(sp, -\(tipsTop - RULES_TIPS_H\) \+ RULES_CONTENT_BOTTOM\);/.test(code),
    '内容高度按实际排版落定(不是写死的)');

console.log(`\n=== 结果: ${fails === 0 ? '全部通过' : fails + ' 项失败'} ===`);
process.exit(fails === 0 ? 0 : 1);
