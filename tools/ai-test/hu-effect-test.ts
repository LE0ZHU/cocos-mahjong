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
 *  F SettlementPanel 入场: 卡片上滑 + 遮罩淡入, hide() 复位(否则下局从半透明开始)
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

console.log('\n[A] 节奏: 方案二(完全串行 / 零重叠 —— 每拍连余韵都播完才进下一拍)');
{
    const tTile = num(fx, 'T_TILE');
    const tBanner = num(fx, 'T_BANNER');
    const tSummary = num(fx, 'T_SUMMARY');
    const tDone = num(fx, 'T_DONE');
    const bannerIn = num(fx, 'T_BANNER_IN');
    const tDim = num(fx, 'T_DIM');
    const tDimIn = num(fx, 'T_DIM_IN');
    const tLand = num(fx, 'T_LAND');
    const ringLife = num(fx, 'RING_LIFE');
    const flashDur = num(fx, 'FLASH_DUR');
    const reveal = num(main, 'HU_FX_REVEAL_TAIL');
    // 零重叠: 每一拍的起点 ≥ 上一拍的终点(允许首尾相接, 不允许跨进)
    check(tBanner >= tDim + tDimIn - 1e-6,
        `大字 ${tBanner} ≥ 压暗完成 ${tDim + tDimIn}(零重叠)`);
    check(tSummary >= tBanner + bannerIn - 1e-6,
        `摘要 ${tSummary} ≥ 大字完成 ${tBanner + bannerIn}(零重叠)`);
    check(tDone >= tSummary + 0.34 - 1e-6,
        `交棒 ${tDone} ≥ 摘要完成 ${tSummary + 0.34}(零重叠)`);
    // ---- 方案二新增: 金环与闪光都必须在压暗**开始之前**整段播完 ----
    check(tLand + ringLife <= tDim + 1e-6,
        `金环 ${tLand}~${(tLand + ringLife).toFixed(2)} 在压暗 ${tDim} 前收束`);
    check(/const FLASH_LIFE = FLASH_DUR \+ 0\.05;/.test(fx),
        '闪光寿命算上 flashBurst 内部的 0.05 淡入(不然少算一截)');
    const flashEnd = tLand + flashDur + 0.05;
    check(flashEnd <= tDim + 1e-6, `闪光 ${tLand}~${flashEnd.toFixed(2)} 在压暗 ${tDim} 前播完`);
    check(tDim > flashEnd + 1e-6, `闪光收束 → 压暗之间留一眼 ${(tDim - flashEnd).toFixed(2)}s`);
    check(ringLife < flashDur, `金环 ${ringLife}s 明显短于闪光 ${flashDur}s(落位后一闪即收)`);
    // ---- 端到端: 面板必须在点胡起 ≈5.65s 就位(方案二认了这个节奏) ----
    check(Math.abs(tDone - 4.0) < 1e-6, `特效时长 ${tDone}s(翻面缓冲 ${reveal}s 之前先单独播)`);
    check(Math.abs(reveal + tDone + 0.5 - 5.65) < 1e-6,
        `点胡 → 面板就位 ${(reveal + tDone + 0.5).toFixed(2)}s`);
    check(Math.abs(reveal + tBanner - 3.6) < 1e-6,
        `大字在点胡起 ${(reveal + tBanner).toFixed(2)}s(方案一 2.75, 顺延 0.85)`);
    check(Math.abs(reveal + tSummary - 4.6) < 1e-6,
        `摘要在点胡起 ${(reveal + tSummary).toFixed(2)}s(方案一 3.75, 顺延 0.85)`);
    check(Math.abs(reveal + tDone - 5.15) < 1e-6,
        `交棒在点胡起 ${(reveal + tDone).toFixed(2)}s(方案一 4.30, 顺延 0.85)`);
    // ---- 收着演 / 流局 两条支线 ----
    check(Math.abs(num(fx, 'SUB_T_BANNER') - 2.15) < 1e-6, `AI 胡大字 ${num(fx, 'SUB_T_BANNER')}s`);
    check(Math.abs(num(fx, 'SUB_T_SUMMARY') - 2.95) < 1e-6, `AI 胡摘要 ${num(fx, 'SUB_T_SUMMARY')}s`);
    check(Math.abs(num(fx, 'SUB_T_DONE') - 3.4) < 1e-6, `AI 胡收着演 ${num(fx, 'SUB_T_DONE')}s`);
    check(num(fx, 'SUB_T_BANNER') >= tDim + tDimIn - 1e-6, '收着演的大字也等压暗完成(零重叠)');
    check(num(fx, 'SUB_T_DONE') <= tDone + 1e-6, '收着演不比玩家胡还长');
    check(Math.abs(num(fx, 'SUB_T_TILE') - 0.7) < 1e-6, `自摸金环 ${num(fx, 'SUB_T_TILE')}s(与落位同时刻)`);
    // 流局没有飞行/闪光要等, 压暗早开; 但它自己的压暗必须早于自己的大字
    check(num(fx, 'DRAW_T_DIM') + tDimIn <= num(fx, 'DRAW_T_BANNER') + 1e-6,
        `流局压暗 ${num(fx, 'DRAW_T_DIM')}~${(num(fx, 'DRAW_T_DIM') + tDimIn).toFixed(2)} 早于大字 ${num(fx, 'DRAW_T_BANNER')}(零重叠)`);
    check(num(fx, 'DRAW_T_DIM') < tDim, '流局不等飞行/闪光(陪着拖就成纯枯等了)');
    check(Math.abs(num(fx, 'SUB_SCALE') - 0.72) < 1e-6, `AI 胡大字缩到 ${num(fx, 'SUB_SCALE')} 倍`);
    check(num(fx, 'DIM_SUB') < num(fx, 'DIM_FULL'), `AI 胡压暗更浅(${num(fx, 'DIM_SUB')} < ${num(fx, 'DIM_FULL')})`);
    const subdued = fx.includes("!data.winners.some(w => w.seat === 0)");
    check(subdued, '收着演的判定 = 玩家不在赢家之列');
    check(tTile === tLand, '自摸金环与吃胡落位同一时刻(对称)');
}

console.log('\n[B] 四种大字 + 流局降级');
{
    check(fx.includes("'自摸'") && fx.includes("'吃胡'"), '自摸 / 吃胡 两色大字(暖金 / 赤金)');
    check(fx.includes("'一炮多响'"), '一炮多响单独文案(赢家可能 2~3 家, 只播一次)');
    check(fx.includes("'流局'"), '流局灰色大字');
    // 流局没有关键牌: 整个金环/飞行段都被 data.kind === 'hu' 挡住
    check(/if \(data\.kind === 'hu'\) \{\s*\n\s*const tRingStill/.test(fx),
        '流局不做关键牌强调(金环/飞行整段被 kind 判断挡住)');
    check(/vibrateHu\(\)/.test(fx), '震动挂在大字弹出那一刻');
}

console.log('\n[C] 不跳过 + 吞点击');
{
    check(/TOUCH_START/.test(fx), '压暗层注册了触摸监听(吞掉点击, 防误点牌桌)');
    check(!/skip|跳过/i.test(fx), '没有跳过逻辑(产品决定不加)');
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
    // 副本/金环/闪光全画到屏幕外 —— 表现是"看不到过渡, 大字突然弹出"
    check(/getComponent\(UITransform\)\) \?\?\s*\n?\s*this\.node\.addComponent\(UITransform\)/.test(fx)
        || /if \(!this\.node\.getComponent\(UITransform\)\)/.test(fx),
        '根节点补挂 UITransform(toLocal 才是本节点坐标, 不是世界坐标)');
    check(/updateWorldTransform\(\)/.test(fx), '换算前刷新世界变换(刚激活的节点矩阵可能是脏的)');

    // 第 0 拍: 和牌副本飞回落位(2026-10-18 二次迭代: 宣告那一帧不再"凭空消失/凭空出现")
    check(Math.abs(num(fx, 'T_FLY_DUR') - 0.7) < 1e-6, `飞行时长 ${num(fx, 'T_FLY_DUR')}s`);
    check(Math.abs(num(fx, 'T_LAND') - num(fx, 'T_FLY_DUR')) < 1e-6,
        'play 一开始就起飞(亮桌面, 不等压暗)');
    // 方案二: 压暗等**闪光的余韵**(含 0.05 淡入)播完 + 留一眼才开始
    check(num(fx, 'T_DIM') >= num(fx, 'T_LAND') + num(fx, 'FLASH_DUR') + 0.05 - 1e-6,
        `压暗等闪光播完(${num(fx, 'T_DIM')} ≥ 落位 ${num(fx, 'T_LAND')} + 闪光 ${num(fx, 'FLASH_DUR') + 0.05})`);
    check(Math.abs(num(fx, 'RING_LIFE') - 0.3) < 1e-6,
        '金环寿命压到 0.3s(落位后一闪即收, 不再拖到压暗前一刻 —— 方案二)');
    check(num(fx, 'RING_LIFE') < num(fx, 'T_DIM') - num(fx, 'T_LAND') + 1e-6,
        '金环比"到压暗为止"短: 余下的时间是留给闪光的, 不是金环');
    check(Math.abs(num(fx, 'T_TILE') - num(fx, 'T_LAND')) < 1e-6,
        '自摸金环与吃胡落位同一时刻(对称, 闪光同样在压暗前收束)');
    // 副本自带金边框 + 起点残影: 无论牌面素材是否加载, "带金边的牌飞过去"都看得清
    const fly = fx.slice(fx.indexOf('private _flyCopy'));
    check(/FlyBorder/.test(fly) && /roundRect\(-bw \/ 2, -bh \/ 2, bw, bh, 14\)/.test(fly),
        '飞行副本自带金边框(用户认领这段动画的视觉锚点)');
    check(/setScale\(1\.25, 1\.25, 1\)/.test(fly), '起点比落位大 1.25 倍(更显眼)');
    check(/FlyGhost/.test(fly) && /opacity = 170/.test(fly), '牌河末格留渐渐消失的残影(交代来路)');
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
    check(!/_showHuToast/.test(main), 'onHu 顶部小字已移除(大字宣告接管)');
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
    check(/maskOp\.opacity = 0/.test(showBody), '遮罩淡入(从特效的压暗层平滑交接)');
    check(/ensureOpacity\(this\._card\)\.opacity = 255/.test(hideBody) && /setPosition\(this\._card\.position\.x, 0, 0\)/.test(hideBody),
        'hide() 复位透明度与位移(下一局不从半透明/偏移开始)');
}

console.log('\n[G] WinnerResult.fromSeat');
{
    check(/fromSeat: number/.test(score), 'WinnerResult 带 fromSeat(点炮者座位, 自摸 -1)');
    check(/fromSeat: e\.isSelfDraw \? -1 : payerSeat/.test(gm), 'GameManager 直接带出, 不靠 delta 反推');
}

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
