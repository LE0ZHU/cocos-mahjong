import { Tile } from '../core/Tile';
import { TileSuit } from '../core/TileDefine';
import { Wall } from '../core/Wall';

/**
 * 抽牌模式 - 纯逻辑(不依赖引擎, 可 node 直跑)
 *
 * 【玩法】一副 136 张牌全部牌面朝上, 打乱后摆成矩形阵:
 *   长边(牌的高)方向 8 张、短边(牌的宽)方向 17 张 —— 8 × 17 = 136, 恰好一副全套牌。
 * 玩家与一个电脑轮流抽牌, **每次必须一次性抽走两张相同的牌**,
 * 且这两张各自都得"抽得出来"—— 上下左右某一个方向上, 到阵型边界的**整条通道**
 * 都不能有别的牌挡着(贴着边界的那一列/行天然算通)。
 * 抽完(或双方都抽不动了)比总点数: 字牌一律 10 点, 数牌按牌面点数,
 * **一组(两张)只按一张算**(例如两张九萬这一组算 9 点)。点数高者胜。
 *
 * 【挡住 = 整条通道】牌是一层平铺、彼此紧贴的, 抽一张要顺着某个方向把它"抽"出去,
 * 那条通道上只要还压着任何一张牌就抽不动。所以可抽的牌永远是"某一行或某一列
 * 已经通到边界的位置"—— 开局只有最外圈可抽, 每抽走一对就可能在若干行/列上
 * 打通新的通道, 让更里面的牌露出来。
 */

/** 阵型: 长边 8 张 */
export const DRAW_ROWS = 8;
/** 阵型: 短边(宽) 17 张 */
export const DRAW_COLS = 17;
/** 总格数 = 136(恰好一副全套牌) */
export const DRAW_CELLS = DRAW_ROWS * DRAW_COLS;

/** 字牌(风/箭)固定 10 点, 数牌按点数 */
export function tilePoint(tile: Tile): number {
    if (tile.suit === TileSuit.FENG || tile.suit === TileSuit.JIAN) return 10;
    return tile.rank;
}

/** 一组可抽的对牌: 两个格下标 + 这一组算的点数 */
export interface DrawPair {
    a: number;
    b: number;
    value: number;
}

export class DrawGame {
    readonly rows = DRAW_ROWS;
    readonly cols = DRAW_COLS;

    /** 每格上的牌(null = 已被抽走); 长度恒为 DRAW_CELLS */
    private _cells: (Tile | null)[];
    /** 两家累计点数 [0]=玩家 [1]=电脑 */
    private _scores: number[] = [0, 0];
    /** 当前该谁抽: 0 = 玩家, 1 = 电脑 */
    private _seat = 0;
    /** 牌局是否已结束(全部抽完 或 双方都抽不动) */
    private _over = false;
    /**
     * 两家抽到的牌 [0]=玩家 [1]=电脑
     *
     * 每组只记**一张代表牌**(用户要求"抽到一对只显示一张"); 抽牌顺序入队,
     * 展示时由 UI 按**点数**自己排序(不区分花色) —— 规则层不关心怎么排。
     */
    private _collected: Tile[][] = [[], []];

    constructor() {
        // 直接复用牌墙的全套生成 + 洗牌, 再一张张铺进格子
        const wall = new Wall();
        const cells: (Tile | null)[] = [];
        for (let i = 0; i < DRAW_CELLS; i++) cells.push(wall.draw());
        this._cells = cells;
        // 随机选边决定谁先抽
        this._seat = Math.random() < 0.5 ? 0 : 1;
    }

    get seat(): number { return this._seat; }
    get isOver(): boolean { return this._over; }
    scoreOf(seat: number): number { return this._scores[seat] ?? 0; }

    /** 某一家已经抽到的牌(抽牌顺序, 每组一张代表牌) */
    collected(seat: number): readonly Tile[] {
        return this._collected[seat] ?? [];
    }

    /** 阵上还剩几张牌 */
    get remaining(): number {
        let n = 0;
        for (const c of this._cells) if (c) n++;
        return n;
    }

    tileAt(index: number): Tile | null {
        if (index < 0 || index >= this._cells.length) return null;
        return this._cells[index] ?? null;
    }

    /**
     * 这一格能不能抽出来: 上下左右四个方向里, 至少有一个方向到阵型边界的
     * **整条通道**都没有别的牌(通道上任何一格还压着牌就堵死了)。
     * 贴着边界的那一列/行本身就没有"前面的格子", 天然算通 —— 所以最外圈永远可抽。
     */
    isFree(index: number): boolean {
        if (index < 0 || index >= this._cells.length) return false;
        if (!this._cells[index]) return false;
        const c = index % DRAW_COLS;
        const r = Math.floor(index / DRAW_COLS);
        // 左 / 右: 沿本行一路扫到边界, 全程为空才算通
        let clear = true;
        for (let x = c - 1; x >= 0; x--) if (this._cells[r * DRAW_COLS + x]) { clear = false; break; }
        if (clear) return true;
        clear = true;
        for (let x = c + 1; x < DRAW_COLS; x++) if (this._cells[r * DRAW_COLS + x]) { clear = false; break; }
        if (clear) return true;
        // 上 / 下: 沿本列一路扫到边界
        clear = true;
        for (let y = r - 1; y >= 0; y--) if (this._cells[y * DRAW_COLS + c]) { clear = false; break; }
        if (clear) return true;
        clear = true;
        for (let y = r + 1; y < DRAW_ROWS; y++) if (this._cells[y * DRAW_COLS + c]) { clear = false; break; }
        return clear;
    }

    /** 两张指定的牌能不能作为一组抽走(同花色同点数, 且各自都没被挡住) */
    canDraw(a: number, b: number): boolean {
        if (this._over) return false;
        if (a === b) return false;
        const ta = this.tileAt(a);
        const tb = this.tileAt(b);
        if (!ta || !tb) return false;
        if (!ta.sameType(tb)) return false;
        return this.isFree(a) && this.isFree(b);
    }

    /**
     * 当前盘面上所有可抽的对牌
     *
     * 只有"两张都在明面且都没被挡住"的才算 —— 两张里任何一张被围住就不能抽。
     * 每种牌最多 4 张(最多配成 2 组), 所以按牌型把可抽的牌两两配对即可。
     */
    pairs(): DrawPair[] {
        const byType = new Map<number, number[]>();
        for (let i = 0; i < this._cells.length; i++) {
            const t = this._cells[i];
            if (!t || !this.isFree(i)) continue;
            const key = t.suit * 100 + t.rank;
            let arr = byType.get(key);
            if (!arr) { arr = []; byType.set(key, arr); }
            arr.push(i);
        }
        const out: DrawPair[] = [];
        byType.forEach((arr) => {
            for (let k = 0; k + 1 < arr.length; k += 2) {
                const t = this._cells[arr[k]];
                out.push({ a: arr[k], b: arr[k + 1], value: t ? tilePoint(t) : 0 });
            }
        });
        return out;
    }

    /**
     * 抽走一组牌. 成功后累加点数并换手; 抽完/抽不动则结束.
     * @returns 是否成功(非法组合返回 false)
     */
    draw(a: number, b: number): boolean {
        if (!this.canDraw(a, b)) return false;
        const tile = this._cells[a];
        this._scores[this._seat] += tile ? tilePoint(tile) : 0;
        if (tile) this._collected[this._seat].push(tile);   // 每组只收一张代表牌
        this._cells[a] = null;
        this._cells[b] = null;
        this._refreshOver();
        if (!this._over) this._seat = this._seat === 0 ? 1 : 0;
        return true;
    }

    /**
     * 电脑的选牌: 贪心取当前可抽里点数最高的一组(同分取格位靠前的).
     * 抽得动就抽, 抽不动返回 null(此时牌局由 _refreshOver 判结束).
     */
    aiPick(): DrawPair | null {
        const ps = this.pairs();
        if (ps.length === 0) return null;
        let best = ps[0];
        for (const p of ps) {
            if (p.value > best.value) best = p;
        }
        return best;
    }

    /** 结算: 点数高者胜; 相同为平局(返回 -1) */
    winner(): number {
        if (this._scores[0] === this._scores[1]) return -1;
        return this._scores[0] > this._scores[1] ? 0 : 1;
    }

    /** 抽完一组后重判是否结束: 牌全抽光, 或剩下的牌双方都抽不动了 */
    private _refreshOver(): void {
        if (this.remaining === 0) { this._over = true; return; }
        if (this.pairs().length === 0) this._over = true;
    }
}
