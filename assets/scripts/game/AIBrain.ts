import { Tile } from '../core/Tile';
import { Meld } from '../core/Meld';
import { MeldCandidate } from '../core/MeldDetector';
import { HuChecker } from '../core/HuChecker';

/**
 * AI 大脑 - 纯逻辑,不依赖引擎
 *
 * 职责:
 *  - chooseDiscard(hand): 决定打出哪一张(返回手牌索引)
 *  - chooseMeld(candidates, hand): 决定是否副露及选哪个候选
 *
 * 出牌策略(启发式评分,保留价值最低的牌打出):
 *  - 刻子(同张>=3)价值最高,优先保留
 *  - 对子(同张==2)价值次高
 *  - 数牌有相邻牌可构成顺子(搭子)价值较高
 *  - 字牌单张、数牌边张(1/9)孤立价值最低,优先打出
 *
 * 副露策略(简化,原型演示):
 *  - 杠: 总是接受
 *  - 碰: 总是接受
 *  - 吃: 接受第一个候选
 */
export class AIBrain {
    /**
     * 选择要打出的牌的索引
     * @param hand 手牌(无需排序)
     */
    static chooseDiscard(hand: Tile[]): number {
        if (hand.length === 0) return -1;
        if (hand.length === 1) return 0;

        // 统计每种牌的出现次数
        const counts = new Map<string, number>();
        for (const t of hand) {
            const k = AIBrain._key(t);
            counts.set(k, (counts.get(k) || 0) + 1);
        }

        // 评估每张牌的保留价值,选最低者打出
        let bestIdx = 0;
        let bestScore = Infinity;
        for (let i = 0; i < hand.length; i++) {
            const score = AIBrain._evalKeepValue(hand[i], counts);
            if (score < bestScore) {
                bestScore = score;
                bestIdx = i;
            }
        }
        return bestIdx;
    }

    /**
     * 评估单张牌的"保留价值"
     * 分数越低 → 越该打出
     */
    private static _evalKeepValue(t: Tile, counts: Map<string, number>): number {
        const c = counts.get(AIBrain._key(t)) || 1;
        let score = 0;

        // 对子/刻子价值
        if (c >= 3) score += 30;       // 刻子
        else if (c === 2) score += 15; // 对子

        if (t.isNumberTile) {
            // 数牌: 检查相邻牌构成顺子搭子的潜力
            const hasPrev1 = counts.has(AIBrain._keyOf(t.suit, t.rank - 1));
            const hasPrev2 = counts.has(AIBrain._keyOf(t.suit, t.rank - 2));
            const hasNext1 = counts.has(AIBrain._keyOf(t.suit, t.rank + 1));
            const hasNext2 = counts.has(AIBrain._keyOf(t.suit, t.rank + 2));
            if (hasPrev1) score += 8;
            if (hasPrev2) score += 4;
            if (hasNext1) score += 8;
            if (hasNext2) score += 4;
            // 边张孤立惩罚: 1/9 且无对子
            if (c === 1 && (t.rank === 1 || t.rank === 9)) score -= 3;
        } else {
            // 字牌单张价值最低(0分),比对子略低
            if (c === 1) score -= 1;
        }
        return score;
    }

    private static _key(t: Tile): string {
        return AIBrain._keyOf(t.suit, t.rank);
    }

    private static _keyOf(suit: number, rank: number): string {
        return `${suit}-${rank}`;
    }

    /**
     * 已宣告听牌(立直)后的出牌: 只打"打完仍然听牌"的牌
     *
     * 先按常规启发式选一张, 若它会破坏听牌再退回寻找安全牌。
     * 注意刚摸到的那张牌永远可以安全打出(打掉它就回到摸牌前的听牌手牌),
     * 所以本方法一定找得到合法牌。
     */
    static chooseDiscardTenpaiSafe(hand: Tile[], melds: Meld[]): number {
        const fallback = AIBrain.chooseDiscard(hand);
        if (AIBrain._keepsTenpai(hand, fallback, melds)) return fallback;
        for (let i = 0; i < hand.length; i++) {
            if (AIBrain._keepsTenpai(hand, i, melds)) return i;
        }
        return fallback;
    }

    /** 打出第 index 张后是否仍处于听牌状态 */
    private static _keepsTenpai(hand: Tile[], index: number, melds: Meld[]): boolean {
        if (index < 0 || index >= hand.length) return false;
        const rest = hand.filter((_, i) => i !== index);
        return HuChecker.isTenpai(rest, melds).length > 0;
    }

    // ==================== 副露决策 ====================
    /**
     * 选择副露候选(简化策略: 杠>碰>吃,原型演示用)
     * @param candidates 所有可行副露候选
     * @returns 选中的候选,或 null(放弃副露)
     */
    static chooseMeld(candidates: MeldCandidate[]): MeldCandidate | null {
        if (candidates.length === 0) return null;
        const kan = candidates.find(c => c.type === 'kan');
        if (kan) return kan;
        const pon = candidates.find(c => c.type === 'pon');
        if (pon) return pon;
        return candidates.find(c => c.type === 'chi') ?? null;
    }
}
