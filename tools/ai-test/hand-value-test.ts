/**
 * 打点估计(HandValue) + 听牌保护 的回归测试
 *
 * 两件事必须锁住:
 *  1) `estimateHandValue` 的番数与 `HuScore.FAN_DEFS` **同口径** ——
 *     否则会出现"AI 以为值 4 番、结算只给 2 番"的骗人情况。
 *  2) **听牌不许被拆**: 已经听牌(哪怕没点「听牌」)时, 提示/AI 都不能为了躲一张
 *     危险牌去拆听 —— 这是 2026-10-17 用户报的那个 bug。死听(剩 0 张)例外。
 */
import { Tile } from '../../assets/scripts/core/Tile';
import { TileSuit, TILE_TYPE_COUNT, tileIndexOf } from '../../assets/scripts/core/TileDefine';
import { Shanten } from '../../assets/scripts/core/Shanten';
import { HuChecker } from '../../assets/scripts/core/HuChecker';
import { FAN_DEFS } from '../../assets/scripts/core/HuScore';
import { AIContext } from '../../assets/scripts/game/AIBrain';
import { AIBrain } from '../../assets/scripts/game/AIBrain';
import { estimateHandValue } from '../../assets/scripts/game/HandValue';
import { HintAdvisor } from '../../assets/scripts/game/HintAdvisor';
import type { ThreatInfo } from '../../assets/scripts/core/AIDefense';

declare const process: { exit(code: number): never };

let fails = 0;
function check(cond: boolean, label: string, detail = ''): void {
    if (cond) console.log(`  ✓ ${label}`);
    else { fails++; console.log(`  ✗ ${label} ${detail}`); }
}
function near(a: number, b: number, eps = 1e-6): boolean { return Math.abs(a - b) < eps; }

/** 按 "m1"/"p9"/"f1"(东)/"j1"(中) 造牌 */
function mk(spec: string[]): Tile[] {
    let id = 0;
    const out: Tile[] = [];
    for (const sp of spec) {
        const suit = sp[0];
        const rank = Number(sp.slice(1));
        if (suit === 'm') out.push(new Tile(id++, TileSuit.WAN, rank));
        else if (suit === 's') out.push(new Tile(id++, TileSuit.TIAO, rank));
        else if (suit === 'p') out.push(new Tile(id++, TileSuit.TONG, rank));
        else if (suit === 'f') out.push(new Tile(id++, TileSuit.FENG, rank));
        else out.push(new Tile(id++, TileSuit.JIAN, rank));
    }
    return out;
}
function fanOf(name: string): number {
    const d = FAN_DEFS.filter(x => x.name === name)[0];
    return d ? d.fan : -999;
}
function emptyVisible(hand: Tile[] = []): Int8Array {
    const v = new Int8Array(TILE_TYPE_COUNT);
    for (const t of hand) v[tileIndexOf(t.suit, t.rank)]++;
    return v;
}
function ctxOf(hand: Tile[], extra?: Partial<AIContext>): AIContext {
    return {
        hand, melds: [], declaredTenpai: false,
        visible: emptyVisible(hand), threats: [], wallRemaining: 60, difficulty: 'expert',
        ...extra,
    };
}

console.log('\n=== 1. 番数与 FAN_DEFS 同口径 ===');
check(fanOf('清一色') === 4, '清一色 = 4 番(来自 FAN_DEFS)', String(fanOf('清一色')));
check(fanOf('混一色') === 2, '混一色 = 2 番(来自 FAN_DEFS)', String(fanOf('混一色')));
check(fanOf('对对胡') === 2 && fanOf('七对') === 2, '对对胡 / 七对 = 2 番');
check(fanOf('门清') === 1 && fanOf('立直') === 1, '门清 / 立直 = 1 番');

console.log('\n=== 2. 牌型识别 ===');
{
    // 清一色: 13 张万, 一张杂牌都没有
    const pure = mk(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm1', 'm2', 'm3', 'm5']);
    const vPure = estimateHandValue(pure, [], false);
    check(vPure.tag === '清一色方向', '13 张同花色 → 清一色方向', vPure.tag);
    check(vPure.fan === fanOf('清一色') + fanOf('门清'), `番数 = 清一色 4 + 门清 1 = ${vPure.fan}`, String(vPure.fan));
    const vPureRiichi = estimateHandValue(pure, [], true);
    check(vPureRiichi.fan === vPure.fan + fanOf('立直'), '宣告立直再 +1 番');

    // 还差一张的清一色(1 张杂牌)也要认出来 —— 严格"已经全部同花色"等于没帮上忙
    const nearly = mk(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm1', 'm2', 'm3', 'p7']);
    check(estimateHandValue(nearly, [], false).tag === '清一色方向', '12 万 + 1 筒 → 仍算清一色方向');

    // 混一色: 一种数牌 + 字牌
    const half = mk(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm1', 'm2', 'f1', 'f1']);
    check(estimateHandValue(half, [], false).tag === '混一色方向', '一色 + 字牌 → 混一色方向');

    // 三种花色都有 → 没有花色番
    const messy = mk(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 's1', 's2', 's3', 'p1', 'p2', 'p3', 'f1']);
    const vMessy = estimateHandValue(messy, [], false);
    check(vMessy.tag === '' && vMessy.fan === fanOf('门清'), '三色杂牌 → 只有门清 1 番', `${vMessy.tag}/${vMessy.fan}`);

    // 七对: 6 个对子 + 1 张
    const pairs = mk(['m1', 'm1', 'm3', 'm3', 'm5', 'm5', 's2', 's2', 's7', 's7', 'p4', 'p4', 'f2']);
    check(estimateHandValue(pairs, [], false).tag === '七对方向', '6 对 → 七对方向');

    // 对对胡: 4 刻 + 1 单
    const triplets = mk(['m1', 'm1', 'm1', 'm5', 'm5', 'm5', 's3', 's3', 's3', 'p7', 'p7', 'p7', 'f1']);
    check(estimateHandValue(triplets, [], false).tag === '对对胡方向', '4 刻 → 对对胡方向');
}

console.log('\n=== 3. 价值倍率(只放大不缩小) ===');
{
    const messy = mk(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 's1', 's2', 's3', 'p1', 'p2', 'p3', 'f1']);
    const pure = mk(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm1', 'm2', 'm3', 'm5']);
    const vPlain = estimateHandValue(messy, [], false);
    const vPure = estimateHandValue(pure, [], true);
    check(vPlain.multiplier >= 1, '平价手的倍率下限是 1(改造前的权重原样保留)', String(vPlain.multiplier));
    check(vPure.multiplier > vPlain.multiplier, '清一色手倍率更高', `${vPure.multiplier} vs ${vPlain.multiplier}`);
    check(vPure.multiplier <= 4, '倍率上限 4', String(vPure.multiplier));
}

console.log('\n=== 4. 潜力番要按距离打折 ===');
{
    const pure = mk(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm1', 'm2', 'm3', 'm5']);
    const atTenpai = estimateHandValue(pure, [], true, Shanten.TENPAI);
    const at2 = estimateHandValue(pure, [], true, 2);
    check(atTenpai.points > at2.points,
        '同一手牌, 向听越远"期望点数"越低(不打折会让 AI 一路降速做牌)',
        `${atTenpai.points} vs ${at2.points}`);
}

console.log('\n=== 5. 听牌保护: 不许为了躲危险牌拆听 ===');
{
    // 4 面子 + 单钓东 = 听牌; 摸到 5 条(没用), 而 5 条被判定"很危险"
    const hand14 = mk([
        'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9',   // 三组顺子
        'p1', 'p1', 'p1',                                        // 一组刻子
        'f1',                                                    // 单钓东
        's5',                                                    // 刚摸到的废牌
    ]);
    check(Shanten.calc(hand14.slice(0, 13), 0) === Shanten.TENPAI, '构造成立: 打掉 s5 就是听牌');
    // 三家对手都在打幺九 → AIDefense 会把中张判成"断幺: 中张危险"
    const threats: ThreatInfo[] = [0, 1, 2].map(() => ({
        discards: mk(['m1', 'm9', 's1', 's9', 'p1', 'p9', 'f1', 'f2']),
        melds: [],
        declaredTenpai: false,
    }));
    const ctx = ctxOf(hand14, { threats });
    const ranked = AIBrain.rankDiscards(ctx);
    const dangerous = ranked.filter(e => e.tile.displayText === '五條')[0];
    check(!!dangerous && dangerous.danger >= 45,
        '前提: 刚摸的 5 条确实被判成危险牌', dangerous ? String(dangerous.danger) : 'n/a');
    const best = ranked[0];
    const rest = hand14.filter((_, i) => i !== best.index);
    check(HuChecker.isTenpai(rest, []).length > 0,
        `首选打 ${best.tile.displayText} 之后仍然听牌`,
        `shanten=${Shanten.calc(rest, 0)}`);
    const hint = HintAdvisor.discard(ctx);
    const hintRest = hand14.filter((_, i) => i !== hint.best!.index);
    check(HuChecker.isTenpai(hintRest, []).length > 0, '提示给的首选同样保持听牌');
}

console.log('\n=== 6. 死听例外: 听的牌全没了才允许换听 ===');
{
    const hand14 = mk([
        'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9',
        'p1', 'p1', 'p1', 'f1', 's5',
    ]);
    const visible = emptyVisible(hand14);
    // 东 与 5 条 各 4 张全在场上 → 无论打哪张, 单钓的那个都是死听(进张 0 张)
    visible[tileIndexOf(TileSuit.FENG, 1)] = 4;
    visible[tileIndexOf(TileSuit.TIAO, 5)] = 4;
    const ranked = AIBrain.rankDiscards(ctxOf(hand14, { visible }));
    const keep = ranked.filter(e => e.shanten === Shanten.TENPAI && e.ukeire > 0);
    check(keep.length === 0, '前提: 该局面没有"活着的听牌"候选');
    check(ranked.length === hand14.length, '死听时不做听牌保护(候选没有被裁掉)', `${ranked.length}/${hand14.length}`);
}

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
process.exit(fails === 0 ? 0 : 1);
