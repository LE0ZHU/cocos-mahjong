import { Tile } from '../core/Tile';
import { Meld } from '../core/Meld';

/**
 * 玩家 - 管理手牌、副露和弃牌(出牌区)
 * 后续 AI 对手也可复用此数据结构
 */
export class Player {
    /** 手牌(不含副露牌);理牌后按 sortKey 排序,刚摸到的牌暂挂在末尾 */
    hand: Tile[] = [];
    /** 副露(吃/碰/杠) */
    melds: Meld[] = [];
    /** 弃牌(出牌区,按打出顺序) */
    discards: Tile[] = [];
    /** 当前是否处于听牌状态(每次手牌变动后由 GameManager 重新检测) */
    tenpai: boolean = false;
    /**
     * 是否已"亮明听牌"(立直/听牌宣言)
     *
     * 玩家: 需要主动点"听牌"按钮, 宣告后本局不可再吃/碰/杠, 出牌必须保持听牌
     * AI: 一旦检测到听牌就自动亮明(让玩家知道对手在等牌)
     */
    declaredTenpai: boolean = false;

    /** 理牌: 按花色和点数排序 */
    sortHand(): void {
        this.hand.sort((a, b) => a.sortKey - b.sortKey);
    }

    /** 添加牌到手牌并自动理牌 */
    addTile(tile: Tile): void {
        this.hand.push(tile);
        this.sortHand();
    }

    /** 摸牌: 追加到手牌末尾且不立即理牌(便于 UI 单独标注),出牌后再 sortHand 并入 */
    addDrawnTile(tile: Tile): void {
        this.hand.push(tile);
    }

    /** 按索引移除手牌,返回被移除的牌 */
    removeTile(index: number): Tile | null {
        if (index < 0 || index >= this.hand.length) return null;
        return this.hand.splice(index, 1)[0];
    }

    /** 按牌引用移除手牌 */
    removeTileRef(tile: Tile): boolean {
        const idx = this.hand.indexOf(tile);
        if (idx >= 0) {
            this.hand.splice(idx, 1);
            return true;
        }
        return false;
    }

    /** 添加副露: 从手牌移除对应牌,加入 melds */
    addMeld(meld: Meld): void {
        for (const t of meld.handTilesRef()) {
            this.removeTileRef(t);
        }
        this.melds.push(meld);
        this.sortHand();
    }

    /** 手牌数量 */
    get handCount(): number {
        return this.hand.length;
    }

    /** 是否已有副露 */
    get hasMeld(): boolean {
        return this.melds.length > 0;
    }

    /** 清空手牌、副露和弃牌(新一局) */
    reset(): void {
        this.hand.length = 0;
        this.melds.length = 0;
        this.discards.length = 0;
        this.tenpai = false;
        this.declaredTenpai = false;
    }
}
