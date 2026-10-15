import { Tile } from './Tile';
import { TileSuit, MAX_RANK } from './TileDefine';

/**
 * 牌墙 - 生成全套牌并洗牌,提供摸牌接口
 * 标准136张: 万条筒各36 + 风牌16 + 箭牌12
 */
export class Wall {
    private tiles: Tile[] = [];
    private drawIndex = 0;

    constructor() {
        this.generate();
        this.shuffle();
    }

    /** 生成全套牌 */
    private generate(): void {
        let id = 0;
        // 万条筒: 每花色 1~9 各4张 = 108张
        const numberSuits = [TileSuit.WAN, TileSuit.TIAO, TileSuit.TONG];
        for (const suit of numberSuits) {
            for (let rank = 1; rank <= MAX_RANK; rank++) {
                for (let c = 0; c < 4; c++) {
                    this.tiles.push(new Tile(id++, suit, rank));
                }
            }
        }
        // 风牌: 东南西北 各4张 = 16张
        for (let rank = 1; rank <= 4; rank++) {
            for (let c = 0; c < 4; c++) {
                this.tiles.push(new Tile(id++, TileSuit.FENG, rank));
            }
        }
        // 箭牌: 中发白 各4张 = 12张
        for (let rank = 1; rank <= 3; rank++) {
            for (let c = 0; c < 4; c++) {
                this.tiles.push(new Tile(id++, TileSuit.JIAN, rank));
            }
        }
    }

    /** Fisher-Yates 洗牌 */
    private shuffle(): void {
        for (let i = this.tiles.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.tiles[i], this.tiles[j]] = [this.tiles[j], this.tiles[i]];
        }
    }

    /** 摸一张牌,牌墙空时返回 null */
    draw(): Tile | null {
        if (this.drawIndex >= this.tiles.length) return null;
        return this.tiles[this.drawIndex++];
    }

    /** 剩余牌数 */
    get remaining(): number {
        return this.tiles.length - this.drawIndex;
    }

    /** 总牌数 */
    get total(): number {
        return this.tiles.length;
    }
}
