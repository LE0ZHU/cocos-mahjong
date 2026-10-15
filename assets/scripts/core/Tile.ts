import { TileSuit, SUIT_CHARS, FENG_CHARS, JIAN_CHARS, SUIT_SORT_WEIGHT, CN_NUMERALS } from './TileDefine';

/**
 * 麻将牌数据 - 纯数据类,不依赖引擎
 * 后续胡牌判断、AI 决策均基于此数据结构
 */
export class Tile {
    /** 唯一ID (0~135) */
    public readonly id: number;
    /** 花色 */
    public readonly suit: TileSuit;
    /** 点数: 数牌 1~9, 风牌 1~4, 箭牌 1~3 */
    public readonly rank: number;

    constructor(id: number, suit: TileSuit, rank: number) {
        this.id = id;
        this.suit = suit;
        this.rank = rank;
    }

    /** 显示文字,如 "一萬"、"東"、"中" */
    get displayText(): string {
        switch (this.suit) {
            case TileSuit.WAN:
            case TileSuit.TIAO:
            case TileSuit.TONG:
                return `${CN_NUMERALS[this.rank - 1]}${SUIT_CHARS[this.suit]}`;
            case TileSuit.FENG:
                return FENG_CHARS[this.rank - 1];
            case TileSuit.JIAN:
                return JIAN_CHARS[this.rank - 1];
            default:
                return '?';
        }
    }

    /** 理牌排序键: 花色权重 + 点数 */
    get sortKey(): number {
        return SUIT_SORT_WEIGHT[this.suit] + this.rank;
    }

    /** 是否为数牌(万/条/筒) */
    get isNumberTile(): boolean {
        return this.suit === TileSuit.WAN
            || this.suit === TileSuit.TIAO
            || this.suit === TileSuit.TONG;
    }

    /** 同花色同点数(用于判断碰/杠/吃) */
    sameType(other: Tile): boolean {
        return this.suit === other.suit && this.rank === other.rank;
    }

    toString(): string {
        return this.displayText;
    }
}
