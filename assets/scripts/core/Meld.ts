import { Tile } from './Tile';

/** 副露类型: 吃/碰/杠 */
export type MeldType = 'chi' | 'pon' | 'kan';

/**
 * 副露 - 吃/碰/杠组成的一组牌
 * 纯数据,不依赖引擎
 */
export class Meld {
    /** 副露类型 */
    readonly type: MeldType;
    /** 组成副露的所有牌(含触发牌) */
    readonly tiles: Tile[];
    /** 触发副露的牌(别家打出的) */
    readonly sourceTile: Tile;
    /** 触发牌来自哪个玩家 (0=玩家, 1=上家AI, 2=左家AI, 3=右家AI) */
    readonly fromPlayer: number;
    /** 续杠次数(碰→杠时 +1;槓 之后再摸到第4张的"加杠"同样 +1) */
    private _added = 0;

    constructor(type: MeldType, tiles: Tile[], sourceTile: Tile, fromPlayer: number) {
        this.type = type;
        this.tiles = tiles;
        this.sourceTile = sourceTile;
        this.fromPlayer = fromPlayer;
    }

    /** 是否为杠(杠占4张,但只算1面子) */
    get isKan(): boolean { return this.type === 'kan'; }

    /** 该副露占用的手牌张数(碰/吃=2, 杠=3) */
    get handTileCount(): number { return this.type === 'kan' ? 3 : 2; }

    /** 续杠次数: 每次把碰升级为杠 +1 */
    get addedKanCount(): number { return this._added; }

    /**
     * 续杠: 把手上摸到的第4张牌补进这个副露(碰 → 杠)
     *
     * 仅允许对"碰"使用;牌会加入 tiles,面子从 3 张变 4 张。
     * @returns 是否成功
     */
    upgradeToKan(tile: Tile): boolean {
        if (this.type !== 'pon') return false;
        const t = this as { type: MeldType };
        t.type = 'kan';
        this.tiles.push(tile);
        this._added++;
        return true;
    }

    /** 副露中来自手牌的牌(不含触发牌sourceTile) */
    handTilesRef(): Tile[] {
        return this.tiles.filter(t => t !== this.sourceTile);
    }

    toString(): string {
        const name = this.type === 'chi' ? '吃' : this.type === 'pon' ? '碰' : '杠';
        return `${name}:${this.tiles.map(t => t.displayText).join('')}`;
    }
}
