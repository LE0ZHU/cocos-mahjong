/**
 * AI 策略行为验证
 *
 * 1. 三档难度对同一手牌应给出不同倾向(快档更莽、慢档更稳)
 * 2. 慢档在"别人已听牌"时应主动打安全牌
 * 3. 立直后必须保持听牌
 * 4. 副露不能破坏门清意图 / 不该在已听牌时副露
 * 5. 全自动对局 N 局: 不崩溃、不非法出牌、能正常结束
 */
import { Tile } from '../../assets/scripts/core/Tile';
import { TileSuit, MAX_RANK, TILE_TYPE_COUNT, tileIndexOf } from '../../assets/scripts/core/TileDefine';
import { Wall } from '../../assets/scripts/core/Wall';
import { HuChecker } from '../../assets/scripts/core/HuChecker';
import { Shanten } from '../../assets/scripts/core/Shanten';
import { AIBrain, AIContext, AIDifficulty } from '../../assets/scripts/game/AIBrain';
import { Player } from '../../assets/scripts/game/Player';
import { AIDefense, ThreatInfo } from '../../assets/scripts/core/AIDefense';
import { Meld } from '../../assets/scripts/core/Meld';
import { runBatch } from './simulator';

let fails = 0;
function check(cond: boolean, label: string, detail = ''): void {
    if (cond) console.log(`  ✓ ${label}`);
    else { fails++; console.log(`  ✗ ${label} ${detail}`); }
}

function mk(spec: string[]): Tile[] {
    return spec.map(s => {
        const idx = Number(s);
        const suit = idx < 9 ? TileSuit.WAN : idx < 18 ? TileSuit.TIAO : idx < 27 ? TileSuit.TONG : idx < 31 ? TileSuit.FENG : TileSuit.JIAN;
        const rank = idx < 9 ? idx + 1 : idx < 18 ? idx - 8 : idx < 27 ? idx - 17 : idx < 31 ? idx - 26 : idx - 30;
        return new Tile(-1, suit, rank);
    });
}
function emptyVisible(): Int8Array { return new Int8Array(TILE_TYPE_COUNT); }
function ctxOf(hand: Tile[], difficulty: AIDifficulty, extra?: Partial<AIContext>): AIContext {
    return {
        hand,
        melds: [],
        declaredTenpai: false,
        visible: emptyVisible(),
        threats: [],
        wallRemaining: 60,
        difficulty,
        ...extra,
    };
}

console.log('=== 1. 三档难度倾向差异 ===');
// 一手明显该打的牌: 大量孤张幺九字牌 + 一个成型顺子
const messy = mk([
    '0', '8', '17', '26', '27', '28', '29', '30', '31',   // 幺九 + 字牌一堆
    '3', '4', '5', '11', '12',                            // 两组顺子
]);
const picks = {
    reckless: AIBrain.chooseDiscard(ctxOf(messy, 'reckless')),
    balanced: AIBrain.chooseDiscard(ctxOf(messy, 'balanced')),
    expert: AIBrain.chooseDiscard(ctxOf(messy, 'expert')),
};
console.log(`  快档打: ${messy[picks.reckless].displayText}`);
console.log(`  常规档打: ${messy[picks.balanced].displayText}`);
console.log(`  慢档打: ${messy[picks.expert].displayText}`);
// 三档都应打出某张"孤张"而不是拆顺子
const keepsChow = (i: number): boolean => {
    const t = messy[i];
    if (!t.isNumberTile) return false;
    return [3, 4, 5].includes(t.rank) && t.suit === TileSuit.WAN ? false : true;
};
void keepsChow;
for (const k of ['reckless', 'balanced', 'expert'] as AIDifficulty[]) {
    const t = messy[picks[k]];
    const isYaochuOrHonor = !t.isNumberTile || t.rank === 1 || t.rank === 9;
    check(isYaochuOrHonor, `${k}: 优先打幺九/字牌(打了 ${t.displayText})`);
}

console.log('\n=== 2. 防守: 慢档应躲已听牌对手的现物 ===');
// 构造: 我手上有 中(31); 对手已打过 中 且已宣告听牌
const myHand = mk(['0', '1', '2', '3', '4', '5', '6', '7', '8', '31', '27', '31', '19']);
const threat: ThreatInfo = {
    discards: mk(['31']),          // 对手打过中
    melds: [],
    declaredTenpai: true,
};
const vis = emptyVisible();
vis[tileIndexOf(TileSuit.JIAN, 1)] = 2;
const ctxSafe = ctxOf(myHand, 'expert', { threats: [threat], visible: vis });
const idxSafe = AIBrain.chooseDiscard(ctxSafe);
const pickedSafe = myHand[idxSafe];
check(
    !(pickedSafe.suit === TileSuit.JIAN && pickedSafe.rank === 1),
    `expert: 不打对手现物"中"(实际打了 ${pickedSafe.displayText})`,
);

console.log('\n=== 3. 立直锁: 只能打保持听牌的牌 ===');
// 听牌手牌: 123456789m + 11s + 5t(14张含摸牌), 打出后必须仍听牌
const tenpaiHand = mk(['0', '1', '2', '3', '4', '5', '6', '7', '8', '18', '18', '19', '26', '26']);
const before = Shanten.calc(tenpaiHand, 0);
check(before === Shanten.TENPAI, `构造的手牌确实是听牌 (shanten=${before})`);
const ctxLock = ctxOf(tenpaiHand, 'expert', { declaredTenpai: true });
const lockIdx = AIBrain.chooseDiscard(ctxLock);
const after = Shanten.calc(tenpaiHand.filter((_, i) => i !== lockIdx), 0);
check(after === Shanten.TENPAI, `expert: 立直后打出 ${tenpaiHand[lockIdx].displayText} 仍听牌 (shanten=${after})`);

console.log('\n=== 4. 副露策略 ===');
// 门清 + 好牌型时, 慢档应拒绝"碰"以保住门清与立直
const goodHand = mk(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
const ponTile = mk(['13'])[0];
const ponCand = [{ type: 'pon' as const, handTiles: [mk(['13', '13'])[0], mk(['13', '13'])[1]] }];
// 让手里真有这两张条3: 上面 goodHand 没有, 换成有对子的
const withPair = mk(['0', '1', '2', '3', '4', '5', '6', '7', '8', '21', '21', '22', '10']);
const pon2 = [
    { type: 'pon' as const, handTiles: [mk(['21'])[0], mk(['21'])[1]] },
];
void ponCand;
const src21 = mk(['21'])[0];
const beforeMenzen = Shanten.calc(withPair, 0);
const expertMeld = AIBrain.chooseMeld(ctxOf(withPair, 'expert'), pon2, src21);
const recklessMeld = AIBrain.chooseMeld(ctxOf(withPair, 'reckless'), pon2, src21);
console.log(`  手牌向听=${beforeMenzen}; expert 碰七索 → ${expertMeld ? '碰' : '过'}, reckless → ${recklessMeld ? '碰' : '过'}`);
// 重点: 两者都不应崩, 且 expert 更保守(更可能"过")
check(expertMeld === null || recklessMeld !== null, 'expert 的副露倾向不高于 reckless');

console.log('\n=== 5. 全自动对局 (含点炮) ===');
console.log('\n--- 4 家同难度自对局: 看胡牌率与非法操作 ---');
for (const d of ['reckless', 'balanced', 'expert'] as AIDifficulty[]) {
    const N = 150;
    const r = runBatch(d, d, N, 500 + d.length * 7777);
    console.log(`  ${d.padEnd(9)}: ${N} 局, 有人胡 ${r.huTotal} 次, 流局/平 ${r.draw}, 非法操作 ${r.errors.length}`);
    check(r.errors.length === 0, `${d}: 无非法操作`, r.errors.slice(0, 2).join('; '));
}

console.log('\n--- 强度对比(交换座位法, 消除"1 家 vs 3 家"的位置偏差) ---');
/**
 * 座位 0 是一家, 座位 1-3 是三家, 所以单看 W(A,B) 天生偏向"三家那边",
 * 而且防守的价值不在"多赢几局"而在"少输分"。
 * 因此这里用**交换座位 + 平均得分**两个维度一起看:
 *   avgScoreA(A,B) = A 单独上场时的场均得分
 *   avgScoreA(B,A) = B 单独上场时的场均得分
 * A 越强, 两者差值越大(正数)。
 */
const N = 600;

/**
 * 噪声底: 同一难度自比时"胜率/场均分应该差多少"
 *
 * 为什么必须先测: 下面的断言要判断"慢档有没有明显弱于常规档",
 * 而**这个测试本身是非确定性的** —— `reckless` 档 `noise: 45`、
 * `balanced` 档 `noise: 2`, 都由未播种的 `Math.random()` 喂
 * (`AIBrain._scoreDiscard` / `_scoreMeld` / `rankMelds` 共 3 处)。
 * 实测同一份编译产物连跑两次:
 *   expert vs reckless: +25.8 / +29.8 / +34.8pt  ← 摇摆 9pt
 *   expert vs balanced 场均分: +0.9 / -0.5       ← 结论能反过来
 *   expert vs expert(自比): 胜率差 3.8pt, 场均分差 -0.6
 *
 * 所以阈值取"自比噪声的 2 倍"并设下限 —— 只有超出噪声几倍才算真回归。
 * 写成固定小值(曾用 `> -3` / `> 0`)会周期性假报警, 让人误以为 AI 改坏了。
 */
const CAL_N = 600;
const _calAB = runBatch('expert', 'expert', CAL_N, 31000);
const _calBA = runBatch('expert', 'expert', CAL_N, 41000);
const _noiseWin = Math.abs((_calAB.winA - _calBA.winA) / CAL_N * 100);
const _noiseScore = Math.abs(_calAB.avgScoreA - _calBA.avgScoreA);
const TOL_WIN = Math.max(4, _noiseWin * 2);
const TOL_SCORE = Math.max(1, _noiseScore * 2);
console.log(
    `  [噪声底] expert 自比: 胜率差 ${_noiseWin.toFixed(1)}pt, 场均分差 ${_noiseScore.toFixed(1)}`
    + `  → 判定阈值 胜率 ±${TOL_WIN.toFixed(1)}pt / 场均分 ±${TOL_SCORE.toFixed(1)}`,
);

for (const [a, b] of [
    ['expert', 'reckless'],
    ['expert', 'balanced'],
    ['balanced', 'reckless'],
] as [AIDifficulty, AIDifficulty][]) {
    const ab = runBatch(a, b, N, 20000 + a.length * 7919);
    const ba = runBatch(b, a, N, 20000 + b.length * 7919);
    const sAB = ab.avgScoreA;
    const sBA = ba.avgScoreA;
    const winDiff = ((ab.winA / N) - (ba.winA / N)) * 100;
    const scoreDiff = sAB - sBA;
    console.log(
        `  ${a.padEnd(9)} vs ${b.padEnd(9)}: `
        + `胜率 ${winDiff >= 0 ? '+' : ''}${winDiff.toFixed(1)}pt | `
        + `场均分 ${sAB.toFixed(1)} vs ${sBA.toFixed(1)} → ${scoreDiff >= 0 ? '+' : ''}${scoreDiff.toFixed(1)}`,
    );
    check(ab.errors.length === 0 && ba.errors.length === 0, `${a} vs ${b}: 无非法操作`);
    // 强弱判定要分档位性质, 不能一刀切只看胜率:
    //  - 慢档 vs 快档: 慢档既该赢更多, 也该少输分(差距应非常明显)
    //  - 慢档 vs 常规: 慢档是"防守型"加强, 胜率未必更高,
    //    但**被点炮的次数少 → 场均分应该更高**。
    //    用胜率去要求慢档碾压常规是错误预期(实测也确实只差 ±0.2pt 噪声内)。
    //
    // ⚠️ 阈值必须留出**噪声余量**, 否则会周期性假报警:
    //    `reckless` 档 noise:45 由未播种的 Math.random() 喂, 运行间方差很大 ——
    //    同一份编译产物连跑两次, 本项曾给出 +0.9(通过) 与 -0.5(失败) 两个相反结论,
    //    而末尾的校准项显示 expert 对自己都有 -0.6 的分差。
    //    所以这里用 TOL_* (`见下方 NOISE 说明`) 而不是 0。
    if (b === 'reckless') {
        // 快档与本档的差距是 25pt / 5 分量级, 阈值卡严一些仍有很大余量
        check(winDiff > 5, `${a} 胜率应明显强于快档 (${winDiff.toFixed(1)}pt)`);
        check(scoreDiff > 1, `${a} 场均分应明显高于快档 (${scoreDiff.toFixed(1)})`);
    } else {
        check(winDiff > -TOL_WIN, `${a} 胜率不应明显弱于 ${b} (${winDiff.toFixed(1)}pt)`);
        check(scoreDiff > -TOL_SCORE, `${a} 场均分应高于 ${b} (${scoreDiff.toFixed(1)})`);
    }
}

// 同难度自比: 差值应接近 0(噪声底已在开头测过并用于上面的阈值, 这里复用)
{
    console.log(
        `  [校准] expert vs expert: 胜率差 ${_noiseWin.toFixed(1)}pt, 场均分差 ${_noiseScore.toFixed(1)} (都应接近 0)`,
    );
    check(_noiseWin < 8, '同难度自比胜率差应在噪声范围内', `${_noiseWin.toFixed(1)}pt`);
    check(_noiseScore < 3, '同难度自比场均分差应在噪声范围内', `${_noiseScore.toFixed(1)}`);
}

console.log(`\n=== 结果: ${fails === 0 ? '全部通过' : fails + ' 项失败'} ===`);
