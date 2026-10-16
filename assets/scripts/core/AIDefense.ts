import { Tile } from './Tile';
import { TILE_TYPE_COUNT, TileSuit, tileIndexOf } from './TileDefine';
import { Meld } from './Meld';

/**
 * 危险牌推断(防守) —— 纯逻辑, 不依赖引擎
 *
 * 输入是"公开信息": 各家已出的牌 + 各家已亮的副露。
 * 输出是 34 种牌型各自的危险度(0=绝对安全, 100=极危险)。
 *
 * 判据从可靠到不可靠依次是:
 *  1. 现物: 该家打过这张牌 → 绝不可能点炮(除非他手上有别的副本, 见"筋"以下)
 *  2. 筋(筋牌): 某家打过 4, 则 1/7 对他安全; 打过 1 则 4 安全。
 *     依据是单钓/两面听的搭子必须包含那张牌。
 *  3. 字牌计数: 一副牌只有 4 张, 场上可见 3 张以上 → 该家几乎不可能再听。
 *  4. 断幺推断: 某家打的全是 1/9/字牌 → 他在做断幺, 中张(2-8)对他危险。
 *  5. 清一色/混一色推断: 某家副露和弃牌都集中在两个花色 → 第三个花色对他危险。
 *
 * 【设计取舍】第 4/5 条是"读牌", 会有猜错的情况, 所以只给部分加分,
 * 并且全部低于现物/筋这类硬判据, 保证 AI 不会因为读错牌就乱打。
 */

/** 一家的公开信息 */
export interface ThreatInfo {
    /** 该家的弃牌(按时间顺序) */
    discards: Tile[];
    /** 该家已亮的副露 */
    melds: Meld[];
    /** 该家是否已宣告听牌(立直) */
    declaredTenpai: boolean;
}

/** 单张牌的威胁评估结果 */
export interface ThreatEstimate {
    /** 0-100, 越大越危险 */
    danger: number;
    /** 人类可读的推断依据(调试/日志用) */
    reason: string;
}

export class AIDefense {
    /**
     * 计算场上 34 种牌型对某一家的危险度
     * @param threat 目标家的公开信息
     * @param visible 全场可见张数(自己手牌+所有副露+所有弃牌), 用于牌张计数判据
     */
    static dangerAgainst(threat: ThreatInfo, visible: Int8Array): ThreatEstimate[] {
        const out: ThreatEstimate[] = [];
        for (let i = 0; i < TILE_TYPE_COUNT; i++) {
            out.push(AIDefense._evalTile(i, threat, visible));
        }
        return out;
    }

    /** 单个牌型的危险度 */
    private static _evalTile(index: number, threat: ThreatInfo, visible: Int8Array): ThreatEstimate {
        const suit = AIDefense._suitOf(index);
        const rank = AIDefense._rankOf(index);
        const isHonor = index >= 27;

        // ---- 判据 1: 现物 ----
        // 该家打过这张牌 → 他手里这张的副本不能再点炮(听牌也不会要自己打过的牌)
        if (threat.discards.some(t => tileIndexOf(t.suit, t.rank) === index)) {
            return { danger: 0, reason: '现物' };
        }

        // ---- 判据 2: 筋 ----
        // 打过 r 则 r-3 / r+3 对他安全(单钓与两面听的搭子必然含 r)
        if (!isHonor) {
            const suji = AIDefense._sujiSafety(threat.discards, suit, rank);
            if (suji >= 2) return { danger: 2, reason: '双筋' };
            if (suji === 1) return { danger: 18, reason: '单筋' };
        } else {
            // 字牌: 打过两张以上基本可以死心
            const seen = threat.discards.filter(t => tileIndexOf(t.suit, t.rank) === index).length;
            if (seen >= 2) return { danger: 3, reason: '字牌多弃' };
        }

        // ---- 判据 3: 全场张数 ----
        // 这张牌场上已可见 3 张 → 只剩 1 张在别人手上/牌河, 除非听单钓否则危险
        if (visible[index] >= 3) return { danger: 10, reason: '已见3张' };

        let danger = 40;
        let reason = '基准';

        // ---- 判据 4: 断幺 ----
        if (AIDefense._isTanyao(threat.discards)) {
            if (isHonor || rank === 1 || rank === 9) {
                danger = 8;
                reason = '断幺:幺九安全';
            } else {
                danger = 78;
                reason = '断幺:中张危险';
            }
        }

        // ---- 判据 5: 清一色/混一色 ----
        const flush = AIDefense._flushThreat(threat.discards, threat.melds, suit, isHonor);
        if (flush > 0) {
            danger += flush;
            reason = flush >= 25 ? '同花色推断:该花色危险' : '同花色推断';
        }

        // ---- 已宣告听牌: 全盘加压 ----
        // 对手亮明听牌后不能副露, 只能孤注一掷等牌, 危险度整体上调
        if (threat.declaredTenpai) {
            danger = Math.min(100, danger + 25);
            reason += '+已听牌';
        }

        return { danger: Math.min(100, Math.max(0, danger)), reason };
    }

    /**
     * 筋安全度: 返回 0/1/2
     * 2 = 双筋(r-3 与 r+3 都打过), 1 = 单筋, 0 = 无
     */
    private static _sujiSafety(discards: Tile[], suit: TileSuit, rank: number): number {
        let count = 0;
        for (const t of discards) {
            if (t.suit !== suit) continue;
            const d = Math.abs(t.rank - rank);
            // 相差 3: 1-4, 4-7, 7-10(不存在); 相差 2: 边张关系更弱, 不算筋
            if (d === 3) count++;
        }
        return count >= 2 ? 2 : count === 1 ? 1 : 0;
    }

    /**
     * 断幺推断: 已弃牌里 1/9/字牌占比很高且张数够多 → 大概率在做断幺
     * 张数要求 ≥5, 否则起手阶段判断不可靠
     */
    private static _isTanyao(discards: Tile[]): boolean {
        if (discards.length < 5) return false;
        let yaochu = 0;
        for (const t of discards) {
            if (!t.isNumberTile || t.rank === 1 || t.rank === 9) yaochu++;
        }
        return yaochu / discards.length >= 0.6;
    }

    /**
     * 同花色推断: 副露和弃牌都偏向某几个花色时, 剩下的花色对他危险
     *
     * 两种信号:
     *  - 副露: 亮出的面子集中在某个花色 → 清一色/混一色基本坐实
     *  - 弃牌: 某个数牌花色一张没打, 而别的花色打了很多 → 他在为这个花色攒牌
     * @returns 危险度加成(0 表示没有明确倾向)
     */
    private static _flushThreat(discards: Tile[], melds: Meld[], suit: TileSuit, isHonor: boolean): number {
        // 信号一: 副露的花色构成。已亮 2 个面子以上方向就很明确了
        if (melds.length >= 2) {
            const meldSuits = new Set<TileSuit>();
            let meldHasHonor = false;
            for (const m of melds) {
                for (const t of m.tiles) {
                    if (t.isNumberTile) meldSuits.add(t.suit);
                    else meldHasHonor = true;
                }
            }
            // 副露占了 2 个数牌花色 → 只剩第三个花色, 对他就是危险牌
            if (meldSuits.size >= 2) {
                const unused = AIDefense._missingSuit(meldSuits);
                if (unused !== null && !isHonor && suit === unused) return 30;
                if (meldHasHonor && isHonor) return 12;
            }
            // 副露全在一个数牌花色 → 另外两个花色他大概不要了
            if (meldSuits.size === 1) {
                const only = meldSuits.values().next().value as TileSuit;
                if (!isHonor && suit !== only) return 12;
                if (isHonor && !meldHasHonor) return 12;
            }
        }

        // 信号二: 弃牌花色缺口
        let suitHits = 0;
        let suitTotal = 0;
        for (const t of discards) {
            if (!t.isNumberTile) continue;
            suitTotal++;
            if (t.suit === suit) suitHits++;
        }
        // 这个花色一张没打, 别的花色打了不少 → 他在为这个花色攒牌
        if (!isHonor && suitTotal >= 6 && suitHits === 0) return 30;
        return 0;
    }

    /** 三个数牌花色里还没被占用的那个 */
    private static _missingSuit(used: Set<TileSuit>): TileSuit | null {
        for (const s of [TileSuit.WAN, TileSuit.TIAO, TileSuit.TONG]) {
            if (!used.has(s)) return s;
        }
        return null;
    }

    private static _suitOf(index: number): TileSuit {
        if (index < 9) return TileSuit.WAN;
        if (index < 18) return TileSuit.TIAO;
        if (index < 27) return TileSuit.TONG;
        if (index < 31) return TileSuit.FENG;
        return TileSuit.JIAN;
    }

    private static _rankOf(index: number): number {
        if (index < 9) return index + 1;
        if (index < 18) return index - 8;
        if (index < 27) return index - 17;
        if (index < 31) return index - 26;
        return index - 30;
    }
}