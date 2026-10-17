import { Tile } from '../core/Tile';
import { Meld } from '../core/Meld';
import { TILE_TYPE_COUNT, TileSuit, tileIndexOf } from '../core/TileDefine';

/**
 * 手牌打点(和了值)估计 —— 纯逻辑, 零引擎依赖
 *
 * 【为什么需要它】本作的得分是 `points = 2^番`(封顶 8 番, 见 HuScore.MAX_FAN):
 * 清一色(4 番)= 16 分, 加上门清/立直就是 64 分 —— 一手顶 16 手平胡。
 * 而 AI 原先**完全不看番**(AIBrain 不 import HuScore), 只会做"最快"的牌,
 * 于是永远在打 1~2 番的便宜牌(2026-10-17 实测: 800 局平均 5.6 分)。
 *
 * 【为什么是"潜力"而不是精确番数】13 张手牌还没成型, 不存在确定的番数。
 * 这里的口径刻意**保守**: 只认"已经基本成型"的牌型(占比 ≥ 85%),
 * 不去赌"再摸 4 张就能清一色" —— 那会让 AI 到处硬做牌。
 *
 * 【与 HuScore 的关系】番值一律与 `FAN_DEFS` 对齐(清一色 4 / 混一色 2 / 对对胡 2 /
 * 七对 2 / 门清 1 / 立直 1), 但这里**只估不判**;真正结算仍走 HuScore。
 * 数值一旦分叉, 就会出现"AI 以为值 4 番、实际只算 2 番"的骗人情况 ——
 * 测试 `hand-value-test.ts` 会逐条核对这张表。
 */

/** 牌型占比达到这个值才算"已经在做这个牌型"(对对胡) */
const NEAR_RATIO = 0.85;
/** 允许还差几张就能清/混一色: 13~14 张里最多 2 张杂牌 */
const NEAR_FOREIGN = 2;
/** 门清(未吃碰)的番数, 与 HuScore 的「门清」一致 */
const FAN_MENZEN = 1;
/** 立直(宣告听牌)的番数, 与 HuScore 的「立直」一致 */
const FAN_RIICHI = 1;

export interface HandValue {
    /** 估计番数(含门清/立直这类已经确定的部分;不含自摸/连庄等随机项) */
    fan: number;
    /** 和了点数 = 2^fan, 与 HuScore 的 `points` 同口径 */
    points: number;
    /**
     * 主要牌型倾向, 用于提示文案(如 "清一色方向"); 没有明显倾向时为空串。
     * 只列牌型番, 不列门清/立直 —— 那两个是状态, 由调用方另行说明。
     */
    tag: string;
    /** 价值倍率 = max(1, points / 4), 上限 4: 1.0 = 常见的两番手(平价手不缩小) */
    multiplier: number;
}

/**
 * 估计一手牌的番数潜力
 *
 * @param hand 手牌(通常是"打出某张之后"的 13 张)
 * @param melds 已有副露
 * @param declaredTenpai 是否已宣告听牌(立直)
 * @param shanten 当前向听数(0=听牌): 只用来给"潜力牌型"打折扣
 */
export function estimateHandValue(
    hand: Tile[],
    melds: Meld[],
    declaredTenpai: boolean,
    shanten = 0,
): HandValue {
    const counts = new Int8Array(TILE_TYPE_COUNT);
    for (const t of hand) counts[tileIndexOf(t.suit, t.rank)]++;

    let total = hand.length;
    let honors = 0;
    const suitCount = [0, 0, 0];
    for (let i = 0; i < TILE_TYPE_COUNT; i++) {
        if (counts[i] === 0) continue;
        if (i < 27) suitCount[Math.floor(i / 9)] += counts[i];
        else honors += counts[i];
    }
    // 副露的牌同样计入占比: 碰出来的清一色也是清一色
    let chiCount = 0;
    for (const m of melds) {
        for (const t of m.tiles) {
            total++;
            if (!t.isNumberTile) honors++;
            else suitCount[t.suit as number]++;
        }
        if (m.type === 'chi') chiCount++;
    }
    if (total === 0) return { fan: 0, points: 1, tag: '', multiplier: 1 };

    // ---- 花色番: 按"主导花色"算, 允许还差一两张(打出那些杂牌就是清/混一色) ----
    // 【别要求"已经全部同花色"】那样只有牌型已经成型时才认得出价值, 等于没帮上忙:
    // 13 张里有 12 张万 + 1 张筒, 严格判断会得出"两种花色 → 没有番"。
    let domSuit = 0;
    for (let s = 1; s < 3; s++) if (suitCount[s] > suitCount[domSuit]) domSuit = s;
    const domCount = suitCount[domSuit];
    /** 不在主导花色里的**数牌**张数(字牌另算): 打掉它们就是清/混一色 */
    const foreignNumbers = total - domCount - honors;
    let flushFan = 0;
    let tag = '';
    if (foreignNumbers <= NEAR_FOREIGN && (total - honors) >= total * 0.5) {
        if (honors === 0) {
            flushFan = 4;
            tag = '清一色方向';
        } else {
            flushFan = 2;
            tag = '混一色方向';
        }
    }

    // ---- 牌型番: 对对胡 / 七对 ----
    let handTriplets = 0;
    let handPairs = 0;
    for (let i = 0; i < TILE_TYPE_COUNT; i++) {
        if (counts[i] >= 3) handTriplets++;
        else if (counts[i] === 2) handPairs++;
    }
    let meldTriplets = 0;
    for (const m of melds) if (m.type !== 'chi') meldTriplets++;
    const tripletSets = handTriplets + meldTriplets;
    const grouped = tripletSets * 3 + handPairs * 2;
    // 对对胡: 不能有吃(吃出来的顺子破坏刻子结构), 且"已成组"的张数要够。
    // 要求至少 2 个**刻子**: 光有一堆对子那是在做七对, 不是对对胡。
    const allTriplets = chiCount === 0;
    let patternFan = 0;
    let patternTag = '';
    if (allTriplets && tripletSets >= 2 && tripletSets + handPairs >= 4 && grouped >= total * NEAR_RATIO) {
        patternFan = 2;
        patternTag = '对对胡方向';
    }
    // 七对: 必须门清(副露后不可能); 6 对已经是 1 向听, 优先于对对胡
    if (melds.length === 0 && handPairs >= 6) {
        patternFan = 2;
        patternTag = '七对方向';
    }

    // ---- 状态番 vs 潜力番 ----
    // 门清/立直是**已经确定**的; 清一色/七对这些只是"潜力", 离和牌越远越可能来不及成型。
    // 【必须打折, 否则会一直追空头】实测: 不打折时 1 向听的混一色(8 分)会压过
    // 听牌的平胡(4 分), AI 于是整局在做牌、谁都和不了 —— 流局率从 6% 炒到 58%。
    const statusFan = (melds.length === 0 ? FAN_MENZEN : 0) + (declaredTenpai ? FAN_RIICHI : 0);
    const potentialFan = flushFan + patternFan;
    const cert = PATTERN_CERTAINTY[Math.max(0, Math.min(shanten, PATTERN_CERTAINTY.length - 1))];
    // 期望点数 = 确定番 × (1 + (潜力番带来的倍数 − 1) × 成型把握)
    const points = Math.pow(2, statusFan) * (1 + (Math.pow(2, potentialFan) - 1) * cert);

    return {
        fan: statusFan + potentialFan,
        points,
        // 牌型番优先展示花色番(视觉上更直观), 两个都命中时花色番更大
        tag: flushFan >= patternFan ? tag : patternTag,
        multiplier: clampMultiplier(points / 4),
    };
}

/**
 * 潜力牌型的"成型把握": 按向听数打折
 * 下标 = 向听数; 听牌 = 1(已经成型), 1 向听 0.7, 2 向听只剩 0.25 ——
 * 这正是"值不值得为清一色多走两步"的那个价码。
 */
const PATTERN_CERTAINTY = [1, 0.7, 0.25, 0.1, 0.05, 0.02];

/** 价值倍率: 以"两番手"(4 分)为 1.0, 夹在 [1, 4] —— **只放大, 不缩小**
 *
 * 下限取 1 而不是 0.5: 平价手(平胡/门清)沿用改造前那套调好的权重,
 * 打点感知只对"已经开始成型的大牌"生效, 避免整体量纲偏移把原有平衡推翻。
 */
function clampMultiplier(v: number): number {
    if (v < 1) return 1;
    if (v > 4) return 4;
    return v;
}
