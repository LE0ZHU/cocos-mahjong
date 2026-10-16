/**
 * 决策超时(20秒自动行动)逻辑验证
 *
 * GameManager 依赖 cc 引擎, 无法直接在 node 跑。
 * 这里用**源码提取**的方式把 update() / 计时字段 / 超时动作原样搬到无依赖的镜像类上:
 * 读的是真实的 GameManager.ts, 不是手抄一份 —— 手抄会与实现漂移, 那样的测试没有意义。
 *
 * 验证点:
 *  1. 出牌超时 → 打出**刚摸到的那张**(哪怕它很有用)
 *  2. 副露超时 → 默认"过"
 *  3. 不到 20 秒不触发
 *  4. 玩家已行动后计时停止, 不会再自动打牌
 *  5. 超时只触发一次(不会连打两张)
 *  6. 决策计时中不会因为 _awaitingPlayerMeld 混用而误判
 */
// 本仓库没有 @types/node, 用 require 引入以跳过类型解析
declare const require: (m: string) => any;
declare const __dirname: string;
declare const process: { exit(code: number): never };
const fs = require('fs');
const path = require('path');

// 编译输出目录随调用方式变化(temp/a、temp/aitest/... 都有可能),
// 所以从脚本位置向上找到项目根, 而不是用固定的相对层级
function findGameManager(): string {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        const p = path.join(dir, 'assets', 'scripts', 'managers', 'GameManager.ts');
        if (fs.existsSync(p)) return p;
        dir = path.dirname(dir);
    }
    throw new Error('找不到 GameManager.ts');
}

const GM_PATH = findGameManager();
const src = fs.readFileSync(GM_PATH, 'utf8');

let fails = 0;
function check(cond: boolean, label: string, detail = ''): void {
    if (cond) console.log(`  ✓ ${label}`);
    else { fails++; console.log(`  ✗ ${label} ${detail}`); }
}

/**
 * 从真实源码里抽出 update() 的方法体, 去掉引擎调用
 * (我们只关心"到点后做什么", 那几行是纯逻辑)
 */
function extractUpdateBody(): string {
    const start = src.indexOf('    update(dt: number): void {');
    if (start < 0) throw new Error('找不到 GameManager.update');
    // 花括号配平
    let depth = 0; let i = src.indexOf('{', start);
    const begin = i;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    return src.slice(begin, i + 1);
}

console.log('=== 源码结构检查 ===');
check(src.includes('DECIDE_LIMIT = 20'), 'DECIDE_LIMIT = 20');
check(src.includes("_startDecisionTimer('discard')"), "出牌处调用 _startDecisionTimer('discard')");
check(src.includes("_startDecisionTimer('meld')"), "副露处调用 _startDecisionTimer('meld')");
check(src.includes('this._clearDecisionTimer()'), '存在 _clearDecisionTimer');

// 统计启停点: 出牌起计时应至少 3 处(摸牌/杠后/恢复回合), 副露 3 处
const startDiscard = (src.match(/_startDecisionTimer\('discard'\)/g) || []).length;
const startMeld = (src.match(/_startDecisionTimer\('meld'\)/g) || []).length;
const clearCalls = (src.match(/_clearDecisionTimer\(\)/g) || []).length;
check(startDiscard >= 3, `出牌起计时点 ≥3 (实际 ${startDiscard})`);
check(startMeld === 3, `副露起计时点 = 3 (实际 ${startMeld})`);
check(clearCalls >= 4, `停止计时点 ≥4 (实际 ${clearCalls})`);

console.log('\n=== 超时行为验证(用镜像类执行真实 update 体) ===');

const updateBody = extractUpdateBody();

// 镜像: 只保留 update() 依赖的状态与动作
class TimerHarness {
    DECIDE_LIMIT = 20;
    _decideElapsed = 0;
    _decideKind: 'discard' | 'meld' | 'none' = 'none';
    _decideTimedOut = false;
    _phase = 2;                 // 2=PLAYER_TURN(与 GamePhase 枚举一致)
    _canDiscard = true;
    _awaitingPlayerMeld = false;
    _playerDrawnTile: number | null = null;
    /** 真实代码里是 this._player.hand; 替身用 _player 包一层手牌 */
    _player = { hand: [] as number[] };
    get hand(): number[] { return this._player.hand; }
    set hand(v: number[]) { this._player.hand = v; }
    /** 记录发生的动作 */
    playedIndex = -1;
    meldResolved = -99;

    _startDecisionTimer(kind: 'discard' | 'meld'): void {
        this._decideKind = kind; this._decideElapsed = 0; this._decideTimedOut = false;
    }
    _clearDecisionTimer(): void {
        this._decideKind = 'none'; this._decideElapsed = 0; this._decideTimedOut = false;
    }
    playTile(index: number): boolean {
        const t = this._player.hand[index];
        if (t === undefined) return false;
        this._clearDecisionTimer();
        this._player.hand.splice(index, 1);
        this._playerDrawnTile = null;
        this.playedIndex = index;
        return true;
    }
    resolvePlayerMeld(i: number): void {
        if (!this._awaitingPlayerMeld) return;
        this._clearDecisionTimer();
        this._awaitingPlayerMeld = false;
        this.meldResolved = i;
    }
    get decideRemain(): number {
        if (this._decideKind === 'none') return 0;
        return Math.max(0, this.DECIDE_LIMIT - this._decideElapsed);
    }
    get deciding(): boolean { return this._decideKind !== 'none'; }

    // 注入真实 update 体
    update: (dt: number) => void;
}

// update 体里引用了引擎侧的 GamePhase 枚举与 console, 这里用同名的最小替身喂进去。
// GamePhase 的数值必须与 GameManager.ts 里的枚举一致:
//   IDLE=0, DEALING=1, PLAYER_TURN=2, AI_TURN=3, GAME_OVER=4
const enumPhases: Record<string, number> = {
    GamePhase: 0, IDLE: 0, DEALING: 1, PLAYER_TURN: 2, AI_TURN: 3, GAME_OVER: 4,
};
const log = { log: () => { /* 静默, 避免刷屏 */ } };
// update 体里用的是静态 GameManager.DECIDE_LIMIT, 替身同样要提供
const GMs = { DECIDE_LIMIT: 20 };

// 把真实 update 体挂到原型上, 这样所有实例都能用
(TimerHarness.prototype as any).update = function (dt: number): void {
    const fn = new Function('dt', 'GamePhase', 'console', 'GameManager', updateBody);
    fn.call(this, dt, enumPhases, log, GMs);
};

function tick(harness: any, seconds: number, step = 0.25): void {
    for (let t = 0; t < seconds; t += step) harness.update(step);
}

// --- 1. 出牌超时: 打出刚摸的那张 ---
{
    const g: any = new TimerHarness();
    g.hand = [10, 11, 12, 13];       // 索引 3 是刚摸的
    g._playerDrawnTile = 13;
    g._startDecisionTimer('discard');
    tick(g, 19.5);
    check(g.playedIndex === -1, '出牌: 19.5 秒时还没自动出牌');
    tick(g, 1.0);   // 越过 20
    check(g.playedIndex === 3, `出牌超时: 自动打出刚摸的那张 (playedIndex=${g.playedIndex}, 期望 3)`);
    check(g.hand.length === 3, '出牌超时后手牌少了一张');
}

// --- 2. 副露超时: 默认过 ---
{
    const g: any = new TimerHarness();
    g._awaitingPlayerMeld = true;
    g._startDecisionTimer('meld');
    tick(g, 19);
    check(g.meldResolved === -99, '副露: 19 秒时还没自动处理');
    tick(g, 1.5);
    check(g.meldResolved === -1, `副露超时: 默认"过" (meldResolved=${g.meldResolved}, 期望 -1)`);
    check(!g._awaitingPlayerMeld, '副露超时后挂起状态已解除');
}

// --- 3. 超时只触发一次 ---
{
    const g: any = new TimerHarness();
    g.hand = [1, 2, 3, 4];
    g._playerDrawnTile = 4;
    g._startDecisionTimer('discard');
    tick(g, 20);
    const first = g.playedIndex;
    tick(g, 10);                     // 再等 10 秒
    check(first === 3, '首次超时打出刚摸的牌');
    check(g.playedIndex === first, '超时后继续空转不会打出第二张牌');
    check(g.hand.length === 3, '超时只发生一次(手牌只少一张)');
}

// --- 4. 玩家提前出牌 → 计时停止 ---
{
    const g: any = new TimerHarness();
    g.hand = [10, 11, 12, 13];
    g._playerDrawnTile = 13;
    g._startDecisionTimer('discard');
    tick(g, 5);
    g.playTile(0);                    // 玩家点了第二张
    check(!g.deciding, '玩家出牌后停止计时');
    tick(g, 30);
    check(g.playedIndex === 0, '玩家已出牌后不会再被超时自动出牌');
    check(g.hand.length === 3, '只出了一张牌');
}

// --- 5. 玩家提前点"过" → 计时停止 ---
{
    const g: any = new TimerHarness();
    g._awaitingPlayerMeld = true;
    g._startDecisionTimer('meld');
    tick(g, 3);
    g.resolvePlayerMeld(-1);
    tick(g, 30);
    check(g.meldResolved === -1, '副露: 玩家自己点过, 超时不会再触发');
}

// --- 6. 计时可被重新开始(下一回合不残留) ---
{
    const g: any = new TimerHarness();
    g._startDecisionTimer('discard');
    tick(g, 19);
    check(g.decideRemain > 0 && g.decideRemain < 2, `19 秒后剩余约 1 秒 (${g.decideRemain.toFixed(1)})`);
    // 玩家出牌后再起新的一次
    g.hand = [1, 2];
    g._playerDrawnTile = 2;
    g.playTile(1);
    g._startDecisionTimer('discard');
    check(g.decideRemain > 19.5, '重新计时从满值开始');
}

// --- 7. 非决策状态(AI 回合)不会误触发 ---
{
    const g: any = new TimerHarness();
    g._phase = 3;                    // AI_TURN
    g._canDiscard = false;
    g._startDecisionTimer('discard');
    tick(g, 25);
    check(g.playedIndex === -1, 'AI 回合/不可出牌时, 超时不会替玩家出牌');
}

console.log(`\n=== 结果: ${fails === 0 ? '全部通过' : fails + ' 项失败'} ===`);
process.exit(fails === 0 ? 0 : 1);