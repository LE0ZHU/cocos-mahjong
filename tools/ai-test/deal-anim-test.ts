/**
 * 发牌动画时序复核
 *
 * 发牌动画横跨两个文件, 最容易出的问题是**规则层被动画污染**或**状态没归零**:
 *  - GameManager 里混入补间 → 规则层不能再脱离引擎单测
 *  - 发牌期间就起 20 秒倒计时 → 玩家还没看清手牌就被判超时
 *  - `_dealing` 残留 → 下一局点手牌没反应(最难查的一类)
 *
 * 这些从代码上"看着对"也可能错, 所以从**真实源码**提取关键结构做断言。
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

const mainSrc = fs.readFileSync(findFile('assets/scripts/Main.ts'), 'utf8');
const gmSrc = fs.readFileSync(findFile('assets/scripts/managers/GameManager.ts'), 'utf8');
const animSrc = fs.readFileSync(findFile('assets/scripts/ui/Anim.ts'), 'utf8');
const rulesSrc = fs.readFileSync(findFile('assets/scripts/game/GameRules.ts'), 'utf8');
// 方法体一律在"去注释"的源码里提取, 避免命中文档注释中的同名文本
const mainCode = stripComments(mainSrc);
const gmCode = stripComments(gmSrc);

let fails = 0;
function check(cond: boolean, label: string, detail = ''): void {
    if (cond) console.log(`  ✓ ${label}`);
    else { fails++; console.log(`  ✗ ${label} ${detail}`); }
}

/** 剥离块注释与行注释, 只留真实代码(字符串字面量内的内容会一并丢, 本脚本不需要) */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
        .replace(/\/\/[^\n]*/g, '');          // 行注释
}

/**
 * 取方法体(花括号配平), 在**去注释后**的源码里找
 *
 * 为什么先去注释: 方法名常出现在文档注释里(如"所以拆成: startGame() 同步发完"),
 * 直接在原文里 indexOf 会命中注释那处, 取到完全无关的代码 ——
 * 本脚本前两版都栽在这: 第一版误报"startGame 里调了 _playerDraw",
 * 第二版加括号过滤后把真方法也滤掉了(参数里的 `() => void` 含嵌套圆括号)。
 * 先剥注释再匹配, 才是干净的做法。
 */
function methodBody(code: string, signature: string): string {
    const i = code.indexOf(signature);
    if (i < 0) return '';
    let depth = 0, started = false;
    for (let j = code.indexOf('{', i); j < code.length; j++) {
        if (code[j] === '{') { depth++; started = true; }
        else if (code[j] === '}') {
            depth--;
            if (started && depth === 0) return code.slice(i, j + 1);
        }
    }
    return '';
}

const HAND_SIZE = Number((rulesSrc.match(/export const HAND_SIZE = (\d+);/) || [])[1] || 13);

console.log('=== 时序常量 ===');
const dealInterval = Number((animSrc.match(/dealInterval: ([\d.]+)/) || [])[1]);
const dealLead = Number((animSrc.match(/dealLeadIn: ([\d.]+)/) || [])[1]);
const dealFly = Number((animSrc.match(/dealFly: ([\d.]+)/) || [])[1]);
const dealStagger = Number((animSrc.match(/dealStagger: ([\d.]+)/) || [])[1]);
const dealSettle = Number((animSrc.match(/dealLastSettle: ([\d.]+)/) || [])[1]);
console.log(`  起手 ${HAND_SIZE} 张  间隔 ${dealInterval}s  起飞前置 ${dealLead}s  单张飞行 ${dealFly}s`);
console.log(`  四家错峰 ${dealStagger}s  收尾等待 ${dealSettle}s`);
const total = dealLead + HAND_SIZE * (dealInterval + dealStagger * 3) + dealSettle;
console.log(`  预计总耗时 ≈ ${total.toFixed(2)}s`);

console.log('\n=== ① 发牌节奏观感 ===');
// 太慢: 玩家干等; 太快: 又变回"啪一下全出来"
check(total >= 0.8, `总耗时 ${total.toFixed(2)}s ≥ 0.8s(看得清逐张弹出)`);
check(total <= 2.6, `总耗时 ${total.toFixed(2)}s ≤ 2.6s(不至于干等)`);
// 每一轮必须比四家错峰总时长长, 否则下一轮会在上一轮还没落定时就重建手牌
const roundSpan = dealInterval + dealStagger * 3;
check(dealInterval >= dealStagger * 3,
    `轮间隔 ${dealInterval}s ≥ 四家错峰总长 ${(dealStagger * 3).toFixed(3)}s`,
    '否则帧与帧会互相打断, 看起来像卡顿');
// 收尾等待必须盖住最后一张的飞行时间
check(dealSettle >= dealFly * 0.8,
    `收尾等待 ${dealSettle}s 盖得住最后一张飞行 ${dealFly}s`);

console.log('\n=== ② 规则层不许被动画污染 ===');
const startGameBody = methodBody(gmCode, 'startGame(');
check(!!startGameBody, '能取到 GameManager.startGame 方法体');
check(!/tween|Tween|scheduleOnce/.test(startGameBody),
    'startGame 里没有补间/调度(规则层保持同步可测)');
check(!/onDealRound/.test(gmSrc),
    '没有把发牌拆成异步回调(当初那版 13 次回调全在同一帧, 等于没动画)');
// 发牌与开局必须分成两步
check(/beginPlay/.test(gmSrc), 'GameManager 提供 beginPlay()(发牌与开局分离)');
const beginBody = methodBody(gmCode, 'beginPlay(): void');
check(beginBody.includes('GamePhase.DEALING'),
    'beginPlay 只在 DEALING 阶段生效(幂等, 重复调用不会连摸两张)');
check(beginBody.includes('_playerDraw'),
    'beginPlay 里才调 _playerDraw()(自动摸牌 + 起 20 秒倒计时)');

console.log('\n=== ③ 发牌期间不该能操作/计时 ===');
const startGame2 = methodBody(gmCode, 'startGame(');
check(startGame2.includes('GamePhase.DEALING'),
    'startGame 结束时阶段是 DEALING(不是 PLAYER_TURN)');
check(!startGame2.includes('_startDecisionTimer'),
    'startGame 不起倒计时(否则手牌还没发完就开始计时)');
// 注意: 不能用 `includes('_playerDraw')` —— `_playerDrawnTile = null` 里含这个子串,
// 会误判成"调了摸牌"。要匹配真正的调用形态: 前面是 `this.` 且**没有**紧跟标识符。
const callsPlayerDraw = /this\._playerDraw\s*\(/.test(startGame2);
check(!callsPlayerDraw,
    'startGame 不自动摸牌(等动画播完由 beginPlay 负责)',
    callsPlayerDraw ? '→ 发牌还没播完就摸牌了' : '');
// UI 侧要拦点击/拖拽, 且是静默拦截(不弹"还没轮到你出牌")
const clickBody = methodBody(mainCode, 'private _onTileClick');
check(/if \(this\._dealing\) return;/.test(clickBody),
    '点击手牌时发牌中直接返回(不发牌期间点不动)');
const clickDealingIdx = clickBody.indexOf('_dealing');
const clickToastIdx = clickBody.indexOf('_showToast');
check(clickDealingIdx >= 0 && (clickToastIdx < 0 || clickDealingIdx < clickToastIdx),
    '发牌拦截在"弹提示"之前(静默, 不像出错了)');
const dropBody = methodBody(mainCode, 'private _onTileDropDiscard');
check(/if \(this\._dealing\) return false;/.test(dropBody), '拖拽出牌时发牌中直接返回');

console.log('\n=== ④ 状态必须能归零(否则下一局点不动) ===');
check(!!methodBody(mainCode, 'private _abortDealing'), '有 _abortDealing 统一归零发牌状态');
const abortBody = methodBody(mainCode, 'private _abortDealing(): void');
check(abortBody.includes('_dealing = false') && abortBody.includes('_dealShown = 0'),
    '_abortDealing 同时清 _dealing 与 _dealShown');
// 返回主页面与重新开始都必须调它
// ⚠️ 签名要写到 `(): void`: 抽牌模式新增了 `_backToMenuFromDraw`,
// 只写 `private _backToMenu` 会先命中那个方法(它是切抽牌页用的, 不含发牌中断)。
const backBody = methodBody(mainCode, 'private _backToMenu(): void');
check(backBody.includes('_abortDealing'), '返回主页面时中断发牌');
const restartBody = methodBody(mainCode, 'private _onRestartClick');
check(restartBody.includes('_abortDealing'), '重新开始时中断发牌');

console.log('\n=== ⑤ 定稿刷新不能漏 ===');
const finishBody = methodBody(mainCode, 'private _finishDealing');
check(!!finishBody, '能取到 _finishDealing');
// 前面每帧只画前 n 张, 收尾必须按完整手牌重画, 否则玩家少牌
check(/this\._refreshHand\(\)/.test(finishBody),
    '收尾时按完整手牌刷新(前面每帧只画了前 n 张, 漏了会少牌)');
check(/for \(let a = 0; a < gm\.aiCount; a\+\+\) this\._refreshAIHand\(a\)/.test(finishBody),
    '收尾时三家 AI 也按完整手牌刷新');
check(finishBody.includes('_refreshWall()'),
    '收尾时牌墙刷回真实张数(前面是动画用的递减视图)');
check(finishBody.includes('gm.beginPlay()'), '收尾后才真正开局');
// 顺序: 刷新必须在 beginPlay 之前(否则摸牌标注来不及画)
check(finishBody.indexOf('_refreshHand()') < finishBody.indexOf('beginPlay()'),
    '先定稿刷新手牌, 再 beginPlay(顺序反了摸牌标注会丢)');

console.log('\n=== ⑥ 牌墙随发牌递减 ===');
check(!!mainSrc.match(/_refreshWall\(countOverride\?: number\)/),
    '_refreshWall 支持指定张数(发牌时让牌墙看起来被一张张取走)');
check(mainSrc.includes('_wallRemainingBase'),
    '记下发完后的真实剩余张数, 每帧往回退');
check(mainSrc.includes('this._refreshWall(this._wallRemainingBase - n)'),
    '每帧按"真实剩余 - 已揭示"绘制牌墙');

console.log(`\n=== 结果: ${fails === 0 ? '全部通过' : fails + ' 项失败'} ===`);
process.exit(fails === 0 ? 0 : 1);