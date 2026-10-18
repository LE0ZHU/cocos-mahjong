/**
 * 对局信息常驻显示复核 —— 从真实源码提取常量, 跑数字
 *
 * 复核四组:
 *  1. 比分条(左上角齿轮右侧)在**各屏幕比例**下: 不压齿轮、不压上家手牌/副露/"听"标记,
 *     四条芯片的文案在最坏(四位数分)情况下仍放得下且有缩放下限
 *  2. 听牌详情芯片(手牌右侧)在**各屏幕比例**下: 不压满手 14 张牌、不压右侧"你·听"标记,
 *     多面听的长文案靠缩放下限兜底, 且不侵入提示面板的落位通道
 *  3. 文案格式(HintAdvisor.tenpaiText / waitingText): 打**真实实现**, 不手抄
 *  4. 行为约束(源码级): 听牌详情由 GameManager 统一算(口径 = Σ(4−可见张数)),
 *     刷新点齐(摸牌/弃牌/副露/开局/结束/返回主页面), 清牌桌会收起跨局状态
 *
 * 【为什么要跑数字而不是"看代码觉得没问题"】这两块信息都贴在牌桌的边角净空里,
 * 而净空大小随屏幕比例、手牌张数、副露数量变化 —— 电脑上预览 16:9 永远看不出
 * 21:9 手机横屏或满手 14 张时的撞车。硬约束 2 的"写死高度必翻车"就是这么来的。
 */
import { HintAdvisor } from '../../assets/scripts/game/HintAdvisor';
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

const mainSrc = fs.readFileSync(findFile('assets/scripts/Main.ts'), 'utf8');
const gmSrc = fs.readFileSync(findFile('assets/scripts/managers/GameManager.ts'), 'utf8');
const hintPanelSrc = fs.readFileSync(findFile('assets/scripts/ui/HintPanel.ts'), 'utf8');

let fails = 0;
function check(cond: boolean, name: string, extra = ''): void {
    if (cond) console.log(`  [OK] ${name}`);
    else { fails++; console.log(`  [FAIL] ${name}${extra ? ' → ' + extra : ''}`); }
}

/** 从源码里取数值常量(模块级 const 与类字段都认) */
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

/** CJK 按字号, 其余半角 —— 与 Main.textWidth / HintPanel.textWidth 一致 */
function textWidth(text: string, font: number): number {
    let w = 0;
    for (const ch of text) w += ch.codePointAt(0)! >= 0x2e80 ? font : font * 0.5;
    return w;
}

/** 剥注释后的源码(源码级断言用) */
function strip(s: string): string {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * 按大括号配平截取一个方法体。
 *
 * 别再用"从方法名起切固定长度"—— `_applyLayout` 每加一段就让后面的断言看不见,
 * 表现出来是"功能明明还在却 FAIL"(2026-10-17 就踩过一次: 加了平板按钮分支后
 * `_placeSeatPlates` 落到 4600 字符之外)。
 */
function bodyOf(code: string, signature: string): string {
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

// ---- 提取真实常量 ----
// 牌尺寸取 BASE_*(基准值): 本脚本校验的是**手机(倍率 1)**的排版。
// 平板把牌按 TILE_SCALE_MAX 放大之后的净空由 tablet-layout-test.ts 的 E 组负责。
// 手牌还要再乘 HAND_SCALE(只作用于自家手牌), 名牌 / 芯片的净空都按它算。
const CONTENT_W = num(mainSrc, 'CONTENT_W');
const HAND_SCALE = num(mainSrc, 'HAND_SCALE');
const HAND_SCALE_TARGET = num(mainSrc, 'HAND_SCALE_TARGET');
const HAND_EDGE_GAP = num(mainSrc, 'HAND_EDGE_GAP');
const OTHERS_SCALE = num(mainSrc, 'OTHERS_SCALE');
const TOP_TILE_W = num(mainSrc, 'BASE_TOP_TILE_W') * OTHERS_SCALE;
// 手机(k=1)的手牌倍率: 目标与「你·听」标记反算取小(复刻 Main._applyTileScale)
const MARK_INNER = (CONTENT_W / 2 - num(mainSrc, 'TENPAI_MARK_INSET'))
    - num(mainSrc, 'TENPAI_MARK_W') / 2 - HAND_EDGE_GAP;
const HAND_SCALE_NOW = Math.max(HAND_SCALE, Math.min(HAND_SCALE_TARGET,
    MARK_INNER / (7 * num(mainSrc, 'BASE_TILE_W'))));
const TILE_W = num(mainSrc, 'BASE_TILE_W') * HAND_SCALE_NOW;
const TILE_H = num(mainSrc, 'BASE_TILE_H') * HAND_SCALE_NOW;
const RIVER_TILE_W = num(mainSrc, 'BASE_RIVER_TILE_W') * OTHERS_SCALE;
const RIVER_GAP = num(mainSrc, 'RIVER_GAP');
const MELD_MARK_GAP = num(mainSrc, 'MELD_MARK_GAP');
const SCORE_CHIP_H = num(mainSrc, 'SCORE_CHIP_H');
const SCORE_FONT = num(mainSrc, 'SCORE_FONT');
const SCORE_CHIP_PAD = num(mainSrc, 'SCORE_CHIP_PAD');
const SCORE_CHIP_GAP = num(mainSrc, 'SCORE_CHIP_GAP');
const SCORE_STRIP_GAP = num(mainSrc, 'SCORE_STRIP_GAP');
const SCORE_HAND_GAP = num(mainSrc, 'SCORE_HAND_GAP');
const TENPAI_CHIP_H = num(mainSrc, 'TENPAI_CHIP_H');
const TENPAI_FONT = num(mainSrc, 'TENPAI_FONT');
const TENPAI_CHIP_PAD = num(mainSrc, 'TENPAI_CHIP_PAD');
const CHIP_EDGE_PAD = num(mainSrc, 'CHIP_EDGE_PAD');
const TENPAI_MARK_H = num(mainSrc, 'TENPAI_MARK_H');
const TENPAI_HAND_GAP = num(mainSrc, 'TENPAI_HAND_GAP');
const CHIP_MIN_SCALE = num(mainSrc, 'CHIP_MIN_SCALE');

const halfW = CONTENT_W / 2;
/** 与 Main._tileH 同比例 */
function tileH(w: number): number { return (w * TILE_H) / TILE_W; }

/** 各屏幕比例下的可见半高(见 AGENTS.md 硬约束 2) */
const SCREENS: { name: string; halfH: number }[] = [
    { name: '16:9  (1920×1080)', halfH: 840 / (1920 / 1080) },
    { name: '19.5:9 (2340×1080)', halfH: 840 / (2340 / 1080) },
    { name: '21:9  (2520×1080)', halfH: 840 / (2520 / 1080) },
    { name: '超宽 (3440×1440)', halfH: 840 / (3440 / 1440) },
    { name: '竖屏 (1080×2400)', halfH: 840 / (1080 / 2400) },
];

// ================================================================ 1
console.log('\n[1] 比分条: 左上角齿轮右侧那条净空里完整放得下');
{
    // 齿轮按钮几何(从源码提取, 不手抄): 位置式 = -CONTENT_W/2 + pad + w/2, 尺寸 = 64×64
    const btnRe = /_settingsBtnX\s*=\s*-this\.CONTENT_W\s*\/\s*2\s*\+\s*(\d+)\s*\+\s*(\d+)/.exec(mainSrc);
    const btnSize = /createIconButton\(\s*'icons\/settings'\s*,\s*(\d+)\s*,\s*(\d+)/.exec(mainSrc);
    check(!!btnRe && !!btnSize, '能从源码提取齿轮按钮的位置式与尺寸');
    const pad = Number(btnRe![1]);
    const btnW = Number(btnSize![1]);
    check(Number(btnRe![2]) === btnW / 2, '位置式里的半宽项与按钮尺寸一致', `实际半宽 ${btnW / 2}`);

    // 复刻 Main._applyLayout 的两条边界 + _refreshScoreStrip 的居中与缩放
    const settingsBtnX = -CONTENT_W / 2 + pad + btnW / 2;
    const stripLeft = settingsBtnX + btnW / 2 + SCORE_STRIP_GAP;
    const stripRight = -(14 * TOP_TILE_W) / 2 - SCORE_HAND_GAP;
    const maxW = stripRight - stripLeft;
    console.log(`  齿轮右缘 ${(settingsBtnX + btnW / 2).toFixed(0)} → 比分条左界 ${stripLeft.toFixed(0)}, ` +
        `右界 ${stripRight.toFixed(0)}(上家满手 14 张的左缘 ${(-14 * TOP_TILE_W / 2).toFixed(0)}), 预算宽 ${maxW.toFixed(0)}`);

    check(stripLeft > settingsBtnX + btnW / 2, '比分条在齿轮右侧(留出间距)', `gap=${SCORE_STRIP_GAP}`);
    check(stripRight < -(14 * TOP_TILE_W) / 2, '比分条右界在上家满手 14 张左侧(留出间距)', `gap=${SCORE_HAND_GAP}`);
    check(stripRight <= halfW && stripLeft >= -halfW, '比分条区间不越出内容坐标系(±840)');
    check(maxW > 300, `可用宽度 ${maxW.toFixed(0)} 够放四个芯片`);

    /** 最坏文案: 累计分到四位数 + 最长的座位名("上家") */
    const CASES: { label: string; texts: string[] }[] = [
        { label: '开局(全 0)', texts: ['你 0', '上家 0', '左家 0', '右家 0'] },
        { label: '常见(两三位数)', texts: ['你 +12', '上家 -4', '左家 +128', '右家 -36'] },
        { label: '最坏(四位数)', texts: ['你 +1234', '上家 -2345', '左家 +9999', '右家 -1'] },
    ];
    for (const c of CASES) {
        const widths = c.texts.map(t => textWidth(t, SCORE_FONT) + SCORE_CHIP_PAD * 2);
        let total = (widths.length - 1) * SCORE_CHIP_GAP;
        for (const w of widths) total += w;
        const scale = total > maxW ? Math.max(CHIP_MIN_SCALE, maxW / total) : 1;
        check(total * scale <= maxW + 0.5, `${c.label}: 缩放后总宽 ${(total * scale).toFixed(0)} ≤ 预算 ${maxW.toFixed(0)}`,
            `未缩放 ${total.toFixed(0)} scale=${scale.toFixed(2)}`);
        check(scale >= CHIP_MIN_SCALE - 1e-6, `${c.label}: 缩放不低于下限 ${CHIP_MIN_SCALE}`, `实际 ${scale.toFixed(2)}`);
        // 芯片里是"名字 + 空格 + 分数"两个左对齐 Label 拼出来的:
        // 两段字宽 + 一个空格宽必须正好等于整串宽(否则文字会溢出芯片内边距, 或被 SHRINK 压扁)
        for (let i = 0; i < c.texts.length; i++) {
            const sp = c.texts[i].indexOf(' ');
            const nameW = textWidth(c.texts[i].slice(0, sp), SCORE_FONT);
            const scoreW = textWidth(c.texts[i].slice(sp + 1), SCORE_FONT);
            const gapW = SCORE_FONT * 0.5;
            check(Math.abs(nameW + gapW + scoreW - textWidth(c.texts[i], SCORE_FONT)) < 1e-6,
                `${c.label}: "${c.texts[i]}" 两段字宽 + 空格 = 整串宽`);
            check(widths[i] - SCORE_CHIP_PAD * 2 - 4 >= 0,
                `${c.label}: "${c.texts[i]}" 文本域留白足够(不贴边)`,
                `${widths[i] - SCORE_CHIP_PAD * 2}`);
        }
    }

    // 纵向: 比分条与齿轮同排; 该带横向与上家手牌错开, 但要防住"副露行/听标记"在纵向撞上
    const topTileH = tileH(TOP_TILE_W);
    const meldH = tileH(RIVER_TILE_W);
    for (const s of SCREENS) {
        const halfH = s.halfH;
        const settingsBtnY = halfH - 8 - 32;
        const stripTop = settingsBtnY + SCORE_CHIP_H / 2;
        const stripBottom = settingsBtnY - SCORE_CHIP_H / 2;
        check(stripTop <= halfH && stripBottom >= -halfH, `${s.name}: 比分条在可见区内`,
            `[${stripBottom.toFixed(0)}, ${stripTop.toFixed(0)}] halfH=${halfH.toFixed(0)}`);
        // 上家副露行上沿: 上家手牌上沿(halfH−8) → 减去牌高 → 减 MELD_MARK_GAP
        const topMeldTop = halfH - 8 - topTileH - MELD_MARK_GAP;
        check(stripBottom - topMeldTop > 0, `${s.name}: 比分条不压上家副露行`,
            `gap=${(stripBottom - topMeldTop).toFixed(1)}`);
        // (原先这里还查"比分条不压 上家·听 标记": 2026-10-17 起三家的听牌状态
        //  并进了各自的名牌, 四角不再挂独立的"xx·听"小牌, 这条自然失效)
    }
    // 横向: 上家手牌最宽情形(14 张)与比分条必须错开(比分条整条都在手牌左侧)
    check(-(14 * TOP_TILE_W) / 2 - stripRight > 0, '比分条与上家手牌横向错开',
        `gap=${SCORE_HAND_GAP}`);
}

// ================================================================ 2
console.log('\n[2] 听牌详情芯片: 抬到手牌上方, 右贴边、左让满副露');
{
    // 芯片整块在手牌上沿之上(手牌放到 1.45 后, 行内右侧只剩「你·听」标记那点空)
    const chipRight = halfW - CHIP_EDGE_PAD;
    const chipDy = TILE_H / 2 + TENPAI_CHIP_H / 2 + 8;
    const chipBottomRel = chipDy - TENPAI_CHIP_H / 2;
    check(chipBottomRel >= TILE_H / 2 + 8 - 0.01,
        `芯片底 ${chipBottomRel.toFixed(0)} 在手牌上沿 ${(TILE_H / 2).toFixed(0)} 之上`,
        `gap=${(chipBottomRel - TILE_H / 2).toFixed(1)}`);
    // 左界 = 满副露右沿 + 16 呼吸(副露居中, 最多 16 张)
    const meldRight = (16 * RIVER_TILE_W) / 2 + 16;
    const maxW = chipRight - meldRight;
    check(maxW > 300, `可用宽度 ${maxW.toFixed(0)} 够放典型文案`);

    /**
     * 文案最坏组合(实际会出现的字符串):
     *  - 单面/两面听是最常见的
     *  - 三花色 + 字牌的多元听会明显更长
     */
    const CASES: string[] = [
        '听 3/6萬 · 余 4 张',
        '听 2/3/4/5/6萬 · 余 12 张',
        '听 1/4/7條 3/6筒 · 余 8 张',
        '听 1/4/7萬 2/5筒 东/中 · 余 9 张',
    ];
    let widest = 0;
    for (const text of CASES) {
        const w = textWidth(text, TENPAI_FONT) + TENPAI_CHIP_PAD * 2;
        widest = Math.max(widest, w);
        const scale = w > maxW ? Math.max(CHIP_MIN_SCALE, maxW / w) : 1;
        check(w * scale <= maxW + 0.5, `"${text}" 缩放后 ${(w * scale).toFixed(0)} ≤ 预算 ${maxW.toFixed(0)}`,
            `未缩放 ${w.toFixed(0)} scale=${scale.toFixed(2)}`);
        check(scale >= CHIP_MIN_SCALE - 1e-6, `"${text}" 缩放不低于下限`, `实际 ${scale.toFixed(2)}`);
        // 左缘不能压到满副露(它和芯片同一纵向带)
        const left = chipRight - w * scale;
        check(left >= meldRight - 0.5, `"${text}" 左缘 ${left.toFixed(0)} ≥ 满副露右沿 ${meldRight.toFixed(0)}`);
        check(w - 4 >= textWidth(text, TENPAI_FONT), `"${text}" 文本域够宽(不 SHRINK)`);
    }

    // 提示面板(居中的浮动卡片)最宽时也不能横着压到芯片
    const hintPadX = num(hintPanelSrc, 'PAD_X');
    const HINT_WORST: { t: string; f: number }[] = [
        { t: '打出 三萬', f: 40 },
        { t: '听牌 · 8 张进张 · 危险牌, 有人可能点炮', f: 26 },
        { t: '次选　打出 五筒　1 向听 · 12 张进张 · 安全牌', f: 24 },
        { t: '次选　碰 五萬　手牌慢 1 档 · 会失去门清 +1 番', f: 24 },
    ];
    let hintContentW = 64 + 16;   // 关闭按钮占位(与 HintPanel._buildContent 一致)
    for (const h of HINT_WORST) hintContentW = Math.max(hintContentW, textWidth(h.t, h.f) + 8);
    const hintHalfW = (hintContentW + hintPadX * 2) / 2;
    check(hintHalfW + 12 < chipRight - widest,
        '提示面板最宽情形也够不到芯片(横向错开)',
        `面板半宽 ${hintHalfW.toFixed(0)} + 12 < 芯片左缘 ${(chipRight - widest).toFixed(0)}`);

    // 纵向: 芯片整体在手牌上方, 且不侵入上方的副露行 / 牌河
    const rivH = tileH(RIVER_TILE_W);
    for (const s of SCREENS) {
        const halfH = s.halfH;
        const handY = -halfH + TILE_H / 2 + 8;
        const chipTop = handY + chipDy + TENPAI_CHIP_H / 2;
        const chipBottom = handY + chipDy - TENPAI_CHIP_H / 2;
        check(chipTop <= halfH && chipBottom >= -halfH, `${s.name}: 听牌芯片在可见区内`,
            `[${chipBottom.toFixed(0)}, ${chipTop.toFixed(0)}]`);
        const handTop = handY + TILE_H / 2;
        check(chipBottom >= handTop - 0.01, `${s.name}: 听牌芯片整体在手牌上沿之上`,
            `gap=${(chipBottom - handTop).toFixed(1)}`);
        // 副露行中心在上方一处, 牌河再上一层: 芯片只允许压到副露行的纵向带
        const meldY = handY + TILE_H / 2 + rivH / 2 + MELD_MARK_GAP;
        const riverBottom = meldY + rivH / 2 + MELD_MARK_GAP;
        check(chipTop <= riverBottom + 0.01, `${s.name}: 芯片不顶到牌河行`,
            `chipTop=${chipTop.toFixed(0)} riverBottom=${riverBottom.toFixed(0)}`);
    }
}

// ================================================================ 3
console.log('\n[3] 文案格式(打真实 HintAdvisor)');
{
    let id = 9000;
    const t = (suit: TileSuit, rank: number): Tile => new Tile(id++, suit, rank);
    const mk = (specs: string[]): Tile[] => specs.map(sp => {
        const rank = +sp.slice(1);
        if (sp[0] === 'm') return t(TileSuit.WAN, rank);
        if (sp[0] === 't') return t(TileSuit.TIAO, rank);
        if (sp[0] === 'p') return t(TileSuit.TONG, rank);
        if (sp[0] === 'f') return t(TileSuit.FENG, rank);
        if (sp[0] === 'j') return t(TileSuit.JIAN, rank);
        throw new Error(`无法解析: ${sp}`);
    });

    check(HintAdvisor.waitingText(mk(['m3', 'm6'])) === '3/6萬', '两张万: 合并成 3/6萬',
        HintAdvisor.waitingText(mk(['m3', 'm6'])));
    check(HintAdvisor.waitingText(mk(['m6', 'm3'])) === '3/6萬', '乱序输入也按点数排序',
        HintAdvisor.waitingText(mk(['m6', 'm3'])));
    check(HintAdvisor.waitingText(mk(['t1', 't4', 't7'])) === '1/4/7條', '三张条: 1/4/7條',
        HintAdvisor.waitingText(mk(['t1', 't4', 't7'])));
    check(HintAdvisor.waitingText(mk(['f1', 'j3'])) === '东/白', '字牌逐张列: 东/白',
        HintAdvisor.waitingText(mk(['f1', 'j3'])));
    check(HintAdvisor.waitingText(mk(['p5', 'm2', 't9', 'j1'])) === '2萬 9條 5筒 中',
        '混合听: 花色按 万→条→筒→字 分组', HintAdvisor.waitingText(mk(['p5', 'm2', 't9', 'j1'])));
    check(HintAdvisor.waitingText([]) === '', '空听返回空串(调用方自己判空)');

    check(HintAdvisor.tenpaiText(mk(['m3', 'm6']), 4) === '3/6萬 · 余 4 张', '完整文案(用户要求的格式)',
        HintAdvisor.tenpaiText(mk(['m3', 'm6']), 4));
    check(HintAdvisor.tenpaiText(mk(['f1']), 0) === '东 · 余 0 张', '余 0 张(四张都明在桌上)照实显示',
        HintAdvisor.tenpaiText(mk(['f1']), 0));
    // 文案里不能出现"种"这种口径词: 给玩家看的永远是实际张数(硬约束 13d)
    const line = HintAdvisor.tenpaiText(mk(['m3']), 3);
    check(line.indexOf('种') < 0, '文案用"张"而不是"种类"', line);

    // 格式化结果必须只用半角数字 + 花色字: 常驻芯片很窄, 汉字数字会占两倍宽
    const wide = textWidth(HintAdvisor.tenpaiText(mk(['m3', 'm6']), 4), TENPAI_FONT);
    const narrowLimit = textWidth('听 三萬/六萬 · 余 4 张', TENPAI_FONT);
    check(wide < narrowLimit, `阿拉伯数字写法更窄(${wide.toFixed(0)} < ${narrowLimit.toFixed(0)})`);
}

// ================================================================ 4
console.log('\n[4] 行为约束(源码级)');
{
    const gm = strip(gmSrc);
    const main = strip(mainSrc);

    // ---- GameManager: 详情由它统一算, 口径与提示同源 ----
    check(gm.includes('onTenpaiInfo'), 'GameManager 暴露 onTenpaiInfo(常驻详情的唯一数据源)');
    check(/interface\s+TenpaiInfo/.test(gm), '有 TenpaiInfo 类型(听牌张 + 剩余张数)');
    const flag = gm.slice(gm.indexOf('private _refreshTenpaiFlag'), gm.indexOf('private _refreshTenpaiFlag') + 1600);
    check(flag.includes('_refreshTenpaiInfo'), '_refreshTenpaiFlag 里刷新听牌详情(摸牌/弃牌/副露都会经过)');
    check(/this\._refreshTenpaiInfo\(announce\s*&&\s*seat\s*===\s*0\)/.test(flag),
        '只有玩家摸牌才顺带"刚听牌"提醒(别家弃牌只静默更新剩余张数)');
    const build = gm.slice(gm.indexOf('private _buildTenpaiInfo'), gm.indexOf('private _buildTenpaiInfo') + 1600);
    check(build.includes('_playerDrawnTile'), '刚摸到的那张不参与听牌判定(与听牌标记同一口径)');
    check(build.includes('_buildAIContext(0)'), '可见张数复用 AI 视角的公开信息(玩家看不到别家手牌)');
    check(/Math\.max\(0,\s*4\s*-\s*visible\[/.test(build), '剩余张数 = Σ(4 − 可见张数)(与提示同口径)');
    check(/GamePhase\.DEALING/.test(build) && /GamePhase\.GAME_OVER/.test(build),
        '发牌中与牌局结束不出详情(不给没有意义的信息)');
    check(gm.includes('_tenpaiInfoKey'), '有变更指纹去重(局面没变不重建 UI)');
    // 刷新点必须齐: 开局 / 流局胡牌 / 返回主页面
    const startBody = gm.slice(gm.indexOf('startGame(rules'), gm.indexOf('startGame(rules') + 2200);
    check(startBody.includes('_refreshTenpaiInfo'), 'startGame 里清掉上一局的详情');
    const endBody = gm.slice(gm.indexOf('private _endGame'), gm.indexOf('private _endGame') + 900);
    check(endBody.includes('_refreshTenpaiInfo'), '_endGame 里收起详情(牌局结束后不再显示"听 X")');
    const stopBody = gm.slice(gm.indexOf('stopGame()'), gm.indexOf('stopGame()') + 700);
    check(stopBody.includes('_refreshTenpaiInfo'), 'stopGame(返回主页面)里收起详情');

    // ---- Main: 接线 / 定位 / 跨局归零 ----
    check(main.includes('gm.onTenpaiInfo ='), 'Main 接了 onTenpaiInfo');
    check(/onTenpaiInfo\s*=\s*\(info\)\s*=>\s*\{[\s\S]{0,200}?_showTenpaiChip/.test(main),
        '有详情就显示芯片');
    check(/else\s+this\._hideTenpaiChip\(\)/.test(main), '没详情(未听牌/结束)就收起芯片');
    const refreshInfo = main.slice(main.indexOf('private _refreshInfo()'), main.indexOf('private _refreshInfo()') + 600);
    check(refreshInfo.includes('_refreshScoreStrip'), '_refreshInfo 里刷新比分条');
    const clearTable = main.slice(main.indexOf('private _clearTable()'), main.indexOf('private _clearTable()') + 2600);
    check(clearTable.includes('_hideTenpaiChip'), '_clearTable 收起听牌芯片(跨局不残留)');
    check(/_scoreSig\s*=\s*''/.test(clearTable), '_clearTable 清比分条指纹(下一局强制重建)');
    const applyLayout = bodyOf(main, 'private _applyLayout(');
    check(applyLayout.includes('_scoreStrip?.setPosition'), '_applyLayout 定位比分条(转屏跟着走)');
    check(applyLayout.includes('_placeTenpaiChip'), '_applyLayout 重排听牌芯片');
    check(/_scoreStripMaxW\s*=/.test(applyLayout), '_applyLayout 算出比分条的可用宽度(供超长缩放)');
    const layer = main.slice(main.indexOf('private _applyLayerOrder()'), main.indexOf('private _applyLayerOrder()') + 1600);
    check(layer.includes('push(this._scoreStrip)') && layer.includes('push(this._tenpaiChip)'),
        '两块常驻信息都排在牌面之上');
    // 原生平台(JSB): onLoad 期间画的 Graphics 不上屏, 首帧后必须补画一次
    check(/_refreshScoreStrip\(true\)/.test(main), '有强制重建入口(首帧补画 / 隐藏过再显示)');
    const drawStatic = main.slice(main.indexOf('private _drawStaticGraphics'), main.indexOf('private _drawStaticGraphics') + 900);
    check(drawStatic.includes('_refreshScoreStrip(true)'), '首帧后补画比分条');
    check(/CHIP_TEXT_WARN/.test(main) && /remain\s*>\s*0\s*\?\s*CHIP_TEXT\s*:\s*CHIP_TEXT_WARN/.test(main),
        '余 0 张用警示色(等不到了, 别干等)');
    // 硬约束 1: target 是 ES2015, 不能用 Array.prototype.includes
    check(main.indexOf('.includes(') < 0, 'Main.ts 里没有 Array.prototype.includes(ES2015 约束)');

    // 旧的一次性提醒文案已换成新格式(与常驻芯片同源, 不再各写一套)
    const showTenpai = main.slice(main.indexOf('private _showTenpai('), main.indexOf('private _showTenpai(') + 500);
    check(showTenpai.includes('HintAdvisor.tenpaiText'), '一次性提醒也走同一份文案(不会"说一套显示一套")');
    check(!/可胡:/.test(showTenpai), '旧的“可胡: X Y”文案已替换');
}

// ================================================================ 5
console.log('\n[5] 座位名牌(三家 AI: 名字 + 连庄角标): 贴着各自手牌外侧, 不压牌也不压按钮');
{
    const SEAT_PLATE_H = num(mainSrc, 'SEAT_PLATE_H');
    const SEAT_PLATE_FONT = num(mainSrc, 'SEAT_PLATE_FONT');
    const SEAT_PLATE_PAD = num(mainSrc, 'SEAT_PLATE_PAD');
    const SEAT_PLATE_GAP = num(mainSrc, 'SEAT_PLATE_GAP');
    const MARK_W = num(mainSrc, 'TENPAI_MARK_W');
    const MARK_INSET = num(mainSrc, 'TENPAI_MARK_INSET');
    const HINT_BTN_H = num(mainSrc, 'HINT_BTN_H');

    // 名牌宽度: 名字(2 汉字, AIPersona 的硬约束) + 可选"·听"标签 + 可选角标 ×N + 内边距
    const nameW = textWidth('老陈', SEAT_PLATE_FONT);
    const tagW = textWidth('·听', SEAT_PLATE_FONT);          // 报听后才有
    const badgeW = textWidth('×9', SEAT_PLATE_FONT);          // 最坏一位数角标; 两位再宽 10px
    const gapW = SEAT_PLATE_FONT * 0.3;
    const plateW = nameW + tagW + badgeW + gapW + SEAT_PLATE_PAD * 2;
    check(nameW > 0, `名牌文字宽 ${nameW.toFixed(0)}px(2 汉字 @ ${SEAT_PLATE_FONT})`);

    const stripLeft = -CONTENT_W / 2 + (() => {
        const m = /_settingsBtnX\s*=\s*-this\.CONTENT_W\s*\/\s*2\s*\+\s*(\d+)\s*\+\s*(\d+)/.exec(mainSrc)!;
        return Number(m[1]) + Number(m[2]);                          // pad + 半宽
    })() + Number(/_settingsBtnX\s*=\s*-this\.CONTENT_W\s*\/\s*2\s*\+\s*(\d+)\s*\+\s*(\d+)/.exec(mainSrc)![2])
        + Number(/createIconButton\(\s*'icons\/settings'\s*,\s*(\d+)/.exec(mainSrc)![1]) / 2 + SCORE_STRIP_GAP;
    const stripRight = -(14 * TOP_TILE_W) / 2 - SCORE_HAND_GAP;

    // 上家名牌: 手牌行右端之外(14 张最宽), 与手牌同高
    const topHandRight = (14 * TOP_TILE_W) / 2;
    const plate1Left = topHandRight + SEAT_PLATE_GAP;
    const plate1Right = plate1Left + plateW;
    check(plate1Left >= topHandRight, '上家名牌在手牌右端之外', `left=${plate1Left.toFixed(0)} 手牌右缘=${topHandRight}`);
    check(plate1Right < stripLeft || plate1Left > stripRight,
        '上家名牌与比分条区间不重叠(横向错开)', `名牌 ${plate1Left.toFixed(0)}~${plate1Right.toFixed(0)}, 比分条 ${stripLeft.toFixed(0)}~${stripRight.toFixed(0)}`);

    // 侧名牌: 桌沿外侧那一列, 纵向居中(上方不再挂"xx·听"小牌)
    const sideX = CONTENT_W / 2 - MARK_INSET;
    const sideY = 0;
    check(sideX + plateW / 2 <= CONTENT_W / 2, '侧名牌(含 ·听 与 ×N)不越出内容坐标系(±840)',
        `外缘 ${(sideX + plateW / 2).toFixed(0)}`);

    // 每个屏幕比例下都验一遍: 上家名牌不越界、侧名牌不与玩家按钮行/手牌撞车
    const PLATE_SCREENS = SCREENS.concat([{ name: '3:2 平板', halfH: 560 }, { name: '4:3 iPad', halfH: 630 }]);
    for (const sc of PLATE_SCREENS) {
        // 平板: 牌位被毡布夹住(与 _applyLayout 同一套式子)
        const k = Math.max(1, (sc.halfH + 10) / num(mainSrc, 'TABLE_FAR_HH'));
        const topHalf = Math.min(sc.halfH, num(mainSrc, 'FELT_TILE_TOP') * k);
        const bottomHalf = Math.min(sc.halfH, num(mainSrc, 'FELT_TILE_BOTTOM') * k);
        const topHandY = topHalf - 8 - (TOP_TILE_W * TILE_H) / TILE_W / 2;
        const handY = -bottomHalf + TILE_H / 2 + 8;

        // 上家名牌: 竖直方向不越出可见区, 也不压上家手牌
        check(Math.abs(topHandY) + SEAT_PLATE_H / 2 <= sc.halfH,
            `${sc.name}: 上家名牌在可见区内`, `y=${topHandY.toFixed(0)} 半高=${sc.halfH.toFixed(0)}`);
        check(SEAT_PLATE_H > 0 && plate1Left >= topHandRight, `${sc.name}: 上家名牌不压上家手牌`);

        // 侧名牌: 竖直方向不越界; 与玩家听牌/提示按钮行(以 handY 为心、高 HINT_BTN_H)分开
        check(Math.abs(sideY) + SEAT_PLATE_H / 2 <= sc.halfH,
            `${sc.name}: 侧名牌在可见区内`, `y=${sideY.toFixed(0)} 半高=${sc.halfH.toFixed(0)}`);
        // 按钮行在底部(handY), 名牌在桌沿中线; 只要名牌下沿高过按钮上沿就不会撞
        const btnTop = handY + HINT_BTN_H / 2;
        const plateBottom = sideY - SEAT_PLATE_H / 2;
        check(plateBottom > btnTop,
            `${sc.name}: 侧名牌在按钮行之上`, `名牌下沿 ${plateBottom.toFixed(0)} > 按钮上沿 ${btnTop.toFixed(0)}`);
        // 侧名牌与玩家手牌(±441)横向错开: 名牌在 ±(840−70) 那一列, 必然在牌区之外
        check(sideX - plateW / 2 > (14 * TILE_W) / 2,
            `${sc.name}: 侧名牌在玩家手牌(±${(14 * TILE_W) / 2})之外`,
            `名牌内缘 ${(sideX - plateW / 2).toFixed(0)}`);
    }

    // ---- 源码级: 口径与接线 ----
    const code = strip(mainSrc);
    check(/getStreak\(seat: number\): number/.test(strip(gmSrc)), 'GameManager 提供 getStreak(seat)');
    const plateBody = code.slice(code.indexOf('private _refreshSeatPlates('),
        code.indexOf('private _refreshSeatPlates(') + 2600);
    check(plateBody.includes('getStreak'), '名牌的连庄次数取自 GameManager(不另存一份)');
    check(/streak\s*>=\s*2/.test(plateBody), '角标只在连庄(连续胡牌 ≥ 2)时出现');
    check(/seatLabel\(s\)/.test(plateBody), '名字用 seatLabel(与结算/比分条同一套)');
    // 三家 AI 才有名牌: 玩家不需要"我是谁"的提示
    const buildBody = code.slice(code.indexOf('private _buildSeatPlates('),
        code.indexOf('private _buildSeatPlates(') + 700);
    check(/for\s*\(let s = 1; s <= 3; s\+\+\)/.test(buildBody), '只为三家 AI 建名牌(自家不建)');
    // 原生平台: 隐藏过再显示 Graphics 会丢 → 开局/首帧后必须强制重建
    const drawStatic2 = code.slice(code.indexOf('private _drawStaticGraphics'),
        code.indexOf('private _drawStaticGraphics') + 1000);
    check(drawStatic2.includes('_refreshSeatPlates(true)'), '首帧后补画名牌');
    const startDealing = code.slice(code.indexOf('private _startDealing('),
        code.indexOf('private _startDealing(') + 1400);
    check(startDealing.includes('_refreshSeatPlates(true)'), '开局强制重建名牌(隐藏过再显示)');
    const clearTable2 = code.slice(code.indexOf('private _clearTable()'),
        code.indexOf('private _clearTable()') + 3000);
    check(/_seatPlateSig\s*=\s*''/.test(clearTable2), '_clearTable 清名牌指纹(跨局不残留)');
    const applyLayout2 = bodyOf(code, 'private _applyLayout(');
    check(applyLayout2.includes('_placeSeatPlates') && applyLayout2.includes('_topHandY'),
        '_applyLayout 重摆名牌(转屏跟着走)');
    check(!/createLabelNode\([^)]*'你'/.test(code), '没有"你"的名牌(自己不需要身份提示)');

    // ---- 听牌状态并进名牌(2026-10-17 用户要求: 名字后面加标签, 不再单独标一遍名字) ----
    check(plateBody.includes('isTenpaiDeclared'), '名牌内容包含听牌状态(取自 GameManager)');
    check(plateBody.includes('·听'), '报听后名牌显示"·听"标签');
    check(/isTenpaiDeclared[\s\S]{0,300}_seatPlateSig/.test(plateBody),
        '名牌指纹里带上听牌状态(否则报了听不会重建)');
    const markerBuild = code.slice(code.indexOf('private _buildTenpaiMarkers('),
        code.indexOf('private _buildTenpaiMarkers(') + 600);
    check(/createTenpaiChip\(seatLabel\(0\)\)/.test(markerBuild),
        '只给玩家自己建"听"标记(三家的已并进名牌)');
    check(!/for\s*\(let seat = 0; seat < 4; seat\+\+\)[\s\S]{0,200}createTenpaiChip/.test(code),
        '不再四角循环挂"xx·听"小牌');
}

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
process.exit(fails === 0 ? 0 : 1);
