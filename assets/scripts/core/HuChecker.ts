import { Tile } from './Tile';
import { TileSuit, MAX_RANK } from './TileDefine';
import { Meld } from './Meld';

/** 一个面子(拆解结果里的最小单位) */
export interface HuGroup {
    /** chow=顺子, pung=刻子, kong=杠(只可能来自副露) */
    type: 'chow' | 'pung' | 'kong';
    /** 代表牌: 顺子取最小的一张, 刻子/杠取该张牌 */
    tile: Tile;
}

/** 胡牌牌型的拆解结果(交给番型判定/结算面板使用) */
export interface HuPattern {
    kind: 'standard' | 'sevenPairs' | 'thirteenOrphans';
    /** 标准牌型的 4 个面子(手牌拆出的 + 副露转换而来); 七对/十三幺为空 */
    groups: HuGroup[];
    /** 将牌(标准牌型) */
    pair: Tile | null;
    /** 4 个面子全是刻子/杠(含副露) → 对对胡 */
    allTriplets: boolean;
}

/**
 * 胡牌判断 - 纯函数,不依赖引擎
 *
 * 支持三种胡牌牌型:
 *  - 标准牌型: 4 组面子(顺子/刻子) + 1 对将 (3-3-3-3-2)
 *  - 七对子: 7 组不同的对子
 *  - 十三幺: 13 种幺九牌各一 + 任意一张重复
 *
 * 副露支持: analyze 接收 melds 参数,每个副露算1个面子,
 *  手牌只需凑齐 (4 - melds.length) 个面子 + 1 将。
 *  有副露时仅支持标准牌型(七对/十三幺不可副露)。
 *
 * analyze 在"能不能胡"之外还会给出牌型拆解(哪些顺子/刻子、是否有对对胡),
 * 番型判定(清一色/对对胡/七对/十三幺…)与结算面板都基于这份拆解。
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
        return HuChecker.analyze(hand, melds) !== null;
    }

    /**
     * 拆解胡牌牌型: 能胡则返回拆解结果, 不能胡返回 null
     *
     * 同一种手牌可能有多种拆法(如 11122233344455 既可对对胡也可平胡),
     * 这里统一优先返回"对对胡"拆法, 番数更高。
     */
    static analyze(hand: Tile[], melds: Meld[] = []): HuPattern | null {
        const meldCount = melds.length;
        if (meldCount > 4) return null;
        // 每个副露(吃/碰/杠)都算 1 面子,手牌只需凑齐剩余面子 + 1 将。
        // 杠虽然占 4 张,但其中多出的那张是补摸来的,手牌张数口径不变:
        //   手牌张数 = (4 - meldCount) * 3 + 2
        const needMelds = 4 - meldCount;
        const needTiles = needMelds * 3 + 2;
        if (hand.length !== needTiles) return null;

        const std = HuChecker._bestStandard(hand, needMelds);
        if (std) return HuChecker._attachMelds(std, melds);

        // 副露后不支持七对/十三幺
        if (meldCount > 0) return null;
        if (HuChecker._isThirteenOrphans(hand)) {
            return { kind: 'thirteenOrphans', groups: [], pair: null, allTriplets: false };
        }
        if (HuChecker._isSevenPairs(hand)) {
            return { kind: 'sevenPairs', groups: [], pair: null, allTriplets: false };
        }
        return null;
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
     * 标准牌型拆解: needMelds 个面子 + 1 将
     * 枚举将牌(对子)后递归拆面子, 有多个解时优先返回"全是刻子"的解(对对胡)
     */
    private static _bestStandard(
        hand: Tile[],
        needMelds: number,
    ): { groups: HuGroup[]; pair: Tile } | null {
        const counts = HuChecker._toCounts(hand);
        let first: { groups: HuGroup[]; pair: Tile } | null = null;
        let triplets: { groups: HuGroup[]; pair: Tile } | null = null;

        for (const [key, c] of counts) {
            if (c < 2) continue;
            // 每种将牌候选都在副本上递归, 失败时不污染外层 counts
            const work = new Map(counts);
            work.set(key, c - 2);
            const groups: HuGroup[] = [];
            if (!HuChecker._collectMelds(work, needMelds, groups)) continue;
            const sol: { groups: HuGroup[]; pair: Tile } = {
                groups: groups.slice(),
                pair: HuChecker._proto(key),
            };
            if (!first) first = sol;
            // 空面子(4 副露 + 1 将)也算"全是刻子"
            if (sol.groups.every(g => g.type !== 'chow')) {
                triplets = sol;
                break;
            }
        }
        return triplets ?? first;
    }

    /**
     * 从剩余牌中拆出 needMelds 个面子, 拆出的面子追加到 out
     * 每次取最小牌, 它必然属于某个刻子或顺子
     *
     * 注意: 会就地修改 counts, 因此调用方必须传入副本
     */
    private static _collectMelds(counts: Map<string, number>, needMelds: number, out: HuGroup[]): boolean {
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
            out.push({ type: 'pung', tile: HuChecker._proto(minKey) });
            if (HuChecker._collectMelds(counts, needMelds - 1, out)) return true;
            out.pop();
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
                out.push({ type: 'chow', tile: HuChecker._proto(minKey) });
                if (HuChecker._collectMelds(counts, needMelds - 1, out)) return true;
                out.pop();
                counts.set(minKey, c);
                counts.set(k2, c2);
                counts.set(k3, c3);
            }
        }
        return false;
    }

    /** 把手牌拆解 + 副露合并成完整牌型(副露: 吃=顺子, 碰=刻子, 杠=杠) */
    private static _attachMelds(
        std: { groups: HuGroup[]; pair: Tile },
        melds: Meld[],
    ): HuPattern {
        const groups: HuGroup[] = melds.map(m => ({
            type: m.type === 'chi' ? 'chow' as const : (m.type === 'kan' ? 'kong' as const : 'pung' as const),
            tile: m.tiles[0],
        }));
        groups.push(...std.groups);
        return {
            kind: 'standard',
            groups,
            pair: std.pair,
            allTriplets: groups.every(g => g.type !== 'chow'),
        };
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

    /** 由 "花色-点数" 键造一张牌(id 为 -1,仅用于展示与判定) */
    private static _proto(key: string): Tile {
        const { suit, rank } = HuChecker._parseKey(key);
        return new Tile(-1, suit, rank);
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
