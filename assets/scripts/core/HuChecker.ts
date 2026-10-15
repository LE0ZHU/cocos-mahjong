import { Tile } from './Tile';
import { TileSuit, MAX_RANK } from './TileDefine';
import { Meld } from './Meld';

/**
 * 胡牌判断 - 纯函数,不依赖引擎
 *
 * 支持三种胡牌牌型:
 *  - 标准牌型: 4 组面子(顺子/刻子) + 1 对将 (3-3-3-3-2)
 *  - 七对子: 7 组不同的对子
 *  - 十三幺: 13 种幺九牌各一 + 任意一张重复
 *
 * 副露支持: isHu 接收 melds 参数,每个副露算1个面子,
 *  手牌只需凑齐 (4 - melds.length) 个面子 + 1 将。
 *  有副露时仅支持标准牌型(七对/十三幺不可副露)。
 *
 * 听牌支持: isTenpai 返回听牌张列表。
 */
export class HuChecker {
    /** 标准胡牌总张数(手牌+副露,不含杠多出的) */
    public static readonly HU_TOTAL = 14;

    /**
     * 判断手牌+副露是否胡牌
     * @param hand 手牌(不含副露)
     * @param melds 副露列表(默认空)
     */
    static isHu(hand: Tile[], melds: Meld[] = []): boolean {
        const meldCount = melds.length;
        // 每个副露(吃/碰/杠)都算 1 面子,手牌只需凑齐剩余面子 + 1 将。
        // 杠虽然占 4 张,但其中多出的那张是补摸来的,手牌张数口径不变:
        //   手牌张数 = (4 - meldCount) * 3 + 2
        const needMelds = 4 - meldCount;
        const needTiles = needMelds * 3 + 2;
        if (hand.length !== needTiles) return false;

        // 有副露只走标准牌型;无副露三种都可
        if (HuChecker._isStandardHu(hand, needMelds)) return true;
        if (meldCount === 0) {
            return HuChecker._isSevenPairs(hand) || HuChecker._isThirteenOrphans(hand);
        }
        return false;
    }

    /**
     * 听牌检测: 枚举所有可能的牌,加入后能否胡
     * @param hand 手牌(应为 13 - 3*melds 张,即听牌状态)
     * @param melds 副露
     * @returns 听牌张列表(空表示未听)
     */
    static isTenpai(hand: Tile[], melds: Meld[] = []): Tile[] {
        const waiting: Tile[] = [];
        const allTiles = HuChecker._allTileTypes();
        for (const proto of allTiles) {
            const testTile = new Tile(-1, proto.suit, proto.rank);
            const testHand = [...hand, testTile];
            if (HuChecker.isHu(testHand, melds)) {
                waiting.push(testTile);
            }
        }
        return waiting;
    }

    /** 生成所有牌型(34种),用于听牌枚举 */
    private static _allTileTypes(): { suit: TileSuit; rank: number }[] {
        const list: { suit: TileSuit; rank: number }[] = [];
        for (const suit of [TileSuit.WAN, TileSuit.TIAO, TileSuit.TONG]) {
            for (let r = 1; r <= MAX_RANK; r++) list.push({ suit, rank: r });
        }
        for (let r = 1; r <= 4; r++) list.push({ suit: TileSuit.FENG, rank: r });
        for (let r = 1; r <= 3; r++) list.push({ suit: TileSuit.JIAN, rank: r });
        return list;
    }

    // ==================== 标准牌型 ====================

    /**
     * 标准牌型: needMelds 个面子 + 1 将
     * 枚举将牌(对子)后递归拆面子
     */
    private static _isStandardHu(hand: Tile[], needMelds: number): boolean {
        const counts = HuChecker._toCounts(hand);
        // 枚举将牌
        for (const key of counts.keys()) {
            const c = counts.get(key)!;
            if (c >= 2) {
                counts.set(key, c - 2);
                if (HuChecker._canFormMelds(counts, needMelds)) {
                    counts.set(key, c);
                    return true;
                }
                counts.set(key, c);
            }
        }
        return false;
    }

    /**
     * 判断能否从剩余牌中拆出 needMelds 个面子
     * 每次取最小牌,它必须属于某个刻子或顺子
     */
    private static _canFormMelds(counts: Map<string, number>, needMelds: number): boolean {
        if (needMelds === 0) {
            // 面子拆完,剩余应为0
            for (const c of counts.values()) if (c > 0) return false;
            return true;
        }
        // 找最小非零牌
        let minKey: string | null = null;
        for (const [key, c] of counts) {
            if (c > 0) { minKey = key; break; }
        }
        if (minKey === null) return false; // 牌已空但面子不够

        const { suit, rank } = HuChecker._parseKey(minKey);
        const c = counts.get(minKey)!;

        // 尝试刻子
        if (c >= 3) {
            counts.set(minKey, c - 3);
            if (HuChecker._canFormMelds(counts, needMelds - 1)) {
                counts.set(minKey, c);
                return true;
            }
            counts.set(minKey, c);
        }

        // 尝试顺子(仅数牌)
        if (HuChecker._isNumberSuit(suit) && rank <= MAX_RANK - 2) {
            const k2 = HuChecker._key(suit, rank + 1);
            const k3 = HuChecker._key(suit, rank + 2);
            const c2 = counts.get(k2) || 0;
            const c3 = counts.get(k3) || 0;
            if (c2 > 0 && c3 > 0) {
                counts.set(minKey, c - 1);
                counts.set(k2, c2 - 1);
                counts.set(k3, c3 - 1);
                if (HuChecker._canFormMelds(counts, needMelds - 1)) {
                    counts.set(minKey, c);
                    counts.set(k2, c2);
                    counts.set(k3, c3);
                    return true;
                }
                counts.set(minKey, c);
                counts.set(k2, c2);
                counts.set(k3, c3);
            }
        }
        return false;
    }

    // ==================== 七对子 ====================

    private static _isSevenPairs(hand: Tile[]): boolean {
        if (hand.length !== 14) return false;
        const counts = HuChecker._toCounts(hand);
        for (const c of counts.values()) {
            if (c % 2 !== 0) return false;
        }
        return counts.size === 7;
    }

    // ==================== 十三幺 ====================

    private static _isThirteenOrphans(hand: Tile[]): boolean {
        if (hand.length !== 14) return false;
        const terminalKeys = new Set<string>();
        for (const suit of [TileSuit.WAN, TileSuit.TIAO, TileSuit.TONG]) {
            terminalKeys.add(HuChecker._key(suit, 1));
            terminalKeys.add(HuChecker._key(suit, MAX_RANK));
        }
        for (let r = 1; r <= 4; r++) terminalKeys.add(HuChecker._key(TileSuit.FENG, r));
        for (let r = 1; r <= 3; r++) terminalKeys.add(HuChecker._key(TileSuit.JIAN, r));

        const counts = HuChecker._toCounts(hand);
        for (const key of counts.keys()) {
            if (!terminalKeys.has(key)) return false;
        }
        let pairCount = 0;
        for (const key of terminalKeys) {
            const c = counts.get(key) || 0;
            if (c === 0) return false;
            if (c === 2) pairCount++;
            else if (c > 2) return false;
        }
        return pairCount === 1;
    }

    // ==================== 工具方法 ====================

    private static _key(suit: TileSuit, rank: number): string {
        return `${suit}-${rank}`;
    }

    private static _parseKey(key: string): { suit: TileSuit; rank: number } {
        const [s, r] = key.split('-');
        return { suit: Number(s) as TileSuit, rank: Number(r) };
    }

    private static _isNumberSuit(suit: TileSuit): boolean {
        return suit === TileSuit.WAN || suit === TileSuit.TIAO || suit === TileSuit.TONG;
    }

    private static _toCounts(hand: Tile[]): Map<string, number> {
        const sorted = [...hand].sort((a, b) => a.sortKey - b.sortKey);
        const counts = new Map<string, number>();
        for (const t of sorted) {
            const key = HuChecker._key(t.suit, t.rank);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return counts;
    }
}
