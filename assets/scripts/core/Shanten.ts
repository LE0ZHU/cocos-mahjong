import { Tile } from './Tile';
import { MAX_RANK, TILE_TYPE_COUNT, TileSuit, tileIndexOf } from './TileDefine';

/**
 * 向听数(Shanten)计算 —— 纯逻辑, 不依赖引擎
 *
 * 向听数定义(越小越好):
 *   -1 = 已和牌, 0 = 听牌, 1 = 差一步, ... 8 = 最烂
 *
 * 核心公式:
 *   向听数 = 8 - 2 × (副露数 + 完整面子数) - 搭子数
 *
 * 数牌按花色分别用 DFS 求最优拆法; 各花色互不干扰且目标函数可分离,
 * 所以逐花色取最优再相加就是全局最优。字牌只能成刻子/对子, 贪心即可。
 *
 * 为什么必须 DFS 而不能贪心: "111234" 是拆成刻子+顺子还是搭子+顺子,
 * 两种拆法的向听数完全不同, 贪心会选错。
 *
 * 【坑】公式隐含"将牌由一个搭子提供", 但将牌必须是**对子**。
 * 4 个面子已凑齐、手上只剩两张不相干的牌时(如 4 副露 + 三萬一萬),
 * 它们虽然构成"嵌张搭子", 却凑不成将, 此时不能按公式判 -1。
 * 所以单独处理"面子已满"这一边界(见 calc 末尾)。
 */
export class Shanten {
    /** 已和牌 */
    public static readonly WIN = -1;
    /** 听牌 */
    public static readonly TENPAI = 0;

    /** 拆解结果的打包: 高位放面子数, 低位放搭子数(低位用 4bit, 搭子最多 6 个) */
    private static readonly _SHIFT = 4;
    private static readonly _MASK = 0xf;

    /** 记忆化缓存: 9 个数牌各占 3bit(共 27bit) */
    private static readonly _cache = new Map<number, number>();
    /** 缓存上限: 到顶直接清空重来 */
    private static readonly _CACHE_LIMIT = 60000;

    /** 手牌转成 34 长的牌型计数 */
    public static toCounts(hand: Tile[]): Int8Array {
        const counts = new Int8Array(TILE_TYPE_COUNT);
        for (const t of hand) counts[tileIndexOf(t.suit, t.rank)]++;
        return counts;
    }

    /**
     * 计算向听数
     * @param hand 手牌(不含副露)
     * @param meldCount 副露数(吃/碰/杠各算 1 个面子)
     */
    public static calc(hand: Tile[], meldCount = 0): number {
        if (meldCount > 4) return 99;
        const counts = Shanten.toCounts(hand);

        let sets = meldCount;
        let partials = 0;
        // 三个数牌花色: 万(0-8) 条(9-17) 筒(18-26), 每个花色整体算一次
        for (const offset of [0, 9, 18]) {
            const packed = Shanten._bestSuit(counts, offset);
            sets += packed >> Shanten._SHIFT;
            partials += packed & Shanten._MASK;
        }
        // 字牌(27-33): 只能刻子/对子
        for (let i = 27; i < TILE_TYPE_COUNT; i++) {
            const c = counts[i];
            if (c >= 3) sets += 1;
            else if (c === 2) partials += 1;
        }

        // 4 个面子已凑齐: 只差将牌, 而将牌只能是对子
        if (sets >= 4) {
            // 【坑】这里**不能**用"手牌里存在对子"当判据 —— 那个对子可能已经被面子吃掉了。
            // 例: 一萬一萬二萬…九萬 + 一條二條三條 + 东(14 张),
            // 面子 一二三萬/四五六萬/七八九萬/一二三條 用掉了两张一萬中的一张,
            // 剩下「一萬 + 东」凑不成将, 但 counts[一萬] === 2 会让"存在对子"判真,
            // 于是错报成 -1(已和牌) —— 直接违反 AGENTS.md 硬约束 8,
            // 并且让 ukeire 把 13 种牌都算成"进张"(实际只有东能胡)。
            // 正解: 直接验证"能否拆成 (4-副露) 个面子 + 1 个对子"。
            if (Shanten._canWinWithPair(counts, 4 - meldCount)) return Shanten.WIN;
            // 凑不成将 → 最多听牌: 13 张是"4 面子 + 1 孤张"(听这张成对);
            // 14 张打掉多余的孤张后同样是"4 面子 + 1 孤张", 也听牌。
            const leftover = hand.length - 3 * (4 - meldCount);
            return leftover <= 2 ? Shanten.TENPAI : 1;
        }

        let best = 8 - 2 * sets - partials;
        // 副露后不存在七对/十三幺
        if (meldCount > 0) return best;

        // 特殊牌型只在"真的像那么做"时才参与比较, 否则会算出假的好成绩
        // (见 _chiitoitsu / _thirteenOrphans 的前置条件说明)
        if (Shanten._canBeChiitoitsu(counts)) {
            const cp = Shanten._chiitoitsu(counts);
            if (cp < best) best = cp;
        }
        if (Shanten._canBeThirteenOrphans(counts)) {
            const to = Shanten._thirteenOrphans(counts);
            if (to < best) best = to;
        }
        return best;
    }

    /**
     * 有效进张: 能让向听数下降的牌型
     *
     * 只统计"外面还可能摸到"的牌(可见张数 < 4), 否则 AI 会把宽听算得过于漂亮。
     * @param visible 34 长的可见张数(自己手牌 + 全部副露 + 全部弃牌);null 表示不限制
     */
    public static ukeire(
        hand: Tile[],
        meldCount: number,
        visible: Int8Array | null = null,
    ): Tile[] {
        const current = Shanten.calc(hand, meldCount);
        if (current <= Shanten.WIN) return [];
        const out: Tile[] = [];
        const probe: Tile[] = hand.slice();
        for (let i = 0; i < TILE_TYPE_COUNT; i++) {
            if (visible && visible[i] >= 4) continue;
            const tile = Shanten._protoOf(i);
            probe.push(tile);
            const s = Shanten.calc(probe, meldCount);
            probe.pop();
            if (s < current) out.push(tile);
        }
        return out;
    }

    /** 由紧凑下标还原牌型(只用于枚举, id 为 -1) */
    private static _protoOf(index: number): Tile {
        let suit: TileSuit;
        let rank: number;
        if (index < 9) { suit = TileSuit.WAN; rank = index + 1; }
        else if (index < 18) { suit = TileSuit.TIAO; rank = index - 8; }
        else if (index < 27) { suit = TileSuit.TONG; rank = index - 17; }
        else if (index < 31) { suit = TileSuit.FENG; rank = index - 26; }
        else { suit = TileSuit.JIAN; rank = index - 30; }
        return new Tile(-1, suit, rank);
    }

    /** 取某个数牌花色(自 offset 起连续 9 个下标)的最优拆解 */
    private static _bestSuit(counts: Int8Array, offset: number): number {
        const c: number[] = [];
        for (let i = 0; i < MAX_RANK; i++) c.push(counts[offset + i]);
        return Shanten._dfsSuit(c);
    }

    /** 比较两个拆解: 先看 2×面子+搭子(决定向听数), 相同则取面子更多的 */
    private static _better(a: number, b: number): number {
        const sa = a >> Shanten._SHIFT;
        const pa = a & Shanten._MASK;
        const sb = b >> Shanten._SHIFT;
        const pb = b & Shanten._MASK;
        if (2 * sa + pa !== 2 * sb + pb) return 2 * sa + pa > 2 * sb + pb ? a : b;
        return sa >= sb ? a : b;
    }

    /** 单花色 DFS: 从最小的剩余牌开始枚举它的所有用法, 取最优值 */
    private static _dfsSuit(c: number[]): number {
        let i = 0;
        while (i < MAX_RANK && c[i] === 0) i++;
        if (i >= MAX_RANK) return 0;

        let key = 0;
        for (let k = 0; k < MAX_RANK; k++) key = (key << 3) | c[k];
        const hit = Shanten._cache.get(key);
        if (hit !== undefined) return hit;

        const SET = 1 << Shanten._SHIFT;   // 记 1 个面子
        const PART = 1;                     // 记 1 个搭子
        let best = 0;
        // 刻子
        if (c[i] >= 3) {
            c[i] -= 3;
            best = Shanten._better(best, SET + Shanten._dfsSuit(c));
            c[i] += 3;
        }
        // 顺子: 以 i 打头
        if (i + 2 < MAX_RANK && c[i + 1] > 0 && c[i + 2] > 0) {
            c[i]--; c[i + 1]--; c[i + 2]--;
            best = Shanten._better(best, SET + Shanten._dfsSuit(c));
            c[i]++; c[i + 1]++; c[i + 2]++;
        }
        // 对子当搭子(将来能做刻子或当将)
        if (c[i] >= 2) {
            c[i] -= 2;
            best = Shanten._better(best, PART + Shanten._dfsSuit(c));
            c[i] += 2;
        }
        // 搭子: 相邻(i, i+1)
        if (i + 1 < MAX_RANK && c[i + 1] > 0) {
            c[i]--; c[i + 1]--;
            best = Shanten._better(best, PART + Shanten._dfsSuit(c));
            c[i]++; c[i + 1]++;
        }
        // 搭子: 嵌张(i, i+2)
        if (i + 2 < MAX_RANK && c[i + 2] > 0) {
            c[i]--; c[i + 2]--;
            best = Shanten._better(best, PART + Shanten._dfsSuit(c));
            c[i]++; c[i + 2]++;
        }
        // 放弃这张(孤张/死张): 交给后续牌自己处理
        c[i]--;
        best = Shanten._better(best, Shanten._dfsSuit(c));
        c[i]++;

        if (Shanten._cache.size > Shanten._CACHE_LIMIT) Shanten._cache.clear();
        Shanten._cache.set(key, best);
        return best;
    }

    /**
     * 是否已和牌: 能否拆成 `neededSets` 个面子 + 1 个对子
     *
     * 【为什么要单独写而不是用上面的公式】公式 `8 - 2×面子 - 搭子` 会把
     * "4 面子 + 两张不相干的牌"算成 -1(那两张若构成嵌张就算一个搭子),
     * 但将牌必须是**对子**。所以这里枚举将牌候选, 再逐张消耗面子。
     *
     * @param counts 34 长牌型计数(**会被临时修改后还原**)
     * @param neededSets 还需要凑的面子数(已扣掉副露)
     */
    private static _canWinWithPair(counts: Int8Array, neededSets: number): boolean {
        if (neededSets < 0 || neededSets > 4) return false;
        for (let p = 0; p < TILE_TYPE_COUNT; p++) {
            if (counts[p] < 2) continue;
            counts[p] -= 2;                                  // 取这对当将牌
            const ok = Shanten._canFormSets(counts, neededSets);
            counts[p] += 2;                                  // 还原
            if (ok) return true;
        }
        return false;
    }

    /**
     * 剩余牌能否**恰好**拆成 n 个面子(不留余牌)
     *
     * 从最小的非零牌开始枚举它的全部用法(刻子 / 顺子), 逐个消耗;
     * 必须全部消耗完才算成立 —— 因为调用方已保证张数正好是 3n。
     * 数牌可成顺子(不跨花色), 字牌只能成刻子。
     *
     * @param counts 34 长牌型计数(**会被临时修改后还原**)
     */
    private static _canFormSets(counts: Int8Array, n: number): boolean {
        let i = 0;
        while (i < TILE_TYPE_COUNT && counts[i] === 0) i++;
        if (i >= TILE_TYPE_COUNT) return n === 0;   // 牌用完: 面子数也对上才算成功
        if (n === 0) return false;                  // 还有牌却不需要面子了 → 不成立

        // 刻子
        if (counts[i] >= 3) {
            counts[i] -= 3;
            const ok = Shanten._canFormSets(counts, n - 1);
            counts[i] += 3;
            if (ok) return true;
        }
        // 顺子: 只有数牌能组, 且不能跨花色(i 必须在某花色的 1~7 位)
        if (i < 27 && (i % 9) <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
            counts[i]--; counts[i + 1]--; counts[i + 2]--;
            const ok = Shanten._canFormSets(counts, n - 1);
            counts[i]++; counts[i + 1]++; counts[i + 2]++;
            if (ok) return true;
        }
        return false;
    }

    /**
     * 是否可能走七对子路线
     *
     * 七对要求"每种牌最多 2 张"(3 张以上无法拆成对子)。
     * 不加这个限制时, 一手 [一二三萬四五六萬...] 会被算出 pairs=3 之类的假成绩,
     * 凭空比标准型好看好几个向听, 导致 AI 拆掉顺子去追一个做不到的七对。
     */
    private static _canBeChiitoitsu(counts: Int8Array): boolean {
        for (let i = 0; i < TILE_TYPE_COUNT; i++) {
            if (counts[i] >= 3) return false;
        }
        return true;
    }

    /**
     * 是否可能走十三幺路线
     *
     * 十三幺手里只能有幺九牌(最多 1 张多余的用来当将)。
     * 不加限制时, 一手普通牌只要恰好凑了点幺九就会被误判成十三幺,
     * 凭空少好几个向听 —— 这是最容易被 AI 钻空子的一种假象。
     */
    private static _canBeThirteenOrphans(counts: Int8Array): boolean {
        let nonYaochu = 0;
        for (let i = 0; i < TILE_TYPE_COUNT; i++) {
            if (counts[i] === 0) continue;
            if (!Shanten._isYaochuIndex(i)) {
                nonYaochu += counts[i];
                if (nonYaochu > 1) return false;
            }
        }
        return true;
    }

    /** 下标是否属于幺九牌: 数牌 1/9(0,8,9,17,18,26) 与全部字牌(27-33) */
    private static _isYaochuIndex(i: number): boolean {
        return i >= 27 || i === 0 || i === 8 || i === 9 || i === 17 || i === 18 || i === 26;
    }

    /** 七对子向听数(仅门清可用) */
    private static _chiitoitsu(counts: Int8Array): number {
        let pairs = 0;
        let kinds = 0;
        for (let i = 0; i < TILE_TYPE_COUNT; i++) {
            const c = counts[i];
            if (c >= 1) kinds++;
            if (c >= 2) pairs++;
        }
        return 6 - pairs + Math.max(0, 7 - kinds);
    }

    /** 十三幺向听数(仅门清) */
    private static _thirteenOrphans(counts: Int8Array): number {
        let kinds = 0;
        let hasPair = false;
        for (let i = 0; i < TILE_TYPE_COUNT; i++) {
            const c = counts[i];
            if (c === 0) continue;
            // 只认幺九牌: 数牌的 1/9(下标 0,8,9,17,18,26) 与全部字牌(27-33)
            const isYaochu = i >= 27 || i === 0 || i === 8 || i === 9 || i === 17 || i === 18 || i === 26;
            if (!isYaochu) continue;
            kinds++;
            if (c >= 2) hasPair = true;
        }
        return 13 - kinds - (hasPair ? 1 : 0);
    }
}