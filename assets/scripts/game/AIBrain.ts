import { Tile } from '../core/Tile';
import { Meld } from '../core/Meld';
import { MeldCandidate } from '../core/MeldDetector';
import { HuChecker } from '../core/HuChecker';
import { Shanten } from '../core/Shanten';
import { AIDefense, ThreatInfo } from '../core/AIDefense';
import { TILE_TYPE_COUNT, TileSuit, tileIndexOf } from '../core/TileDefine';

/**
 * AI 难度档位 —— 由 GameRules.aiDelay(思考延时)换算
 *
 * 三个档位的**策略**不同, 不只是快慢不同:
 *  - reckless(快): 只看牌效, 完全不防守, 副露全收, 带随机噪声 → 好抓
 *  - balanced(常规): 牌效为主 + 轻度防守 + 保守副露
 *  - expert(慢): 牌效 + 强防守 + 门清/断幺/清一色意图 + 精细副露
 *
 * 把"速度"和"难度"绑在一起: 玩家选"快"就是想被虐得痛快, 让快档用笨策略反而没意思;
 * 而"慢"档多花时间思考是值得的, 所以策略强度必须跟着思考时间一起变。
 */
export type AIDifficulty = 'reckless' | 'balanced' | 'expert';

/** 一次决策所需的全部上下文 */
export interface AIContext {
    /** 手牌 */
    hand: Tile[];
    /** 自己的副露 */
    melds: Meld[];
    /** 是否已宣告听牌(立直): 为真时必须保持听牌, 且不能再副露 */
    declaredTenpai: boolean;
    /** 全场可见张数(自己手牌 + 所有副露 + 所有弃牌), 用于死牌与牌张计数 */
    visible: Int8Array;
    /** 其他各家的公开信息 */
    threats: ThreatInfo[];
    /** 剩余牌墙张数(越少越该求稳) */
    wallRemaining: number;
    /** 难度 */
    difficulty: AIDifficulty;
}

/** 各难度的具体参数 */
interface Profile {
    /**
     * 是否用向听数+进张做牌效评估
     * false = 退回原型版的"保留价值"启发式(刻子/对子/搭子加分),
     * 这才是真正的"莽"档 —— 它不会算向听, 也不会看进张, 好抓。
     */
    useEfficiency: boolean;
    /** 防守权重: 危险度打满(100)时相当于愿意放弃多少牌效分数 */
    defenseWeight: number;
    /** 副露倾向 0~1: 越高越爱亮牌 */
    meldAggression: number;
    /** 是否为门清(+1 番)与立直(+1 番)克制副露 */
    keepsMenzen: boolean;
    /** 是否走断幺路线(留幺九、避字牌) */
    prefersTanyao: boolean;
    /** 随机噪声幅度(0 = 完全确定) */
    noise: number;
    /** 副露时是否检查"会不会拆坏牌型/意图" */
    smartMeld: boolean;
}

const PROFILES: Record<AIDifficulty, Profile> = {
    // 快档: 莽。原版启发式 + 见牌就副露 + 噪声, 完全不算向听也不防守。
    // noise 要相对 SHANTEN_STEP(100) 足够大才有"手抖"感, 但又不能大到乱打。
    reckless: {
        useEfficiency: false,
        defenseWeight: 0,
        meldAggression: 1,
        keepsMenzen: false,
        prefersTanyao: false,
        noise: 45,
        smartMeld: false,
    },
    // 常规档: 算向听与进张, 轻度防守, 副露前会看一眼牌型
    balanced: {
        useEfficiency: true,
        defenseWeight: 0.4,
        meldAggression: 0.6,
        keepsMenzen: true,
        prefersTanyao: false,
        noise: 2,
        smartMeld: true,
    },
    // 慢档: 全力算牌效与进张, 强防守, 保门清与清一色意图
    // 注意 prefersTanyao 保持 false: 本项目 HuScore 里**断幺没有番**,
    // 刻意保留幺九只会白白打乱牌型、拖慢速度, 没有任何收益。
    // (但 AIDefense 里"对手在做断幺"的**读牌**仍然有价值, 那是防守用的)
    expert: {
        useEfficiency: true,
        defenseWeight: 0.9,
        meldAggression: 0.4,
        keepsMenzen: true,
        prefersTanyao: false,
        noise: 0,
        smartMeld: true,
    },
};

/** 出牌时向听数每改善 1 档的分数(防守惩罚以它为尺度) */
const SHANTEN_STEP = 100;

/**
 * 单张出牌候选的评估明细
 *
 * 【为什么要把明细暴露出来】玩家的"提示"功能必须与 AI 真实的选择**同源**:
 * 提示说"打这张"而 AI 实际会打另一张, 提示就是骗人的。
 * 所以 `chooseDiscard` 与提示功能都调用同一个评估函数, 这里只是把
 * 内部本来就要算的中间量(向听/进张/危险度)一并返回, 供提示组织文案。
 */
export interface DiscardEval {
    /** 手牌下标 */
    index: number;
    /** 要打出的那张牌 */
    tile: Tile;
    /** 综合评分(越高越该打) */
    score: number;
    /** 打出之后的向听数(-1=已和牌, 0=听牌) */
    shanten: number;
    /**
     * 打出之后的有效进张**种类数**(不进 fast 档时为 0)
     *
     * 评分用的就是这个口径(见 `_scoreDiscard` 的 `ukeire` 项):
     * 权重 `×10` / `sqrt(×12)` 是按种类数的量级调的, 换成张数会连带改变
     * "牌效 vs 防守"的平衡, 需要重新调参 —— 实测(交换座位 A/B)换口径并无胜率收益,
     * 所以评分保持原样。
     */
    ukeire: number;
    /**
     * 打出之后的有效进张**实际剩余张数** = Σ(4 - 可见张数)
     *
     * 只用于**显示**(提示里"N 张进张"玩家理解的就是这个数)。
     * 与 `ukeire`(种类数)分开两个字段, 就是为了避免"拿种类数当张数讲给玩家听"。
     */
    ukeireTiles: number;
    /** 该牌当前的被点炮危险度 0~100 */
    danger: number;
}

/** 单个副露候选的评估明细(与 `DiscardEval` 同理: 提示与 AI 同源) */
export interface MeldEval {
    /** 在传入候选数组中的下标 */
    index: number;
    /** 候选本身 */
    candidate: MeldCandidate;
    /** 综合评分(必须 > 0 才值得副露) */
    score: number;
    /** 副露并出牌后相对副露前的向听变化(正数=变慢) */
    delta: number;
    /** 副露会让门清(+1番/立直资格)损失的权重(0=不受影响) */
    menzenCost: number;
}

export class AIBrain {
    /**
     * 选择要打出的牌的索引
     * @param ctx 决策上下文
     * @returns 手牌索引;空手牌返回 -1
     */
    static chooseDiscard(ctx: AIContext): number {
        const ranked = AIBrain.rankDiscards(ctx);
        return ranked.length > 0 ? ranked[0].index : -1;
    }

    /**
     * 评估全部出牌候选, 按"最该打"排序(分数降序, 同分按手牌从左到右)
     *
     * 提示功能与 `chooseDiscard` 共用本方法 —— 两者的判断依据必须是同一套,
     * 否则"提示建议的牌"和"AI 真会打的牌"会对不上, 提示就失去了意义。
     */
    static rankDiscards(ctx: AIContext): DiscardEval[] {
        const hand = ctx.hand;
        if (hand.length === 0) return [];

        const profile = PROFILES[ctx.difficulty];
        const meldCount = ctx.melds.length;
        const danger = AIBrain._mergeThreats(ctx);

        const list: DiscardEval[] = [];
        for (let i = 0; i < hand.length; i++) {
            const tile = hand[i];
            const rest: Tile[] = [];
            for (let k = 0; k < hand.length; k++) if (k !== i) rest.push(hand[k]);
            const e = AIBrain._scoreDiscard(ctx, profile, rest, tile, danger, meldCount);
            e.index = i;
            e.tile = tile;
            list.push(e);
        }
        list.sort((a, b) => (b.score - a.score) || (a.index - b.index));

        // 立直锁: 宣告听牌后只能打"打完仍然听牌"的牌。
        // 已在分数序上, 于是**首个保听牌的就是答案**, 通常一次 isTenpai 就够
        // (原先是无条件逐张试, 这里顺带快了)。
        if (!ctx.declaredTenpai) return list;
        const legal = list.filter(e => HuChecker.isTenpai(
            hand.filter((_, k) => k !== e.index), ctx.melds).length > 0);
        // 理论上一个合法候选都没有(不该发生: 刚摸到的那张永远打得出去)。
        // 兜底成"自由评估", 保证调用方拿到的下标一定可打出, 与旧行为一致。
        return legal.length > 0 ? legal : list;
    }

    /**
     * 单张牌的出牌评分(越高越该打)
     * @param rest 打出这张之后的手牌(13 张待摸形状, 各候选同口径, 可直接横向比较)
     */
    private static _scoreDiscard(
        ctx: AIContext,
        profile: Profile,
        rest: Tile[],
        tile: Tile,
        danger: Int8Array,
        meldCount: number,
    ): DiscardEval {
        // ---- 牌效 ----
        // 两套口径: 快档退回原型版"保留价值"启发式, 另外两档才算向听与进张。
        // 分数尺度不同没关系, 因为每档只在自己的档位内部横向比较。
        let score: number;
        // 打出后的向听数, 防守与细分都要用, 算一次就够
        let shantenAfter = 0;
        let ukeire = 0;
        let ukeireTiles = 0;
        if (profile.useEfficiency) {
            // 注意所有候选的 rest 都是 13 张, 口径一致可直接比较;
            // 不能拿"打出后的 13 张"去减"现在的 14 张", 两者公式口径不同(14 张多算一张)。
            shantenAfter = Shanten.calc(rest, meldCount);
            score = -shantenAfter * SHANTEN_STEP;
            const incoming = Shanten.ukeire(rest, meldCount, ctx.visible);
            ukeire = incoming.length;
            // 顺带算出"实际还剩几张"(只用于显示), 免得提示把种类数当张数说给玩家
            for (const t of incoming) {
                ukeireTiles += Math.max(0, 4 - ctx.visible[tileIndexOf(t.suit, t.rank)]);
            }
            if (shantenAfter === Shanten.TENPAI) {
                // 已听牌: 进张数 = 有多少张能胡, 线性计分
                score += ukeire * 10;
            } else {
                // 未听牌: 进张越多越好但收益递减(4 张与 8 张差别没那么大)
                score += Math.sqrt(ukeire) * 12;
            }
        } else {
            // 原型启发式: 分值越大越该留, 所以取负号当"越该打"用
            score = -AIBrain._legacyKeepValue(rest, tile) * SHANTEN_STEP / 40;
        }

        // ---- 防守 ----
        const tileDanger = danger[tileIndexOf(tile.suit, tile.rank)];
        if (profile.defenseWeight > 0) {
            score -= tileDanger * profile.defenseWeight;
            // 牌墙快见底时再加权一次(自己已听牌则不必怕)
            if (!profile.useEfficiency) shantenAfter = Shanten.calc(rest, meldCount);
            if (ctx.wallRemaining < 30 && shantenAfter > Shanten.TENPAI) {
                score -= tileDanger * profile.defenseWeight * 0.4;
            }
        }

        // ---- 同分细分: 这张牌留着有多可惜 ----
        score += AIBrain._keepValue(profile, rest, tile);

        // ---- 随机噪声(快档更"莽") ----
        if (profile.noise > 0) score += (Math.random() - 0.5) * profile.noise * 2;

        return { index: -1, tile, score, shanten: shantenAfter, ukeire, ukeireTiles, danger: tileDanger };
    }

    /**
     * 原型版"保留价值"启发式(快档专用)
     *
     * 这是升级前的原始算法: 刻子 30 分 / 对子 15 分 / 搭子 8 分, 不算向听也不看进张。
     * 保留它是有意的 —— 快档 AI 必须真的"笨"才有存在意义,
     * 否则三个档位只是同一套算法调了几个权重, 玩家感觉不到差别。
     *
     * @param rest 打出这张之后的手牌(用来数同牌与相邻牌)
     * @param tile 要打出的那张
     * @returns 保留价值, 越大越不该打
     */
    private static _legacyKeepValue(rest: Tile[], tile: Tile): number {
        const key = tileIndexOf(tile.suit, tile.rank);
        let sameCount = 0;
        for (const t of rest) if (tileIndexOf(t.suit, t.rank) === key) sameCount++;
        let value = 0;
        if (sameCount >= 2) value += 30;       // 刻子
        else if (sameCount === 1) value += 15; // 对子

        if (tile.isNumberTile) {
            let prev1 = false; let prev2 = false; let next1 = false; let next2 = false;
            for (const t of rest) {
                if (!t.isNumberTile || t.suit !== tile.suit) continue;
                const d = t.rank - tile.rank;
                if (d === -1) prev1 = true;
                else if (d === -2) prev2 = true;
                else if (d === 1) next1 = true;
                else if (d === 2) next2 = true;
            }
            if (prev1) value += 8;
            if (prev2) value += 4;
            if (next1) value += 8;
            if (next2) value += 4;
            // 边张孤立惩罚
            if (sameCount === 0 && (tile.rank === 1 || tile.rank === 9)) value -= 3;
        } else if (sameCount === 0) {
            value -= 1;    // 字牌单张价值最低
        }
        return value;
    }

    /**
     * "留着"的价值: 打出这张后失去的东西
     * 只在牌效与防守都同分时起作用, 权重刻意压得比 SHANTEN_STEP 小一个数量级
     */
    private static _keepValue(profile: Profile, rest: Tile[], tile: Tile): number {
        const key = tileIndexOf(tile.suit, tile.rank);
        let sameCount = 0;
        let neighbors = 0;
        for (const t of rest) {
            if (tileIndexOf(t.suit, t.rank) === key) { sameCount++; continue; }
            if (tile.isNumberTile && t.isNumberTile && t.suit === tile.suit) {
                const d = Math.abs(t.rank - tile.rank);
                // 差 1 是顺子搭子, 差 2 是嵌张搭子, 价值依次递减
                if (d === 1) neighbors += 3;
                else if (d === 2) neighbors += 1;
            }
        }
        let value = 0;
        // 手牌还剩同牌 → 对子/刻子, 拆了可惜
        if (sameCount === 1) value += 6;
        else if (sameCount >= 2) value += 12;
        value += Math.min(8, neighbors);
        /**
         * 孤张字牌加权(方向别搞反)
         *
         * score 的含义是"越高越该打", 所以这里给孤张字牌**加分**而不是扣分。
         * (之前一度写成 `value -= 4`, 结果孤张字牌分数变低、反而更不容易被打 ——
         *  符号一错就完全反作用, 这类改动必须用 A/B 数字验, 不能凭直觉。)
         *
         * 为什么加: 理牌后字牌恒排在手牌末尾, 而**同分时的决胜项是手牌下标**
         * (见 `rankDiscards` 的 sort), 于是孤张字牌永远输给前面任意一张数牌。
         * 而字牌不能组顺子, 孤张时要凑成对子得等 3 张, 概率极低 ——
         * 它客观上就是最该先打的牌, 应当压过同样"没用"的孤张数牌。
         *
         * +2 的量级: 略高于 keepValue 的最小非零档(邻牌差2 的 +1),
         * 但远低于"有对子"(+6), 于是**成对字牌依然被保留**, 只压过真正的孤张。
         */
        if (sameCount === 0 && !tile.isNumberTile) value += 2;
        // 断幺倾向: 想做断幺就把幺九留下(别打出去送人)
        if (profile.prefersTanyao && tile.isNumberTile && (tile.rank === 1 || tile.rank === 9)) {
            value += 5;
        }
        return value;
    }

    /**
     * 合并各家威胁 → 34 长的危险度数组
     * 只要有任意一家会点炮, 这张牌就算危险, 所以取最大值
     */
    private static _mergeThreats(ctx: AIContext): Int8Array {
        const merged = new Int8Array(TILE_TYPE_COUNT);
        for (const t of ctx.threats) {
            const est = AIDefense.dangerAgainst(t, ctx.visible);
            for (let i = 0; i < TILE_TYPE_COUNT; i++) {
                if (est[i].danger > merged[i]) merged[i] = est[i].danger;
            }
        }
        return merged;
    }

    // ==================== 立直后出牌 ====================
    /**
     * 已宣告听牌后的出牌: 只打"打完仍然听牌"的牌
     *
     * 直接取 `rankDiscards` 的首选 —— 该方法内部已经把破坏听牌的候选剔除了,
     * 所以这里天然满足立直锁。`rankDiscards` 另有兜底, 保证至少返回一个可打的下标。
     */
    static chooseDiscardTenpaiSafe(ctx: AIContext): number {
        return AIBrain.chooseDiscard(ctx);
    }

    // ==================== 副露决策 ====================
    /**
     * 选择副露候选, 或 null(放弃副露)
     * @param ctx 决策上下文
     * @param candidates 所有可行副露候选(检测器已按 杠 > 碰 > 吃 排序)
     * @param sourceTile 触发副露的那张牌(别家打出的)
     */
    static chooseMeld(
        ctx: AIContext,
        candidates: MeldCandidate[],
        sourceTile: Tile,
    ): MeldCandidate | null {
        if (candidates.length === 0) return null;
        const ranked = AIBrain.rankMelds(ctx, candidates, sourceTile);
        // ranked 已按分数降序; 只有正分才副露
        for (const e of ranked) if (e.score > 0) return e.candidate;
        return null;
    }

    /**
     * 评估全部副露候选, 按分数降序(同分保持检测器给出的顺序: 杠 > 碰 > 吃)
     *
     * 与 `chooseMeld` 同源: 提示功能据此说明"该碰"还是"该过", AI 据此真正决定,
     * 两边不会各说各话。
     */
    static rankMelds(ctx: AIContext, candidates: MeldCandidate[], sourceTile: Tile): MeldEval[] {
        if (candidates.length === 0) return [];
        const profile = PROFILES[ctx.difficulty];
        const list: MeldEval[] = [];
        for (let i = 0; i < candidates.length; i++) {
            list.push(AIBrain._scoreMeld(ctx, profile, candidates[i], sourceTile, i));
        }
        list.sort((a, b) => (b.score - a.score) || (a.index - b.index));
        return list;
    }

    /**
     * 单个副露候选的评分(必须 > 0 才副露)
     *
     * 返回完整明细而不是一个裸分数, 供提示功能组织"为什么/为什么不"的文案。
     */
    private static _scoreMeld(
        ctx: AIContext,
        profile: Profile,
        candidate: MeldCandidate,
        sourceTile: Tile,
        index = -1,
    ): MeldEval {
        const meldCount = ctx.melds.length;

        // 基础收益: 杠能多摸一张且可能杠上开花, 吃最不划算
        let score = candidate.type === 'kan' ? 45 : candidate.type === 'pon' ? 30 : 15;

        const evalOut: MeldEval = { index, candidate, score: 0, delta: 0, menzenCost: 0 };

        // 已宣告听牌 → 本来就不该再副露(调用方一般已拦截, 这里兜底)
        if (ctx.declaredTenpai) return { ...evalOut, score: -1 };

        if (!profile.smartMeld) {
            if (profile.noise > 0) score += (Math.random() - 0.5) * profile.noise * 2;
            return { ...evalOut, score };
        }

        // ---- 牌型: 副露会不会让手牌变慢 ----
        // 副露后手牌少 2 张(碰/吃)或 3 张(杠), 且必须马上打出一张
        const rest = ctx.hand.filter(t => !candidate.handTiles.some(h => h === t));
        const before = Shanten.calc(ctx.hand, meldCount);
        const after = this._bestShantenAfterMeld(rest, meldCount + 1);
        const delta = after - before;   // >0 = 变慢
        // 慢一档 ≈ 少赚 SHANTEN_STEP 的牌效, 按比例扣分
        score -= delta * (SHANTEN_STEP * 0.45);
        // 越不激进, 越不能接受变慢
        if (delta > 0) score -= (1 - profile.meldAggression) * 40;

        // ---- 门清价值 ----
        // 副露 = 永久失去 +1 番(门清), 也失去立直的资格 → 手牌越好越舍不得
        let menzenCost = 0;
        if (profile.keepsMenzen && meldCount === 0) {
            menzenCost = before <= Shanten.TENPAI ? 45 : before === 1 ? 28 : 15;
            score -= menzenCost;
        }

        // ---- 牌种意图 ----
        score -= AIBrain._flushPenalty(ctx, sourceTile);
        if (profile.prefersTanyao && !sourceTile.isNumberTile && candidate.type === 'chi') {
            score -= 15;   // 想断幺就别吃字牌
        }

        if (profile.noise > 0) score += (Math.random() - 0.5) * profile.noise * 2;
        return { index, candidate, score, delta, menzenCost };
    }

    /**
     * 副露后"再打出一张"的最佳向听数
     * 副露完必须出牌, 所以要在剩余手牌里枚举"打哪张"取最好的结果
     */
    private static _bestShantenAfterMeld(rest: Tile[], meldCountAfter: number): number {
        if (rest.length <= 1) return Shanten.calc(rest, meldCountAfter);
        let best = 99;
        for (let i = 0; i < rest.length; i++) {
            const s: Tile[] = [];
            for (let k = 0; k < rest.length; k++) if (k !== i) s.push(rest[k]);
            const v = Shanten.calc(s, meldCountAfter);
            if (v < best) best = v;
            // 已经能胡(向听 -1), 不可能更好了
            if (best === Shanten.WIN) break;
        }
        return best;
    }

    /**
     * 副露是否会破坏同花色(清一色/混一色)意图
     * 手牌明显集中在一个花色时, 别把它碰/吃散
     */
    private static _flushPenalty(ctx: AIContext, sourceTile: Tile): number {
        if (!sourceTile.isNumberTile) return 0;
        const counts = [0, 0, 0];
        let total = 0;
        for (const t of ctx.hand) {
            if (!t.isNumberTile) continue;
            counts[t.suit as number]++;
            total++;
        }
        if (total < 8) return 0;
        let domSuit = 0;
        for (let s = 1; s < 3; s++) if (counts[s] > counts[domSuit]) domSuit = s;
        const ratio = counts[domSuit] / total;
        // 80% 以上集中在同一花色 → 有清一色意图, 别把别花色的牌碰进来
        if (ratio >= 0.8 && sourceTile.suit !== domSuit) {
            return 35 * (ratio - 0.8) / 0.2;
        }
        return 0;
    }
}