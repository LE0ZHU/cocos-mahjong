/**
 * AI 单回合性能基准
 *
 * AI 每个回合要做: 14 个候选 × (1 次向听数 + 34 种进张枚举)
 * 也就是 ~500 次向听数计算, 必须远小于最短思考延时(0.22s), 否则真机会卡帧。
 */
import { Tile } from '../../assets/scripts/core/Tile';
import { TileSuit, TILE_TYPE_COUNT, tileIndexOf } from '../../assets/scripts/core/TileDefine';
import { Shanten } from '../../assets/scripts/core/Shanten';
import { AIBrain, AIContext, AIDifficulty } from '../../assets/scripts/game/AIBrain';
import { Wall } from '../../assets/scripts/core/Wall';

// node 环境下没有 @types/node, 这里只用到 hrtime
declare const process: { hrtime: { bigint(): bigint } };

const wall = new Wall();
const pool: Tile[] = [];
{
    // 把整副牌抽出来做循环池: 一次性 Wall 只有 136 张,
    // 直接用 wall.draw() 会在几百次之后耗尽, 后面的"手牌"全是空数组, 测出来的数是假的。
    while (pool.length < 136) {
        const t = wall.draw();
        if (!t) break;
        pool.push(t);
    }
}
let cursor = 0;
function draw(n: number): Tile[] {
    const out: Tile[] = [];
    for (let i = 0; i < n; i++) {
        out.push(pool[cursor % pool.length]);
        cursor++;
    }
    return out;
}

const visible = new Int8Array(TILE_TYPE_COUNT);
for (const t of draw(40)) visible[tileIndexOf(t.suit, t.rank)]++;

const threats = [
    { discards: draw(8), melds: [], declaredTenpai: true },
    { discards: draw(6), melds: [], declaredTenpai: false },
    { discards: draw(4), melds: [], declaredTenpai: false },
];

console.log('每回合决策耗时(含向听数/进张/防守推断):\n');
for (const d of ['reckless', 'balanced', 'expert'] as AIDifficulty[]) {
    // 预热
    for (let i = 0; i < 20; i++) {
        const hand = draw(14);
        AIBrain.chooseDiscard({ hand, melds: [], declaredTenpai: false, visible, threats, wallRemaining: 50, difficulty: d });
        draw(14);
    }
    const N = 300;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
        const hand = draw(14);
        AIBrain.chooseDiscard({
            hand, melds: [], declaredTenpai: false,
            visible, threats, wallRemaining: 50, difficulty: d,
        });
    }
    const t1 = process.hrtime.bigint();
    const msPerTurn = Number(t1 - t0) / 1e6 / N;
    console.log(`  ${d.padEnd(9)}: ${msPerTurn.toFixed(3)} ms/回合  (最短思考延时 220ms, 占比 ${(msPerTurn / 220 * 100).toFixed(1)}%)`);
}

// 单独量一下 Shanten.ukeire 的开销
{
    const hand = draw(13);
    const N = 2000;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) Shanten.ukeire(hand, 0, visible);
    const t1 = process.hrtime.bigint();
    console.log(`\n  Shanten.ukeire(13张, 34选张): ${(Number(t1 - t0) / 1e6 / N).toFixed(4)} ms/次`);
}
{
    const hand = draw(13);
    const N = 20000;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) Shanten.calc(hand, 0);
    const t1 = process.hrtime.bigint();
    console.log(`  Shanten.calc(含记忆化):       ${(Number(t1 - t0) / 1e6 / N).toFixed(4)} ms/次`);
    console.log(`  记忆化条目数: ${(Shanten as unknown as { _cache: Map<number, number> })._cache.size}`);
}