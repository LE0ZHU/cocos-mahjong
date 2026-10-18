/**
 * 胡牌特效(HuEffect)的节奏与接线自检
 *
 * 【背景】2026-10-18 之前, 牌局结束是"同一帧四件事": 顶部小字 → 三家手牌整体翻面 →
 * 结算卡片直接 active=true —— 玩家的感受是"啪一下卡片糊在脸上"。
 * 现在拆成 2.2s 三拍(定格 → 爆发 → 揭晓), 本测试锁住:
 *  A 节奏: 大字 < 摘要 < 交棒(2.2s); AI 胡"收着演"(1.35s / 0.72 倍 / 更暗)
 *  B 四种大字齐全(自摸/吃胡/一炮多响/流局) + 流局不闪光
 *  C 不跳过: 压暗层必须吞掉触摸(产品决定不加"点屏跳过")
 *  D 不引用牌桌节点: 锚点走 hooks(toWorld/toLocal 换算), 重建打不断特效
 *  E Main 接线: onSettle 先播特效再交棒面板; _clearTable 必须 abort(否则留半黑屏);
 *    onHu 不再接顶部小字
 *  F SettlementPanel 入场: 卡片上滑 + 遮罩淡入(压暗归它), hide() 复位(否则下局从半透明开始)
 *  G WinnerResult.fromSeat: 点炮者座位由 GameManager 直接带出(不能从 delta 反推)
 */
declare const require: (m: string) => any;
declare const __dirname: string;
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

function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

/** 取某个方法的源码(从 `name(` 起到下一个同级 `private ` / 文件尾) */
function methodBody(src: string, name: string): string {
    const i = src.indexOf(name);
    if (i < 0) return '';
    const rest = src.slice(i);
    const m = rest.match(/\n    (private |public |get )/);
    return m && m.index ? rest.slice(0, m.index) : rest;
}

function num(src: string, name: string): number {
    const m = new RegExp('const ' + name + ' = ([\\d.]+);').exec(src);
    if (!m) throw new Error('找不到常量 ' + name);
    return parseFloat(m[1]);
}

let fails = 0;
function check(ok: boolean, msg: string, detail = ''): void {
    if (ok) console.log(`  ✓ ${msg}${detail ? '  (' + detail + ')' : ''}`);
    else { fails++; console.log(`  ✗ ${msg}${detail ? '  (' + detail + ')' : ''}`); }
}

const fx = stripComments(fs.readFileSync(findFile('assets/scripts/ui/HuEffect.ts'), 'utf8'));
const main = stripComments(fs.readFileSync(findFile('assets/scripts/Main.ts'), 'utf8'));
const score = stripComments(fs.readFileSync(findFile('assets/scripts/core/HuScore.ts'), 'utf8'));
const gm = stripComments(fs.readFileSync(findFile('assets/scripts/managers/GameManager.ts'), 'utf8'));
const settle = stripComments(fs.readFileSync(findFile('assets/scripts/ui/SettlementPanel.ts'), 'utf8'));

console.log('\n[A] 节奏: 只剩"和牌归位"一拍(压暗/大字/摘要三拍 + 闪光已删除)');
{
    const tTile = num(fx, 'T_TILE');
    const tDone = num(fx, 'T_DONE');
    const tLand = num(fx, 'T_LAND');
    const ringLife = num(fx, 'RING_LIFE');
    const reveal = num(main, 'HU_FX_REVEAL_TAIL');
    // 归位这一段本身仍然要**整段播完**才交棒: 金环不能被面板盖掉
    const ringEnd = tLand + ringLife;
    check(ringEnd <= tDone + 1e-6,
        `金环 ${tLand}~${ringEnd.toFixed(2)} 在交棒 ${tDone} 前收束`);
    check(tDone > ringEnd + 1e-6, `金环收束 → 交棒之间留一眼 ${(tDone - ringEnd).toFixed(2)}s`);
    check(Math.abs(tDone - (tLand + ringLife + num(fx, 'T_BEAT'))) < 1e-6,
        `交棒 = 落位 ${tLand} + 金环 ${ringLife} + 留一眼 ${num(fx, 'T_BEAT')}`);
    // ---- 端到端: 面板在点胡起 ≈3.3s 就位(删三拍前 5.65s, 再删闪光前 3.5s) ----
    check(Math.abs(tDone - 1.8) < 1e-6, `特效时长 ${tDone}s(翻面缓冲 ${reveal}s 之前先单独播)`);
    check(Math.abs(reveal + tDone + 0.5 - 3.45) < 1e-6,
        `点胡 → 面板就位 ${(reveal + tDone + 0.5).toFixed(2)}s`);
    check(Math.abs(reveal + tDone - 2.95) < 1e-6,
        `交棒在点胡起 ${(reveal + tDone).toFixed(2)}s`);
    check(Math.abs(tLand - (num(fx, 'T_HL') + num(fx, 'T_FLY_DUR'))) < 1e-6,
        `落位 ${tLand} = 起点高亮 ${num(fx, 'T_HL')} + 飞行 ${num(fx, 'T_FLY_DUR')}`);
    // ---- 支线: 收着演只剩"金环更暗更细"; 流局没有任何东西可播, 立刻交棒 ----
    check(Math.abs(num(fx, 'DRAW_T_DONE') - 0.15) < 1e-6,
        `流局 ${num(fx, 'DRAW_T_DONE')}s 就交棒(没有关键牌, 陪着等是纯枯等)`);
    check(num(fx, 'DRAW_T_DONE') < tDone, '流局不比胡牌还慢');
    const subdued = fx.includes("!data.winners.some(w => w.seat === 0)");
    check(subdued, '收着演的判定 = 玩家不在赢家之列');
    check(tTile === tLand, '自摸金环与吃胡落位同一时刻(对称)');
}

console.log('\n[A2] 闪光已删除(用户反馈"黄色的一块闪一下很突兀")');
{
    check(!/flashBurst|FLASH_|MeldFlash/.test(fx),
        'HuEffect 里没有 flashBurst 调用, 也没有 FLASH_* 常量');
    check(/const RING_LIFE = 0\.45;/.test(fx),
        '金环寿命放宽到 0.45s(删掉闪光后它是唯一的强调手段)');
    check(/g\.lineWidth = subdued \? 4 : 6;/.test(fx) && /g\.stroke\(\);/.test(fx),
        '金环是**描边**不填色(实心块会糊住牌面, 这正是突兀感的来源)');
    // 副露(吃/碰/杠)的闪光留在 Main 里 —— 那里是"这里刚吃/碰/杠了"的落点强调, 用户没提
    check(/flashBurst\(container, group\.position\.x/.test(main),
        'Main 里副露的那处 flashBurst 保留(用户只嫌胡牌落位突兀)');
}

console.log('\n[H] 和牌归位: 点炮那张牌先留在弃牌河, 高亮后飞进赢家手牌');
{
    // ---- 规则层: 结算那一帧照旧把牌收进手牌(番型要靠它算), 但留一个"待归位"标记给 UI ----
    check(/ronFlight: RonFlight \| null = null;/.test(gm), 'GameManager 有 ronFlight 待归位标记');
    check(/this\.ronFlight = \{ tile, payerSeat, winnerSeats: \[...winnerSeats\], robKan \};/.test(gm),
        '_settleRon 记下待归位(和牌 / 点炮者 / 赢家 / 是否抢杠)');
    check(/consumeRonFlight\(\): void \{\s*\n\s*this\.ronFlight = null;/.test(gm),
        'consumeRonFlight(): 归位动画播完后收掉标记');
    const startBody = gm.slice(gm.indexOf('startGame('), gm.indexOf('startGame(') + 2500);
    check(/this\.ronFlight = null;/.test(startBody),
        'startGame 清掉上一局的待归位标记(特效可能被中途 abort)');

    // ---- UI: 牌河补回那张牌, 赢家手牌给它留一个空槽 ----
    check(/private _riverTilesFor\(seat: number, base: Tile\[\]\)/.test(main)
        && /return base\.concat\(\[p\.tile\]\);/.test(main),
        '牌河渲染把点炮那张补回河里(它还没飞走)');
    check(/if \(p && !p\.robKan && p\.payerSeat === seat\)/.test(main),
        '抢杠的牌在被抢者手里 —— 不补回牌河');
    check(/private _pendingRonTile\(seat: number\)/.test(main) && /_markPendingWin\(node\)/.test(main),
        '赢家手牌给待归位牌留空槽(节点隐形, 槽位照算)');
    check(/if \(tile === hideTile\) this\._markPendingWin\(node\);/.test(main),
        '自家手牌里那张先隐形');
    check(/if \(tile === hideTile\) this\._markPendingWin\(node\);\s*\n\s*else if \(reveal\) this\._popRevealed/.test(main),
        '三家手牌里那张先隐形(且不走翻面弹入)');
    check(/this\._pendingRiverNode = container\.children\[container\.children\.length - 1\] \?\? null;/.test(main),
        '记下河里补回的那张(落位后销毁)');
    check(/private _dropOrHoldRiver\(/.test(main)
        && /if \(tiles === base\) \{\s*\n\s*this\._animateRiverDrop/.test(main),
        '补回渲染时不再飞一次、不再播一次出牌语音(它本来就在河里)');
    check(/node\.setScale\(0, 0, 1\);/.test(main),
        '隐形牌缩到 0(光 opacity=0 仍会接收触摸)');

    // ---- 落位: 手牌空槽填上 + 河里那张收走 ----
    check(/onLanded: \(\) => this\._onRonTileLanded\(\),/.test(main), 'Main 接上落位回调');
    check(/gm\.consumeRonFlight\(\);/.test(main), '落位时收掉待归位标记(后续按真实状态渲染)');
    check(/if \(river && river\.isValid\) river\.destroy\(\);/.test(main), '落位时销毁河里那张');
    check(/this\._pendingWinNodes = \[\];\s*\n\s*this\._pendingRiverNode = null;/.test(main),
        '_clearTable 一并清掉(特效被中止时不留虚位)');

    // ---- 特效: 起点高亮 → 飞行 → 落位回调 ----
    check(/const T_HL = 0\.3;/.test(fx), '起点高亮 0.3s(金框先亮一下再飞)');
    check(/\.delay\(T_HL\)/.test(fx), '飞牌排在起点高亮之后');
    check(/to\(0\.12, \{ opacity: 235 \}\)/.test(fx), '起点金框先淡入到 235(高亮)再作残影淡出');
    check(/onLanded\?: \(winner: WinnerResult\) => void;/.test(fx), 'HuFxHooks 有 onLanded');
    check(/this\._hooks\?\.onLanded\?\.\(winner\);/.test(fx), '落位那一帧回调 UI(填手牌槽 / 收河牌)');
    // 落位目标 = 赢家手牌里那个**真实槽位**(隐形但槽位照记), 不是估算出来的位置
    check(/const local = this\._handSlots\.get\(seat\)\?\.get\(tile\.id\);/.test(main),
        '落位坐标取 _handSlots 里的真实手牌槽位(空槽也照记), 不是估出来的位置');
}

console.log('\n[B] 三拍已删除: 没有压暗 / 大字 / 摘要 / 震动');
{
    check(!/'自摸'|'吃胡'|'一炮多响'|'流局'/.test(fx), '源码里不再有任何大字文案(删干净)');
    check(!/_stamp|_stampMain|_stampSub|_summary|_summaryLabel|StampInfo/.test(fx),
        '大字/摘要的节点与绘制方法都已删除');
    check(!/DIM_FULL|DIM_SUB|DIM_DRAW|T_DIM|T_DIM_IN|ensureOpacity\(this\._dim/.test(fx),
        '全桌压暗(黑幕层与其 tween)已删除');
    check(!/vibrateHu/.test(fx) && !/vibrateHu/.test(main),
        '胡牌震动随大字一拍删除(Main 里也不再 import)');
    check(!/STAMP_|SUMMARY_|textWidth/.test(fx), '大字/摘要的排版常量与量宽函数一并删除');
    // 流局没有关键牌: 整个金环/飞行段都被 data.kind === 'hu' 挡住
    check(/if \(data\.kind === 'hu'\) \{\s*\n\s*for \(const w of data\.winners\)/.test(fx),
        '流局不做关键牌强调(金环/飞行整段被 kind 判断挡住)');
}

console.log('\n[C] 不跳过 + 吞点击(背景层只吞事件, 不再画任何东西)');
{
    check(/TOUCH_START/.test(fx), '背景层注册了触摸监听(吞掉点击, 防误点牌桌)');
    check(!/skip|跳过/i.test(fx), '没有跳过逻辑(产品决定不加)');
    check(/blk\.addComponent\(UITransform\)/.test(fx) && !/blk\.addComponent\(Graphics\)/.test(fx),
        '背景层只有 UITransform 不再挂 Graphics(压暗删了, 它只负责吞点击)');
}

console.log('\n[D] 不引用牌桌节点 + 和牌归位飞行');
{
    check(/anchorOf\(seat: number, tile: Tile \| null\)/.test(fx), '锚点由 hooks 注入(容器 + 局部坐标)');
    check(/originOf\(winner: WinnerResult\)/.test(fx), '来路锚点也由 hooks 注入(吃胡/抢杠才发问)');
    check(/toLocal\(this\.node, toWorld\(/.test(fx), '坐标经 toWorld/toLocal 换算, 不直接摸牌节点');
    check(!/_handContainer|_aiHandContainers|_handSlots|_rebuildTiles/.test(fx),
        '特效源码里没有牌桌内部结构(重建打不断它)');
    check(/_ensureNodes\(\)/.test(fx) && /this\.node\.active = true;\s*\n\s*this\._ensureNodes/.test(fx),
        '节点在 play()(已 active)时才创建/补画 —— 原生平台隐藏期 Graphics 上不了屏');
    // 真机 bug(2026-10-18): 根节点没有 UITransform 时 toLocal 静默退回世界坐标,
    // 副本/金环全画到屏幕外 —— 表现是"看不到飞行过程, 牌突然出现"
    check(/getComponent\(UITransform\)\) \?\?\s*\n?\s*this\.node\.addComponent\(UITransform\)/.test(fx)
        || /if \(!this\.node\.getComponent\(UITransform\)\)/.test(fx),
        '根节点补挂 UITransform(toLocal 才是本节点坐标, 不是世界坐标)');
    check(/updateWorldTransform\(\)/.test(fx), '换算前刷新世界变换(刚激活的节点矩阵可能是脏的)');

    // 第 0 拍: 和牌副本飞回落位(2026-10-18 二次迭代: 宣告那一帧不再"凭空消失/凭空出现")
    check(Math.abs(num(fx, 'T_FLY_DUR') - 0.7) < 1e-6, `飞行时长 ${num(fx, 'T_FLY_DUR')}s`);
    check(Math.abs(num(fx, 'T_LAND') - num(fx, 'T_FLY_DUR') - num(fx, 'T_HL')) < 1e-6,
        '落位 = 起点高亮 + 飞行(高亮那一拍先让来路被看见, 不是 play 就起飞)');
    // 交棒等**金环**收束 + 留一眼才开始(闪光已删, 金环就是唯一的归位强调)
    check(num(fx, 'T_DONE') >= num(fx, 'T_LAND') + num(fx, 'RING_LIFE') - 1e-6,
        `交棒等金环收束(${num(fx, 'T_DONE')} ≥ 落位 ${num(fx, 'T_LAND')} + 金环 ${num(fx, 'RING_LIFE')})`);
    check(Math.abs(num(fx, 'RING_LIFE') - 0.45) < 1e-6,
        '金环寿命 0.45s(闪光删掉后放宽: 它现在是唯一的强调手段)');
    check(Math.abs(num(fx, 'T_TILE') - num(fx, 'T_LAND')) < 1e-6,
        '自摸金环与吃胡落位同一时刻(对称)');
    // 副本自带金边框 + 起点残影: 无论牌面素材是否加载, "带金边的牌飞过去"都看得清
    const fly = fx.slice(fx.indexOf('private _flyCopy'));
    check(/FlyBorder/.test(fly) && /roundRect\(-bw \/ 2, -bh \/ 2, bw, bh, 14\)/.test(fly),
        '飞行副本自带金边框(用户认领这段动画的视觉锚点)');
    check(/setScale\(1\.25, 1\.25, 1\)/.test(fly), '起点比落位大 1.25 倍(更显眼)');
    check(/FlyGhost/.test(fly) && /to\(0\.12, \{ opacity: 235 \}\)/.test(fly),
        '起点先高亮金框(0.12s 淡入到 235), 起飞后才作残影淡出');
    check(/createTileNode\(w, h, false\)/.test(fly) && /addComponent\(TileView\)/.test(fly) && /setData\(tile, -1\)/.test(fly),
        '副本是真牌面(同一套工厂 + TileView), 不是色块');
    check(/origin\.angle \?\? origin\.container\.angle/.test(fly) && /dest\.angle \?\? dest\.container\.angle/.test(fly),
        '副本沿容器旋转角起飞/落位(左右家的牌是竖躺的)');
    check(/copy\.destroy\(\)/.test(fly), '落位即销毁副本(真牌已在手里)');
    check(!/_flyDot/.test(fx), '旧的光点飞行已移除(被真牌副本取代)');
    check(/!w\.isSelfDraw && w\.fromSeat >= 0/.test(fx), '自摸不飞(牌本来就在手里, 只金环)');
}

console.log('\n[E] Main 接线');
{
    const onSettle = methodBody(main, 'private _onSettle');
    check(/_huFx\.play\(/.test(onSettle) && /_settlement\?\.show\(data\)/.test(onSettle),
        'onSettle 先播特效, 播完再交棒结算面板');
    check(/this\._settlement\?\.show\(data\);\s*\n\s*\}\s*\n\s*\}, HU_FX_REVEAL_TAIL\);/.test(onSettle),
        '特效层缺失时有退路(直接弹面板, 不走延时)');
    check(/_huFx\?\.abort\(\)/.test(main), '_clearTable 里 abort 特效(重开/返回主页面不留半黑屏)');
    check(!/_showHuToast/.test(main), 'onHu 顶部小字已移除(结论由结算面板交代)');
    check(/anchorOf: \(seat, tile\) => this\._huFxAnchorOf/.test(main), '锚点回调接的是 Main 的 _huFxAnchorOf');
    check(/originOf: \(winner\) => this\._huFxOriginOf/.test(main), '来路回调接的是 Main 的 _huFxOriginOf');
    const anchorFn = methodBody(main, 'private _huFxAnchorOf');
    check(/_handSlots\.get\(seat\)\?\.get\(tile\.id\)/.test(anchorFn), '关键牌锚点用 _handSlots(翻牌重建后仍是新值)');
    check(/_aiDiscardContainers\[seat - 1\]/.test(anchorFn), '无牌时退回该家弃牌河中心(光点起点)');
    check(/angle: container\.angle/.test(anchorFn), '锚点带容器旋转角(副本沿它转正)');
    const originFn = methodBody(main, 'private _huFxOriginOf');
    check(/discards\.length/.test(originFn), '吃胡起点 = 被取走的那格(pop 后下标 = discards.length)');
    check(/startX = -cols \* stepX \/ 2 \+ stepX \/ 2/.test(originFn),
        '槽位公式与 _renderRiver 横排分支一致(不另写一套)');
    check(/_meldContainers\[payer\]/.test(originFn) && /抢杠胡/.test(originFn),
        '抢杠起点 = 补杠者的副露区(牌是从手里抢的, 不在牌河)');
    check(/payer >= 2 \? this\.SIDE_RIVER_COLS : this\.RIVER_COLS/.test(originFn),
        '列数按座位区分(左右家每排张数不同)');
    check(/_popRevealed\(node, i\)/.test(main) && /index \* 0\.06/.test(main),
        '三家亮牌按 0.06s/张 错峰弹入(不再同帧全翻)');
    const onSettleBody = methodBody(main, 'private _onSettle');
    check(/scheduleOnce/.test(onSettleBody) && /HU_FX_REVEAL_TAIL/.test(onSettleBody),
        'onSettle 延到翻面播完才进特效(串行, 不并行抢视线)');
    check(Math.abs(num(main, 'HU_FX_REVEAL_TAIL') - 1.15) < 1e-6,
        `翻面缓冲 ${num(main, 'HU_FX_REVEAL_TAIL')}s(14 张 × 0.06 + 0.26 弹入 + 余量)`);
    check(/_huFx\?\.fit\(halfH\)/.test(main), '转屏时 HuEffect.fit 跟结算面板一起重排');
    // 层级: huFx 在设置弹窗之后、结算面板之前
    const si = main.indexOf('push(this._settingsPanel?.node)');
    const hi = main.indexOf('push(this._huFx?.node)');
    const li = main.indexOf('push(this._settlement?.node)');
    check(si >= 0 && si < hi && hi < li, '层级: 设置弹窗 < HuEffect < 结算面板');
}

console.log('\n[F] 结算面板入场');
{
    const showBody = methodBody(settle, 'show(data: SettlementData)');
    const hideBody = methodBody(settle, 'hide(): void');
    check(/backOut/.test(showBody) && /- 70/.test(showBody), '卡片从下方 70 上滑(backOut 0.5s)');
    check(/maskOp\.opacity = 0/.test(showBody), '遮罩淡入(压暗现在由面板自己的遮罩负责: 特效已无压暗层)');
    check(/ensureOpacity\(this\._card\)\.opacity = 255/.test(hideBody) && /setPosition\(this\._card\.position\.x, 0, 0\)/.test(hideBody),
        'hide() 复位透明度与位移(下一局不从半透明/偏移开始)');
}

console.log('\n[G] WinnerResult.fromSeat');
{
    check(/fromSeat: number/.test(score), 'WinnerResult 带 fromSeat(点炮者座位, 自摸 -1)');
    check(/fromSeat: e\.isSelfDraw \? -1 : payerSeat/.test(gm), 'GameManager 直接带出, 不靠 delta 反推');
}

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
