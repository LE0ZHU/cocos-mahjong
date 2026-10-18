/**
 * 玩法说明页复核 —— 从真实源码提取常量 + 打真实的番型表
 *
 * 复核四组:
 *  1. 版式数字: 各段不重叠、间距全为正、**一屏装得下**(超出屏幕就是"玩家看不到的一截")
 *  2. 番型表: 两列的"名称 + 番数 + 说明"逐条放得下, 且数据来自 core/HuScore 的 FAN_DEFS
 *  3. 同源: 判定(computeHu)与说明页读同一张表 —— 谁也不能再抄一份番数
 *  4. 接线: 主菜单有入口、页面切换/原生补画都接上、摘要不再被 SHRINK 压扁
 *
 * 【为什么要跑数字】说明页是"一屏排下来的版面", 段高 / 间距 / 列宽全是算出来的 ——
 * 多加一行说明就可能压到下一段或顶出屏幕, 而电脑上肉眼只看当前这一版。
 * 硬约束 3 的游标写错、硬约束 4 的文字框给窄, 都会在这里被抓住。
 */
import { FAN_DEFS, STREAK_FAN_MAX, computeHu } from '../../assets/scripts/core/HuScore';
import { HuChecker } from '../../assets/scripts/core/HuChecker';
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

const menuSrc = fs.readFileSync(findFile('assets/scripts/ui/MenuUI.ts'), 'utf8');
const scoreSrc = fs.readFileSync(findFile('assets/scripts/core/HuScore.ts'), 'utf8');
const readme = fs.readFileSync(findFile('README.md'), 'utf8');

let fails = 0;
function check(cond: boolean, name: string, extra = ''): void {
    if (cond) console.log(`  [OK] ${name}`);
    else { fails++; console.log(`  [FAIL] ${name}${extra ? ' → ' + extra : ''}`); }
}

/**
 * 从源码里取数值常量(模块级 const 与类字段都认)
 *
 * 常量可能是表达式(如 `HELP_FAN_COL_W = (HELP_CONTENT_W - HELP_FAN_COL_GAP) / 2`),
 * 所以取到表达式后把它引用到的其它常量也递归取出来, 再交给 Function 求值 ——
 * 手抄一个数字进测试就等于给"实现改了、测试还绿"留后门。
 */
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

/** CJK 按字号, 其余半角 —— 与 MenuUI.textWidth 一致 */
function textWidth(text: string, font: number): number {
    let w = 0;
    for (const ch of text) w += ch.codePointAt(0)! >= 0x2e80 ? font : font * 0.5;
    return w;
}

function stripComments(s: string): string {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// ---- 提取真实常量 ----
const MENU_W = num(menuSrc, 'MENU_CONTENT_W');
const MENU_H = num(menuSrc, 'MENU_CONTENT_H');
const TOP_Y = num(menuSrc, 'RULES_TOP_Y');
const CONTENT_W = num(menuSrc, 'HELP_CONTENT_W');
/** 内容原点(顶边) → 首段上沿 / 末段底边 → 内容下沿 */
const PAD_TOP = num(menuSrc, 'HELP_PAD_TOP');
const PAD_BOTTOM = num(menuSrc, 'HELP_PAD_BOTTOM');
const CAP_H = num(menuSrc, 'HELP_CAP_H');
const CAP_GAP = num(menuSrc, 'HELP_CAP_GAP');
const LINE_H = num(menuSrc, 'HELP_LINE_H');
const SEC_GAP = num(menuSrc, 'HELP_SEC_GAP');
const FAN_ROW_H = num(menuSrc, 'HELP_FAN_ROW_H');
const FAN_COL_GAP = num(menuSrc, 'HELP_FAN_COL_GAP');
const FAN_NAME_W = num(menuSrc, 'HELP_FAN_NAME_W');
const FAN_COL_W = num(menuSrc, 'HELP_FAN_COL_W');
const CAP_FONT = num(menuSrc, 'HELP_CAP_FONT');
const LINE_FONT = num(menuSrc, 'HELP_LINE_FONT');
const FAN_NAME_FONT = num(menuSrc, 'HELP_FAN_NAME_FONT');
const FAN_FONT = num(menuSrc, 'HELP_FAN_FONT');
/** 顶部按钮行(返回)高度 / 视口参数: 与设置页共用同一套常量 */
const TOP_BTN_H = num(menuSrc, 'RULES_TOP_BTN_H');
const VIEW_TOP_GAP = num(menuSrc, 'PAGE_VIEW_TOP_GAP');
const BAR_MIN_H = num(menuSrc, 'SCROLL_BAR_MIN_H');

/** 从某个玩法说明段落数组里解析出各段: 标题 / 正文行 / 是否渲染番型表 */
function parseSections(constName: string): { title: string; lines: string[]; fanTable: boolean }[] {
    const start = menuSrc.indexOf(`export const ${constName}`);
    const end = menuSrc.indexOf('\n];', start);
    if (start < 0 || end < 0) throw new Error(`解析不到 ${constName}`);
    const body = menuSrc.slice(start, end);
    const out: { title: string; lines: string[]; fanTable: boolean }[] = [];
    let cur: { title: string; lines: string[]; fanTable: boolean } | null = null;
    for (const raw of body.split('\n')) {
        const line = raw.trim();
        const t = /^title: '(.+)',$/.exec(line);
        if (t) {
            cur = { title: t[1], lines: [], fanTable: false };
            out.push(cur);
            continue;
        }
        if (!cur) continue;
        if (/^fanTable: true,$/.test(line)) { cur.fanTable = true; continue; }
        const s = /^'(.+)',$/.exec(line);
        if (s) cur.lines.push(s[1]);
    }
    return out;
}

/** 玩法说明按玩法拆成两组: 麻将(带番型表) / 抽牌 */
const MAHJONG_SECTIONS = parseSections('HELP_SECTIONS_MAHJONG');
const DRAW_SECTIONS = parseSections('HELP_SECTIONS_DRAW');
/** 番型表的行: FAN_DEFS + 连庄那一行(与 MenuUI.buildFanRows 一致) */
const FAN_ROWS = [
    ...FAN_DEFS.map(d => ({ name: d.name, fanText: `${d.fan} 番`, desc: d.desc })),
    { name: '连庄', fanText: `最多 +${STREAK_FAN_MAX} 番`, desc: '连续胡牌第 N 次 +（N−1）番' },
];

// ================================================================ 1
console.log('\n[1] 版式: 各段不重叠 + 滚动量合理 + 首段完整可见');
{
    /** 复刻 _fillHelpPage 的游标 —— 内容是**局部坐标**: 0 = 内容顶边, 往下为负 */
    function layout(sections: { title: string; lines: string[]; fanTable: boolean }[]) {
        let y = -PAD_TOP;
        const segs: { name: string; top: number; bottom: number }[] = [];
        const perCol = Math.ceil(FAN_ROWS.length / 2);
        for (const s of sections) {
            const capTop = y;
            const capBottom = y - CAP_H;
            y = capBottom - CAP_GAP;
            for (let i = 0; i < s.lines.length; i++) y -= LINE_H;
            if (s.fanTable) {
                y -= perCol * FAN_ROW_H;
                check(perCol * 2 >= FAN_ROWS.length, `番型表 ${FAN_ROWS.length} 行 → 每列 ${perCol} 行放得下`);
            }
            segs.push({ name: s.title, top: capTop, bottom: y });
            y -= SEC_GAP;
        }
        return { segs, contentH: -(y + SEC_GAP) + PAD_BOTTOM };
    }

    const viewTop = TOP_Y - TOP_BTN_H / 2 - VIEW_TOP_GAP;
    const viewBottom = -MENU_H / 2 + 8;
    const viewH = viewTop - viewBottom;

    // ---- 两组数据各自的基本形状 ----
    check(MAHJONG_SECTIONS.length >= 4, `麻将组分成 ${MAHJONG_SECTIONS.length} 段(操作/胡牌/番型/计分/常驻信息)`);
    check(DRAW_SECTIONS.length >= 2, `抽牌组分成 ${DRAW_SECTIONS.length} 段(玩法/计分与牌桌)`);
    check(MAHJONG_SECTIONS.filter(s => s.fanTable).length === 1, '麻将组恰好一段渲染番型表');
    check(DRAW_SECTIONS.filter(s => s.fanTable).length === 0, '抽牌组不渲染番型表(番型是麻将的概念)');
    for (const s of [...MAHJONG_SECTIONS, ...DRAW_SECTIONS]) {
        check(s.title.length > 0 && s.lines.length > 0, `"${s.title}" 段有标题与正文`);
        check(/^(麻将|抽牌) · /.test(s.title), `段标题标明玩法归属: "${s.title}"`);
    }

    // ---- 麻将组: 内容比视口高(滚动换可读性), 但滚动量别长到"翻半天" ----
    const mj = layout(MAHJONG_SECTIONS);
    console.log(`  [麻将] 内容高 ${mj.contentH.toFixed(0)} / 视口高 ${viewH.toFixed(0)} → 可滚 ${(mj.contentH - viewH).toFixed(0)}px`);
    check(mj.contentH > viewH, `[麻将] 内容比视口高 → 真的能滚(字号加大后的代价, 换取可读性)`);
    check(mj.contentH - viewH >= 80, `[麻将] 滚动量 ${(mj.contentH - viewH).toFixed(0)}px ≥ 80(值得给滚动条)`);
    check(mj.contentH - viewH <= MENU_H * 0.6, `[麻将] 滚动量 ${(mj.contentH - viewH).toFixed(0)}px 不至于长到"翻半天"`);
    check(mj.segs[0].top <= 0, `[麻将] 首段标题上沿 ${mj.segs[0].top.toFixed(0)} ≤ 0(不被 Mask 裁掉)`);
    check(mj.segs[0].top > -14, `[麻将] 首段离视口顶很近(${mj.segs[0].top.toFixed(0)} > -14)`);

    // ---- 抽牌组: 内容少, 一屏放下(不该让玩家为几行字滚动) ----
    const dw = layout(DRAW_SECTIONS);
    console.log(`  [抽牌] 内容高 ${dw.contentH.toFixed(0)} / 视口高 ${viewH.toFixed(0)}`);
    check(dw.contentH <= viewH, `[抽牌] 内容一屏放下(${dw.contentH.toFixed(0)} ≤ ${viewH.toFixed(0)}), 不用滚`);
    check(dw.segs[0].top <= 0, `[抽牌] 首段标题上沿 ${dw.segs[0].top.toFixed(0)} ≤ 0`);

    // ---- 两组共用的排版校验 ----
    for (const [label, r] of [['麻将', mj], ['抽牌', dw]] as const) {
        const lastBottom = r.segs[r.segs.length - 1].bottom;
        check(-lastBottom + PAD_BOTTOM <= r.contentH + 0.01, `[${label}] 内容底部留白够`);
        check(Math.abs(r.contentH - (-lastBottom + PAD_BOTTOM)) < 0.01, `[${label}] 内容高 = 末段底边 + 底部留白`);
        for (let i = 0; i < r.segs.length - 1; i++) {
            const gap = r.segs[i].bottom - r.segs[i + 1].top;
            check(gap === SEC_GAP && gap > 0, `[${label}] "${r.segs[i].name}" → "${r.segs[i + 1].name}" 间距 ${gap} == SEC_GAP`);
        }
    }

    // 字号下限: 这一页就是"给新玩家读的", 不许再缩回去
    check(CAP_FONT >= 32, `章节标题字号 ${CAP_FONT} ≥ 32`);
    check(LINE_FONT >= 26, `正文字号 ${LINE_FONT} ≥ 26`);
    check(FAN_NAME_FONT >= 28, `番型名字号 ${FAN_NAME_FONT} ≥ 28`);
    check(FAN_FONT >= 24, `番数与说明字号 ${FAN_FONT} ≥ 24`);
    check(FAN_ROW_H >= FAN_NAME_FONT + 16, `番型表行高 ${FAN_ROW_H} 装得下 ${FAN_NAME_FONT} 号字`);

    // 正文行的文字框: 每行都要放得下(超宽说明该拆行, 不能被 SHRINK 压小)
    let longest = 0;
    for (const s of [...MAHJONG_SECTIONS, ...DRAW_SECTIONS]) {
        for (const line of s.lines) {
            const need = textWidth(line, LINE_FONT) + 8;
            longest = Math.max(longest, need);
            check(need <= CONTENT_W, `正文行放得下(${need.toFixed(0)} ≤ ${CONTENT_W}): "${line.slice(0, 14)}…"`);
        }
    }
    console.log(`  最长正文行 ${longest.toFixed(0)}px / 内容宽 ${CONTENT_W}px`);
}

// ================================================================ 2
console.log('\n[2] 番型表: 每行都放得下 + 数据来自 FAN_DEFS');
{
    const perCol = Math.ceil(FAN_ROWS.length / 2);
    check(2 * FAN_COL_W + FAN_COL_GAP <= CONTENT_W + 0.5,
        `两列总宽 ${(2 * FAN_COL_W + FAN_COL_GAP).toFixed(0)} ≤ 内容宽 ${CONTENT_W}`);
    check(2 * FAN_COL_W + FAN_COL_GAP <= MENU_W, '番型表横向不出屏');
    check(FAN_ROW_H >= FAN_NAME_FONT + 8, `行高 ${FAN_ROW_H} 装得下名称字号 ${FAN_NAME_FONT}`);
    check(FAN_ROWS.length === FAN_DEFS.length + 1, `表格 ${FAN_ROWS.length} 行 = 番型 ${FAN_DEFS.length} 条 + 连庄`);

    const names = new Set<string>();
    for (const r of FAN_ROWS) {
        check(!names.has(r.name), `番型名唯一: ${r.name}`);
        names.add(r.name);
        check(textWidth(r.name, FAN_NAME_FONT) + 8 <= FAN_NAME_W,
            `名称列放得下 "${r.name}"`, `${(textWidth(r.name, FAN_NAME_FONT) + 8).toFixed(0)} ≤ ${FAN_NAME_W}`);
        const fanW = textWidth(r.fanText, FAN_FONT) + 8;
        const descW = FAN_COL_W - FAN_NAME_W - fanW;
        check(descW >= textWidth(r.desc, FAN_FONT) + 8,
            `"${r.name}" 的说明放得下`, `需要 ${(textWidth(r.desc, FAN_FONT) + 8).toFixed(0)} ≤ ${descW.toFixed(0)}`);
        check(r.desc.length > 0, `"${r.name}" 有触发条件说明`);
    }
    // 每列的"名称 + 番数 + 说明"必须整列排完不越界
    check(FAN_NAME_W + 200 < FAN_COL_W, `列宽 ${FAN_COL_W} 够分给"名称 + 番数 + 说明"`);
    void perCol;
}

// ================================================================ 3
console.log('\n[3] 同源: 判定与说明页读同一张表');
{
    let id = 5000;
    const t = (suit: TileSuit, rank: number): Tile => new Tile(id++, suit, rank);
    const m = (n: number): Tile => t(TileSuit.WAN, n);
    const ti = (n: number): Tile => t(TileSuit.TIAO, n);
    const p = (n: number): Tile => t(TileSuit.TONG, n);
    const f = (n: number): Tile => t(TileSuit.FENG, n);
    const j = (n: number): Tile => t(TileSuit.JIAN, n);

    /** 常见牌型(每种都构造出来, 复核"判定出的番数 == 表里的番数") */
    const cases: { name: string; hand: Tile[]; ctx?: Partial<Parameters<typeof computeHu>[0]> }[] = [
        { name: '平胡 · 门清自摸', hand: [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), ti(1), ti(2), ti(3), p(5), p(5)] },
        { name: '七对', hand: [m(1), m(1), m(2), m(2), m(3), m(3), m(4), m(4), ti(1), ti(1), ti(2), ti(2), p(5), p(5)] },
        { name: '清一色', hand: [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), m(1), m(1), m(1), m(5), m(5)] },
        { name: '对对胡', hand: [m(1), m(1), m(1), ti(2), ti(2), ti(2), p(3), p(3), p(3), m(9), m(9), m(9), p(5), p(5)] },
        { name: '混一色', hand: [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), m(1), m(1), m(1), f(1), f(1)] },
        { name: '字一色', hand: [f(1), f(1), f(1), f(2), f(2), f(2), f(3), f(3), f(3), f(4), f(4), f(4), j(1), j(1)] },
        {
            name: '十三幺',
            hand: [m(1), m(1), m(9), ti(1), ti(9), p(1), p(9), f(1), f(2), f(3), f(4), j(1), j(2), j(3)],
        },
        { name: '杠上开花 + 抢杠 + 海底 + 立直', hand: [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), ti(1), ti(2), ti(3), p(5), p(5)],
          ctx: { isAfterKan: true, isRobKan: true, isLastTile: true, declaredTenpai: true } },
        { name: '连庄×3(上限)', hand: [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), ti(1), ti(2), ti(3), p(5), p(5)],
          ctx: { streak: 5 } },
    ];

    const table = new Map(FAN_DEFS.map(d => [d.name, d.fan]));
    let sawFixed = 0;
    for (const c of cases) {
        // 先确认构造的牌型真的能胡(不然下面的断言是"空跑")
        check(HuChecker.isHu(c.hand, []), `用例 "${c.name}" 确实是和牌牌型`);
        const hu = computeHu({
            hand: c.hand, melds: [], isSelfDraw: false, isAfterKan: false, isLastTile: false,
            isRobKan: false, streak: 1, declaredTenpai: false, ...(c.ctx ?? {}),
        } as any);
        check(hu.fans.length > 0, `"${c.name}" 判出了番型`);
        for (const item of hu.fans) {
            if (item.name.indexOf('连庄×') === 0) continue;   // 连庄是动态番数, 单独断言
            sawFixed++;
            check(table.has(item.name), `"${item.name}" 在 FAN_DEFS 里有定义`);
            check(table.get(item.name) === item.fan,
                `"${item.name}" 的番数与说明页一致(表 ${table.get(item.name)} == 判定 ${item.fan})`);
        }
    }
    check(sawFixed >= 8, `覆盖了 ${sawFixed} 条固定番型(判定的每条都在表里)`);

    // 连庄: 番数 = min(连庄次数-1, STREAK_FAN_MAX)
    const streakHu = computeHu({
        hand: [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), ti(1), ti(2), ti(3), p(5), p(5)],
        melds: [], isSelfDraw: false, isAfterKan: false, isLastTile: false,
        isRobKan: false, streak: 5, declaredTenpai: false,
    } as any);
    const streakItem = streakHu.fans.filter(x => x.name.indexOf('连庄×') === 0)[0];
    check(!!streakItem && streakItem.fan === STREAK_FAN_MAX,
        `连庄封顶 +${STREAK_FAN_MAX} 番(第 5 次连庄)`, `实际 ${streakItem ? streakItem.fan : '无'}`);

    // 源码级: computeHu 里不能再出现"写死的番数"
    const scoreCode = stripComments(scoreSrc);
    const hardcoded = /fans\.push\(\{\s*name:\s*'[^']+',\s*fan:\s*\d/.test(scoreCode)
        || /fan:\s*FAN_[A-Z_]+/.test(scoreCode);
    check(!hardcoded, 'computeHu 里没有写死的番数(一律走 pushFan → FAN_DEFS)');
    const pushed = (scoreCode.match(/pushFan\(fans, '([^']+)'\)/g) || [])
        .map(s => /'([^']+)'/.exec(s)![1]);
    check(pushed.length >= 12, `computeHu 命中 ${pushed.length} 个固定番型`);
    for (const name of pushed) {
        check(table.has(name), `computeHu 里的 "${name}" 在 FAN_DEFS 里有定义`);
    }
    check(scoreCode.indexOf("fans.push({ name: `连庄×") >= 0, '连庄番单独 push(番数随次数变化, 不进表)');
    // 说明页侧: 番数文案必须是插值出来的, 不能是手写数字
    check(/fanText: `\$\{d\.fan\} 番`/.test(menuSrc), '说明页的番数文案由 FAN_DEFS 插值生成');
    check(/fanText: `最多 \+\$\{STREAK_FAN_MAX\} 番`/.test(menuSrc), '连庄行的番数文案由 STREAK_FAN_MAX 插值生成');

    // README 的番型表也是这份数据的一份拷贝 —— 一并核对
    for (const d of FAN_DEFS) {
        const re = new RegExp(`${d.name}[^｜|\\n]{0,4}?\\s${d.fan}\\b`);
        check(re.test(readme), `README 番型表里 "${d.name}" 也是 ${d.fan} 番`);
    }
}

// ================================================================ 4
console.log('\n[4] 接线: 主菜单入口 / 页面切换 / 原生补画 / 摘要文本域');
{
    const menu = stripComments(menuSrc);
    check(/this\._buildHelpPage\(\);/.test(menu), 'onLoad 里建了说明页');
    check(/showHelp\(\): void/.test(menu), '有 showHelp() 切页方法');
    check(/bindSafeClick\(helpBtn, \(\) => this\.showHelp\(\)/.test(menu), '主菜单“玩法说明”按钮进的去');
    check(/createButtonNode\('玩法说明'/.test(menu), '主菜单确实有“玩法说明”按钮');
    // 页面互斥经由 _beginShow() 统一处理(2026-10-16 加了淡入淡出过渡:
    // 显隐从各 showXxx 内部移到 _beginShow, 断言覆盖同样的意图 —— 一次只显示一页)
    for (const fn of ['showHome', 'showRules', 'showHelp']) {
        const body = menu.slice(menu.indexOf(`${fn}(): void`), menu.indexOf(`${fn}(): void`) + 700);
        check(/this\._beginShow\(this\.\w+Node\)/.test(body), `${fn}() 经由 _beginShow 切页`);
    }
    const begin = menu.slice(menu.indexOf('private _beginShow'), menu.indexOf('private _beginShow') + 1400);
    check(begin.length > 100, '能从源码提取 _beginShow 的方法体');
    check(/page !== from && page !== to\) page\.active = false/.test(begin),
        '_beginShow 收起非当前页(任何时刻只有一页可见)');
    check(/opTo\.opacity = 255/.test(begin), '_beginShow 保证目标页最终不透明(不会停在半透明)');
    const show = menu.slice(menu.indexOf('showHelp(): void'), menu.indexOf('showHelp(): void') + 800);
    check(/this\._beginShow\(this\._helpNode\)/.test(show), 'showHelp() 显示说明页');
    check(show.includes('repaintButtons(this._helpNode)'), 'showHelp() 里补画按钮(原生平台藏过再亮)');
    check(show.includes('_paintHelpDividers()'), 'showHelp() 里补画分隔线(原生平台 onLoad 画的图形不上屏)');
    check(show.includes('redrawBackdrop()'), 'showHelp() 里重画遮罩');
    const backdrop = menu.slice(menu.indexOf('redrawBackdrop(): void'), menu.indexOf('redrawBackdrop(): void') + 600);
    check(backdrop.includes('_paintHelpDividers()'), 'redrawBackdrop() 也补画分隔线(Main 首帧后走这条路)');
    check(/_helpSeps: Graphics \| null/.test(menu), '分隔线的 Graphics 有字段引用(供补画)');
    check(/_paintHelpDividers\(\): void \{[\s\S]{0,200}?g\.clear\(\)/.test(menu), '补画是幂等的(先 clear)');
    check(/_helpNode: Node \| null/.test(menu), '说明页有独立节点引用');

    // ---- 可读性设施(2026-10-16 晚: 字号加大 + 滚动 + 阅读底板) ----
    const helpBody = menu.slice(menu.indexOf('private _buildHelpPage'), menu.indexOf('private _paintHelpDividers'));
    check(helpBody.includes('this._addPageDim(page)'), '说明页有整页阅读底板(压掉背景干扰)');
    const dimAt = helpBody.indexOf('_addPageDim(page)');
    const firstChildAt = helpBody.indexOf('createButtonNode(');
    check(dimAt > 0 && dimAt < firstChildAt, '底板先建、文字后建(压在文字底下)');
    check(helpBody.includes("this._createScrollPage('HelpScrollView', page)"), '说明页走共用滚动视口');
    check(/this\._commitScrollContent\(sp, -\(y \+ HELP_SEC_GAP\) \+ HELP_PAD_BOTTOM\)/.test(menu),
        '内容高度按实际排版落定(不是写死的)');
    const showBody = menu.slice(menu.indexOf('showHelp(): void'), menu.indexOf('showHelp(): void') + 900);
    check(showBody.includes('_paintPageDims()'), 'showHelp 会补画阅读底板(原生平台 onLoad 画的会丢)');
    check(/if \(this\._helpScroll\) this\._helpScroll\.barKey = '#';/.test(showBody), 'showHelp 强制重画滚动条');
    check(BAR_MIN_H >= 40, `滚动条滑块最小高 ${BAR_MIN_H} ≥ 40(看得见)`);
    // 滚动条与正文的横向关系: 滑块在视口右缘内侧, 不压正文(正文最宽到 CONTENT_W)
    const barX = CONTENT_W / 2 - num(menuSrc, 'SCROLL_BAR_RIGHT');
    check(barX - num(menuSrc, 'SCROLL_BAR_W') / 2 > 0, `滚动条在视口右半边(x=${barX})`);

    // ---- 玩法分页(2026-10-18: 「麻将 / 抽牌」标签, 切换重建滚动内容) ----
    check(/_helpMode: 'mahjong' \| 'draw'/.test(menu), '说明页有当前玩法字段');
    check(/_setHelpMode\(mode: 'mahjong' \| 'draw'\)/.test(menu), '有 _setHelpMode 切换方法');
    check(/_fillHelpContent\(\): void/.test(menu), '有 _fillHelpContent 按玩法重建滚动内容');
    check(/this\._helpMode === 'draw' \? HELP_SECTIONS_DRAW : HELP_SECTIONS_MAHJONG/.test(menu),
        '内容填充按玩法选数据(两组各归各)');
    check(/bindSafeClick\(this\._helpTabDraw, \(\) => this\._setHelpMode\('draw'\)/.test(menu),
        '「抽牌」标签接上切换');
    check(/bindSafeClick\(this\._helpTabMahjong, \(\) => this\._setHelpMode\('mahjong'\)/.test(menu),
        '「麻将」标签接上切换');
    check(/restyleButton\(btn, selected \? BTN_PRIMARY : LINE_GHOST,/.test(menu),
        '标签选中态用实心/描边区分(与主菜单模式按钮同一套语言)');
    check(/sp\.sv\.scrollToTop\(0\)/.test(menu), '切换玩法后回到内容顶部');
    // 标签尺寸常量 + 位置: 右缘不越界、两枚不撞车、不压居中标题
    const tabW = num(menuSrc, 'HELP_TAB_W');
    const tabH = num(menuSrc, 'HELP_TAB_H');
    const tabGap = num(menuSrc, 'HELP_TAB_GAP');
    const tabEdge = num(menuSrc, 'HELP_TAB_EDGE');
    const tab1X = MENU_W / 2 - tabEdge - tabW / 2;
    check(tab1X + tabW / 2 <= MENU_W / 2, `标签右缘 ${tab1X + tabW / 2} ≤ 内容右缘 ${MENU_W / 2}`);
    check(tab1X - tabW - tabGap - tabW / 2 > 300, `标签不压居中标题(左标签左缘 ${tab1X - tabW - tabGap - tabW / 2} > 300)`);
    check(tabH >= 28 + 16, `标签高 ${tabH} 装得下 28 号字(字号 + 上下呼吸位)`);

    // 主菜单: 两个次按钮并排而不是各占一行(纵向不进位)
    check(/const secBtnW = (\d+)/.test(menu) && /const secBtnGap = (\d+)/.test(menu), '次按钮尺寸有具名常量');
    const secW = Number(/const secBtnW = (\d+)/.exec(menu)![1]);
    const secGap = Number(/const secBtnGap = (\d+)/.exec(menu)![1]);
    const rulesPos = /rulesBtn\.setPosition\(-secBtnX, (-?\d+), 0\)/.exec(menu);
    const helpPos = /helpBtn\.setPosition\(secBtnX, (-?\d+), 0\)/.exec(menu);
    check(!!rulesPos && !!helpPos, '两个次按钮的位置能从源码读出来');
    check(2 * secW + secGap <= MENU_W, `次按钮行总宽 ${2 * secW + secGap} ≤ ${MENU_W}`);
    check(secW >= textWidth('设置规则', 28) + 16 && secW >= textWidth('玩法说明', 28) + 16,
        `按钮宽 ${secW} 放得下 4 个字`);
    check(rulesPos![1] === helpPos![1], '两个次按钮同一行');
    const rowY = Number(rulesPos![1]);

    // 主菜单模式区: "麻将"(主模式) 在上, "抽牌" 在下, 两个按钮同款实心胶囊;
    // 次按钮行(设置规则|玩法说明)排在抽牌之下
    check(/createButtonNode\('麻将'/.test(menu), '主菜单确实有“麻将”按钮');
    check(/createButtonNode\('抽牌'/.test(menu), '主菜单确实有“抽牌”按钮');
    check(/const modeW = (\d+)/.test(menu) && /const modeH = (\d+)/.test(menu), '模式按钮尺寸有具名常量');
    const modeW = Number(/const modeW = (\d+)/.exec(menu)![1]);
    const modeH = Number(/const modeH = (\d+)/.exec(menu)![1]);
    check(/createButtonNode\('抽牌', modeW, modeH, BTN_PRIMARY, MENU_BTN_STYLE\)/.test(menu),
        '“抽牌”与“麻将”同款样式(实心琥珀胶囊)');
    check(modeW >= textWidth('麻将', 36) + 16 && modeW >= textWidth('抽牌', 36) + 16,
        `模式按钮宽 ${modeW} 放得下 2 个字`);
    check(modeW <= MENU_W, `模式按钮宽 ${modeW} ≤ ${MENU_W}`);
    const startY = Number(/startBtn\.setPosition\(0, (-?\d+), 0\)/.exec(menu)![1]);
    const drawY = Number(/drawBtn\.setPosition\(0, (-?\d+), 0\)/.exec(menu)![1]);
    check(startY > drawY, `麻将(主模式)排在抽牌之上(${startY} > ${drawY})`);
    check(startY - drawY >= modeH + 8, `麻将与抽牌不撞车(gap=${startY - drawY})`);
    check(drawY - rowY >= modeH / 2 + 41 + 8, `抽牌与次按钮行不撞车(gap=${drawY - rowY})`);
    const sumY = Number(/summary\.setPosition\(0, (-?\d+), 0\)/.exec(menu)![1]);
    const tipY = Number(/tip\.setPosition\(0, (-?\d+), 0\)/.exec(menu)![1]);
    check(startY > rowY && rowY > sumY && sumY > tipY, `主菜单纵向顺序正确(${startY} > ${rowY} > ${sumY} > ${tipY})`);
    check(startY - rowY >= 50 + 41 + 8, `"开始游戏"与次按钮行不撞车(gap=${startY - rowY})`);
    check(rowY - sumY >= 41 + 36, `次按钮行与摘要不撞车(gap=${rowY - sumY})`);
    check(sumY - tipY >= 36, `摘要与操作提示不撞车(gap=${sumY - tipY})`);
    check(tipY - 22 / 2 - 6 > -MENU_H / 2, `操作提示在屏幕内(${tipY} > ${-MENU_H / 2})`);
    // 摘要两行: 文本域高度必须真的按两行给(否则 SHRINK 把字压小, 硬约束 4)
    const sumBox = /createLabelNode\('', 24, TEXT_SUB, 1400, (\d+) \* (\d+)\)/.exec(menuSrc);
    check(!!sumBox, '摘要的文本域高度写法可解析');
    if (sumBox) {
        const h = Number(sumBox[1]) * Number(sumBox[2]);
        check(h >= 2 * (24 + 8), `摘要文本域 ${h} ≥ 两行所需 ${2 * (24 + 8)}(不被 SHRINK 压扁)`);
    }
}

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
process.exit(fails === 0 ? 0 : 1);
