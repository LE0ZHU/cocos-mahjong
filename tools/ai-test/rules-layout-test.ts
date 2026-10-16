/**
 * 设置页版式复核(全屏 + 滚动布局)
 *
 * 从 MenuUI.ts **提取真实常量**, 不手抄 —— 手抄会与实现漂移。
 * 复核: ①全屏内不溢出 ②段间距全为正且项间 ≥20、层次正确 ③标题列与按钮列不撞车
 *      ④滚动视口的坐标系与版式常量对齐(最容易出错的一环) ⑤居中面板确已移除
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

const constCache: Record<string, number> = {};
function num(name: string): number {
    if (constCache[name] !== undefined) return constCache[name];
    const m = src.match(new RegExp(`const ${name} = ([^;\\n]+);`));
    if (!m) throw new Error(`找不到常量 ${name}`);
    const expr = m[1];
    for (const r of expr.match(/[A-Z][A-Z0-9_]*/g) || []) {
        if (r === name || constCache[r] !== undefined) continue;
        if (new RegExp(`const ${r} = `).test(src)) num(r);
    }
    const scope = { ...constCache };
    const keys = Object.keys(scope);
    const v = Number(new Function(...keys, `return (${expr});`)(...keys.map(k => scope[k])));
    if (Number.isNaN(v)) throw new Error(`常量 ${name} 求值失败: ${expr}`);
    constCache[name] = v;
    return v;
}
function arr(name: string): number[] {
    const m = src.match(new RegExp(`const ${name} = \\[([^\\]]+)\\];`));
    if (!m) throw new Error(`找不到常量 ${name}`);
    return m[1].split(',').map(s => Number(s.trim()));
}

const MENU_H = num('MENU_CONTENT_H');
const PANEL_W = num('PANEL_W');
const RULES_PAD = num('RULES_PAD');
const RULES_TEXT_W = num('RULES_TEXT_W');
const RULES_BTN_W = num('RULES_BTN_W');
const RULES_BTN_GAP = num('RULES_BTN_GAP');
const CAP_DY = num('RULES_CAPTION_DY');
const HINT_DY = num('RULES_HINT_DY');
const TOP_Y = num('RULES_TOP_Y');
const TIPS_Y = num('RULES_TIPS_Y');
const TIPS_H = num('RULES_TIPS_H');
const BACK_X = num('RULES_BACK_X');
const BACK_Y = num('RULES_BACK_Y');
const ROW_YS = arr('RULES_ROW_YS');

const CAPTION_H = 30;
const HINT_H = 20;
const BTN_H = 62;
const scrTop = MENU_H / 2;
const scrBottom = -MENU_H / 2;

console.log('=== 提取到的常量 ===');
console.log(`  全屏高 ${MENU_H}  行数=${ROW_YS.length}  行距=${ROW_YS[0] - ROW_YS[1]}`);
console.log(`  顶部行Y=${TOP_Y}(标题已删, 只放返回/恢复默认)  返回按钮X=${BACK_X} Y=${BACK_Y}`);
console.log(`  行Y: ${ROW_YS.join(', ')}`);

const groups = src.match(/_buildChoiceGroup\(host, \{[\s\S]*?\n        \}\);/g) || [];
const keys: string[] = [];
const optCounts: number[] = [];
for (const g of groups) {
    const k = g.match(/key: '([^']+)'/);
    keys.push(k ? k[1] : '?');
    const opt = g.match(/options: ([A-Z_]+)/);
    if (!opt) { optCounts.push(0); continue; }
    const am = src.match(new RegExp(`const ${opt[1]}: ChoiceOption\\[\\] = \\[([\\s\\S]*?)\\];`));
    optCounts.push(am ? (am[1].match(/\{/g) || []).length : 2);
}
console.log(`  选项组: ${groups.length} 个 → ${keys.join(', ')}`);
console.log(`  各组按钮数: ${optCounts.join(', ')}`);
check(groups.length === ROW_YS.length, `选项组数(${groups.length}) == 行数(${ROW_YS.length})`);

console.log('\n=== ① 全屏内不溢出 ===');
// 标题已删除: 顶部一行只有返回/恢复默认按钮(高 62, 半高 31)
check(TOP_Y + BTN_H / 2 < scrTop, `顶部按钮行在屏幕内 (${TOP_Y + BTN_H / 2} < ${scrTop})`);
const capTops = ROW_YS.map(y => y + CAP_DY + CAPTION_H / 2);
const capBots = ROW_YS.map(y => y + CAP_DY - CAPTION_H / 2);
const hintBots = ROW_YS.map(y => y + HINT_DY - HINT_H / 2);
check(Math.max(...capTops) < scrTop, `首行 caption 顶在屏幕内 (${Math.max(...capTops)} < ${scrTop})`);
check(Math.min(...hintBots) > scrBottom, `末行 hint 底在屏幕内 (${Math.min(...hintBots)} > ${scrBottom})`);
check(TIPS_Y - TIPS_H / 2 > scrBottom, `说明块在屏幕内 (${(TIPS_Y - TIPS_H / 2).toFixed(1)} > ${scrBottom})`);
check(Math.abs(BACK_X) > 200, `返回按钮在左侧 (x=${BACK_X})`);
check(Math.abs(BACK_Y - TOP_Y) < 20, `返回按钮在顶部行 (差${Math.abs(BACK_Y - TOP_Y)})`);

console.log('\n=== ② 段间距 > 0 ===');
// 标题已删: 改成"顶部按钮行下沿 → 首行"的间距(按钮半高 31)
const gapTitle = (TOP_Y - BTN_H / 2) - Math.max(...capTops);
check(gapTitle > 0, `按钮行→首行 间距 ${gapTitle.toFixed(1)} > 0`);
const inner = (CAP_DY - CAPTION_H / 2) - (HINT_DY + HINT_H / 2);
let minOuter = Infinity;
for (let i = 0; i < ROW_YS.length - 1; i++) {
    minOuter = Math.min(minOuter, hintBots[i] - capTops[i + 1]);
}
check(inner > 0, `行内间距 ${inner.toFixed(1)} > 0`);
check(minOuter > 0, `最小项间间距 ${minOuter.toFixed(1)} > 0`);
check(minOuter >= 20, `项间间距 ${minOuter.toFixed(1)} ≥ 20`);
check(inner < minOuter, `层次正确: 行内(${inner.toFixed(0)}) < 行间(${minOuter.toFixed(0)})`);
const gapTips = Math.min(...hintBots) - (TIPS_Y + TIPS_H / 2);
check(gapTips > 0, `末行→说明块 间距 ${gapTips.toFixed(1)} > 0`);

console.log('\n=== ③ 行内横向不撞车 ===');
const TEXT_LEFT = -PANEL_W / 2 + RULES_PAD;
const BTN_RIGHT = PANEL_W / 2 - RULES_PAD;
const textRight = TEXT_LEFT + RULES_TEXT_W;
const availW = BTN_RIGHT - textRight - 8;
const maxOpts = Math.max(...optCounts);
const fitW = (availW - (maxOpts - 1) * RULES_BTN_GAP) / maxOpts;
const btnW = Math.min(RULES_BTN_W, fitW);
const btnLeft = BTN_RIGHT - (maxOpts * btnW + (maxOpts - 1) * RULES_BTN_GAP);
console.log(`  文字列右缘 ${textRight}  按钮列 [${btnLeft.toFixed(0)} ~ ${BTN_RIGHT}] 每键 ${btnW.toFixed(0)}px`);
check(btnLeft >= textRight + 8, `按钮列左缘 ${btnLeft.toFixed(0)} ≥ 文字列右缘 + 8`);
check(btnW >= 2 * 30 + 24, `按钮容得下最长文字 (${btnW.toFixed(0)} ≥ 84)`);

console.log('\n=== ④ 滚动视口坐标系对齐 ===');
const viewTop = TOP_Y - 42;
const viewBottom = -MENU_H / 2 + 8;
const viewH = viewTop - viewBottom;
const viewCenterY = (viewTop + viewBottom) / 2;
console.log(`  视口: ${viewTop} → ${viewBottom}, 高 ${viewH}, 中心 y=${viewCenterY.toFixed(1)}`);
check(src.includes('content.setPosition(0, -viewCenterY, 0)'),
    'Content 位置补偿了视口中心偏移(否则整体上移 40px)');
check(Math.max(...capTops) > viewTop - 1 && Math.max(...capTops) < viewTop + 45,
    `补偿后首行落在视口顶部附近 (${Math.max(...capTops)} vs 视口顶 ${viewTop})`);
check(Math.min(...hintBots) > viewBottom, `末行在视口内 (${Math.min(...hintBots)} > ${viewBottom})`);
check(TIPS_Y - TIPS_H / 2 > viewBottom, '说明块也在视口内');
const contentH = Math.max(...capTops) - (TIPS_Y - TIPS_H / 2);
console.log(`  内容 ${contentH.toFixed(0)}px / 视口 ${viewH}px → ${contentH <= viewH ? '一屏放得下(拖动自动禁用)' : '可拖动 ' + (contentH - viewH).toFixed(0) + 'px'}`);

console.log('\n=== ⑤ 居中面板 / 标题 / 上下遮罩已移除 ===');
check(!src.includes('_paintRulesCard'), '居中面板绘制已删除');
check(!src.includes("'RulesCard'"), '不再创建 RulesCard 节点');
check(!src.includes('_paintRulesFade'), '上下黑色渐变遮罩已删除(2026-10-15 用户要求)');
check(!src.includes('RulesFade'), '不再创建 RulesFade 节点');
check(!src.includes("createLabelNode('规则设置'"), '规则设置标题已删除');

console.log(`\n=== 结果: ${fails === 0 ? '全部通过' : fails + ' 项失败'} ===`);
process.exit(fails === 0 ? 0 : 1);