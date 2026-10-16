/**
 * 设置弹窗版式与行为校验 —— 从真实源码提取常量, 跑数字
 *
 * 复核四组:
 *  1. 卡片在**各屏幕比例**下都完整可见(21:9 手机横屏可见高度最小, 是最坏情况)
 *  2. 卡片内部各段 **纵向间距 > 0**(游标写法正确, 不会重叠; 且不超出上下内边距)
 *  3. 每个 Label 的 **文本域够宽**、每个按钮行 **不超出卡片内容宽**
 *  4. 行为约束: 打开弹窗冻结倒计时、牌桌输入被拦截、重开/返回会先收弹窗
 *
 * 【为什么要跑数字而不是"看代码觉得没问题"】纵向游标写错一个符号就会让下一段
 * 正好压在上一段上(ACENTS.md 硬约束 3, 结算面板连续犯过两次), 光看代码算不出重叠;
 * 而"卡片比屏幕高"这类问题只在特定屏幕比例下暴露, 电脑上预览 16:9 永远看不见。
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

const panelSrc = fs.readFileSync(findFile('assets/scripts/ui/SettingsPanel.ts'), 'utf8');
const mainSrc = fs.readFileSync(findFile('assets/scripts/Main.ts'), 'utf8');
const gmSrc = fs.readFileSync(findFile('assets/scripts/managers/GameManager.ts'), 'utf8');

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

/** CJK 按字号, 其余半角 —— 与 HintPanel.textWidth 一致 */
function textWidth(text: string, font: number): number {
    let w = 0;
    for (const ch of text) w += ch.codePointAt(0)! >= 0x2e80 ? font : font * 0.5;
    return w;
}

// ---- 提取真实常量 ----
const CARD_W = num(panelSrc, 'CARD_W');
const PAD_X = num(panelSrc, 'PAD_X');
const PAD_Y = num(panelSrc, 'PAD_Y');
const H_TITLE = num(panelSrc, 'H_TITLE');
const GAP_TITLE = num(panelSrc, 'GAP_TITLE');
const H_GROUP = num(panelSrc, 'H_GROUP');
const GAP_GROUP = num(panelSrc, 'GAP_GROUP');
const H_CAPTION = num(panelSrc, 'H_CAPTION');
const GAP_CAPTION = num(panelSrc, 'GAP_CAPTION');
const H_ROW = num(panelSrc, 'H_ROW');
const GAP_ROW = num(panelSrc, 'GAP_ROW');
const H_DIVIDER = num(panelSrc, 'H_DIVIDER');
const GAP_DIVIDER = num(panelSrc, 'GAP_DIVIDER');
const H_BTN = num(panelSrc, 'H_BTN');
const OPT_GAP = num(panelSrc, 'OPT_GAP');
const BTN_GAP = num(panelSrc, 'BTN_GAP');
const MIN_SCALE = num(panelSrc, 'MIN_SCALE');
const CONTENT_W = num(mainSrc, 'CONTENT_W');

/** 字号(与 _rebuild 里传入的一致, 改了源码这里要跟着改) */
const FONT_TITLE = 44;
const FONT_GROUP = 26;
const FONT_CAPTION = 28;
const FONT_OPTION = 28;

/** 选项组数量(音效音量 / 背景音乐 / 音乐音量) */
const GROUPS = 3;

/** 复刻 SettingsPanel._contentH */
function contentH(): number {
    return PAD_Y * 2
        + H_TITLE + GAP_TITLE
        + H_GROUP + GAP_GROUP
        + GROUPS * (H_CAPTION + GAP_CAPTION + H_ROW)
        + (GROUPS - 1) * GAP_ROW
        + GAP_DIVIDER + H_DIVIDER + GAP_DIVIDER
        + H_BTN;
}

/** 复刻 SettingsPanel._computeScale */
function computeScale(halfH: number): number {
    const h = contentH();
    const availH = halfH > 0 ? halfH * 2 - 24 : 0;
    if (availH <= 0 || h <= availH) return 1;
    return Math.max(MIN_SCALE, Math.min(1, availH / h));
}

console.log('\n=== 设置弹窗版式校验 ===\n');

// ---------------------------------------------------------------- 1
console.log('[1] 卡片在各屏幕比例下完整可见');
// 可见半高 = 840 / 宽高比(见 AGENTS.md 硬约束 2)
const SCREENS: { name: string; halfH: number }[] = [
    { name: '16:9  (1920×1080)', halfH: 840 / (1920 / 1080) },
    { name: '19.5:9 (2340×1080)', halfH: 840 / (2340 / 1080) },
    { name: '21:9  (2520×1080)', halfH: 840 / (2520 / 1080) },
    { name: '竖屏 9:16', halfH: 840 / (1080 / 1920) },
];
const h0 = contentH();
console.log(`  未缩放卡片高 ${h0}px, 内容宽 ${CARD_W - PAD_X * 2}px`);
for (const s of SCREENS) {
    const availH = s.halfH * 2 - 24;
    const scale = computeScale(s.halfH);
    const shownH = h0 * scale;
    check(shownH <= availH + 0.5, `${s.name}: 高度 ${shownH.toFixed(0)} ≤ 可用 ${availH.toFixed(0)}`, `scale=${scale.toFixed(3)}`);
    check(scale >= MIN_SCALE - 1e-6, `${s.name}: 缩放不低于下限 ${MIN_SCALE}`, `实际 ${scale.toFixed(3)}`);
    // 卡片横向也不能溢出内容坐标系(±CONTENT_W/2)
    check(CARD_W * scale <= CONTENT_W, `${s.name}: 宽度 ${(CARD_W * scale).toFixed(0)} ≤ ${CONTENT_W}`);
}

// ---------------------------------------------------------------- 2
console.log('\n[2] 卡片内部段落不重叠(游标复刻)');
/** 复刻 _rebuild 的纵向游标, 返回每段的 [上沿, 下沿] */
function layout(): { name: string; top: number; bottom: number }[] {
    const h = contentH();
    const segs: { name: string; top: number; bottom: number }[] = [];
    let y = h / 2 - PAD_Y;

    const push = (name: string, hh: number, gapAfter: number): void => {
        segs.push({ name, top: y, bottom: y - hh });
        y -= hh + gapAfter;
    };
    push('标题', H_TITLE, GAP_TITLE);
    push('分组标题', H_GROUP, GAP_GROUP);
    for (let i = 0; i < GROUPS; i++) {
        push(`项${i + 1}标题`, H_CAPTION, GAP_CAPTION);
        push(`项${i + 1}选项行`, H_ROW, i < GROUPS - 1 ? GAP_ROW : 0);
    }
    y -= GAP_DIVIDER;
    push('分隔线', H_DIVIDER, GAP_DIVIDER);
    push('操作按钮行', H_BTN, 0);
    return segs;
}
const segs = layout();
for (let i = 0; i < segs.length - 1; i++) {
    const gap = segs[i].bottom - segs[i + 1].top;
    check(gap > 0, `"${segs[i].name}" → "${segs[i + 1].name}" 间距 ${gap} > 0`);
}
const last = segs[segs.length - 1];
const first = segs[0];
check(first.top <= h0 / 2 - PAD_Y + 0.01, `首段上沿不超出上内边距(顶 ${first.top.toFixed(1)} ≤ ${(h0 / 2 - PAD_Y).toFixed(1)})`);
check(last.bottom >= -h0 / 2 + PAD_Y - 0.01, `末段下沿不超出下内边距(底 ${last.bottom.toFixed(1)} ≥ ${(-h0 / 2 + PAD_Y).toFixed(1)})`);
// 最要紧的一条: 两个操作按钮必须留在卡片里 —— 它们是玩家唯一的出口
check(last.top >= -h0 / 2, `操作按钮行整体在卡片内(下沿 ${last.bottom.toFixed(1)} > ${(-h0 / 2).toFixed(1)})`);

// ---------------------------------------------------------------- 3
console.log('\n[3] 文本域与按钮宽度');
const contentW = CARD_W - PAD_X * 2;
const capW = contentW - 12;

/** 各 Label 的最坏文案(取实际会出现的字符串) */
const LABELS: { text: string; font: number; box: number }[] = [
    { text: '设置', font: FONT_TITLE, box: contentW + 8 },
    { text: '声音', font: FONT_GROUP, box: contentW + 8 },
    { text: '音效音量', font: FONT_CAPTION, box: capW + 8 },
    { text: '背景音乐', font: FONT_CAPTION, box: capW + 8 },
    { text: '音乐音量', font: FONT_CAPTION, box: capW + 8 },
];
for (const l of LABELS) {
    const need = textWidth(l.text, l.font);
    check(need <= l.box, `Label "${l.text}" 需要 ${need} ≤ 文本域 ${l.box}`);
}

// 选项按钮: 4 档音量最宽, 按钮内要放得下"静音"(2 字)
const optW = (contentW - (4 - 1) * OPT_GAP) / 4;
const optNeed = textWidth('静音', FONT_OPTION) + 16;   // 16 为左右内边距
check(optNeed <= optW, `音量档按钮: "静音"需要 ${optNeed} ≤ 按钮宽 ${optW.toFixed(1)}`);
const optTotal = 4 * optW + 3 * OPT_GAP;
check(optTotal <= contentW + 0.01, `4 档按钮总宽 ${optTotal.toFixed(1)} ≤ 内容宽 ${contentW}`);

// 开/关按钮
const onOffW = (contentW - 1 * OPT_GAP) / 2;
check(textWidth('关', FONT_OPTION) + 16 <= onOffW, `开/关按钮宽 ${onOffW.toFixed(1)} 足够`);

// 两个操作按钮
const actW = Math.min(250, (contentW - BTN_GAP) / 2);
const actTotal = actW * 2 + BTN_GAP;
check(actTotal <= contentW + 0.01, `操作按钮总宽 ${actTotal.toFixed(1)} ≤ 内容宽 ${contentW}`);
check(textWidth('返回主页面', FONT_OPTION) + 16 <= actW, `"返回主页面"需要 ${textWidth('返回主页面', FONT_OPTION)} ≤ ${actW.toFixed(1)}`);

// 设置按钮(左上角齿轮)的定位式 —— 从源码提取, 不手抄
// 位置 = -CONTENT_W/2 + 左缘留白 + 半个按钮宽(锚点是中心)
const btnRe = /_settingsBtnX\s*=\s*-this\.CONTENT_W\s*\/\s*2\s*\+\s*(\d+)\s*\+\s*(\d+)/.exec(mainSrc);
const btnSize = /createIconButton\(\s*'icons\/settings'\s*,\s*(\d+)\s*,\s*(\d+)/.exec(mainSrc);
check(!!btnRe, '能从源码提取设置按钮的横向定位式');
check(!!btnSize, '能从源码提取设置按钮的尺寸');
if (btnRe && btnSize) {
    const pad = Number(btnRe[1]);            // 左缘留白
    const w = Number(btnSize[1]);
    const h = Number(btnSize[2]);
    check(pad > 0, `左缘留白 ${pad} > 0(不贴屏幕边)`);
    // 定位式第二项是"半个按钮宽"(节点锚点在中心), 换了按钮尺寸必须同步
    check(Number(btnRe[2]) === w / 2, '定位式里的半宽项与实际按钮尺寸一致', `实际半宽 ${w / 2}`);
    const left = -CONTENT_W / 2 + pad;
    const right = left + w;
    check(left >= -CONTENT_W / 2, `按钮左缘 ${left} ≥ ${-CONTENT_W / 2}`);
    check(right <= CONTENT_W / 2, `按钮右缘 ${right} ≤ ${CONTENT_W / 2}(不越出内容坐标系)`);
    check(w === h, `按钮是正方形(图标容器)`, `${w}×${h}`);
    check(w >= 44, `按钮 ${w}px ≥ 44(手指可点下限)`);
}
const btnYRe = /_settingsBtnY\s*=\s*halfH\s*-\s*(\d+)\s*-\s*(\d+)/.exec(mainSrc);
check(!!btnYRe, '能从源码提取设置按钮的纵向定位式');
if (btnYRe) {
    // 上缘 = halfH - 上边距, 必须落在可见区内(halfH 是最小屏幕下也成立的可见半高)
    check(Number(btnYRe[1]) > 0, `上边距 ${btnYRe[1]} > 0(不贴可见区上沿)`);
}
// 窗口比例极端时(halfH 最小)按钮仍不应盖住上行牌组: 上家手牌上沿 = halfH - 8 - tileH
// 按钮只占左上角, 与居中排布的上家手牌横向不重叠, 这里只核对按钮自身在屏内
if (btnYRe && btnSize) {
    check(Number(btnYRe[2]) === Number(btnSize[2]) / 2, '纵向定位的半高项与实际按钮一致');
}

// ---------------------------------------------------------------- 4
console.log('\n[4] 行为约束(源码级)');
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const mainCode = strip(mainSrc);
const gmCode = strip(gmSrc);

// 弹窗必须提供三个出口, 否则玩家会被"关在里面"
for (const cb of ['onRestart', 'onBack', 'onClose']) {
    check(mainCode.includes(`panel.${cb} =`), `Main 给弹窗接了 ${cb}`);
}
// 打开时冻结倒计时 / 关闭时恢复
check(/pauseDecideTimer\s*\(\)/.test(mainCode), '打开设置时暂停决策倒计时(pauseDecideTimer)');
check(/resumeDecideTimer\s*\(\)/.test(mainCode), '关闭设置时恢复决策倒计时(resumeDecideTimer)');
// 牌桌输入必须被拦(遮罩之外的第二道保险)
const clickBody = strip(mainSrc.slice(mainSrc.indexOf('private _onTileClick'), mainSrc.indexOf('private _onTileDropDiscard')));
check(clickBody.includes('_settingsOpen()'), '_onTileClick 里拦了设置弹窗打开时的点击');
const dropBody = strip(mainSrc.slice(mainSrc.indexOf('private _onTileDropDiscard'), mainSrc.indexOf('private _onTileDropDiscard') + 900));
check(dropBody.includes('_settingsOpen()'), '_onTileDropDiscard 里拦了设置弹窗打开时的拖拽');
// 重开/返回必须先收弹窗
check(/onRestart\s*=\s*\(\)\s*=>\s*this\._closeSettings\(/.test(mainCode), '点"重新开始"先收弹窗再开局');
check(/onBack\s*=\s*\(\)\s*=>\s*this\._closeSettings\(/.test(mainCode), '点"返回主页面"先收弹窗再退出');

// GameManager: 暂停标志必须能被结束路径复位, 否则下一局倒计时"看着在走实际不动"
const clearTimer = gmCode.slice(gmCode.indexOf('private _clearDecisionTimer'), gmCode.indexOf('private _clearDecisionTimer') + 500);
check(clearTimer.includes('_decidePaused = false'), '_clearDecisionTimer 复位暂停标志(下一局不会卡住倒计时)');
const updateBody = gmCode.slice(gmCode.indexOf('update(dt: number)'), gmCode.indexOf('update(dt: number)') + 700);
check(/if\s*\(this\._decidePaused\)\s*return/.test(updateBody), 'update 里暂停时直接返回(不累加 dt)');
check(updateBody.indexOf('_decidePaused') < updateBody.indexOf('_decideElapsed += dt'), '暂停判断在累加计时之前');

// 上游/旧按钮必须彻底移除, 否则会有"看不见但还在响应"的僵尸按钮
check(!mainCode.includes('_restartBtn'), '旧"重新开始"按钮引用已清除');
check(!mainCode.includes('_returnBtn'), '旧"返回主页面"按钮引用已清除');
check(!mainCode.includes('_restartVisible'), '旧 _restartVisible 状态已清除');

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
process.exit(fails === 0 ? 0 : 1);
