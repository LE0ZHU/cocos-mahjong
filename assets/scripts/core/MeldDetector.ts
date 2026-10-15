import { Tile } from './Tile';
import { MAX_RANK } from './TileDefine';
import { Meld, MeldType } from './Meld';

/** 副露候选: 类型 + 需要从手牌中取出的牌 */
export interface MeldCandidate {
    /**
     * 候补类型:
     *  - chi/pon/kan: 常规副露(需要 handTiles)
     *  - kan 且 handTiles 为空: 续杠(把已碰的面子补成杠)
     *  - ron: 吃胡(点炮),不消耗手牌
     */
    type: 'chi' | 'pon' | 'kan' | 'ron';
    /** 手牌中用于副露的牌(不含触发牌);ron 时为空 */
    handTiles: Tile[];
}

/**
 * 副露检测 - 纯逻辑,不依赖引擎
 *
 * 检测手牌能否对某张牌进行吃/碰/杠
 *  - 碰: 手中有2张与target相同
 *  - 杠(明杠): 手中有3张与target相同
 *  - 吃: target为数牌,手中有2张能与target组成顺子(仅下家可吃,本检测只判断牌型)
 */
export class MeldDetector {
    /** 检测能否碰: 返回所需的2张手牌,不能则null */
    static canPon(hand: Tile[], target: Tile): Tile[] | null {
        const same = hand.filter(t => t.sameType(target));
        return same.length >= 2 ? same.slice(0, 2) : null;
    }

    /** 检测能否明杠: 返回所需的3张手牌,不能则null */
    static canKan(hand: Tile[], target: Tile): Tile[] | null {
        const same = hand.filter(t => t.sameType(target));
        return same.length >= 3 ? same.slice(0, 3) : null;
    }

    /** 检测能否吃: 返回所有可能的吃法(每种为2张手牌) */
    static canChi(hand: Tile[], target: Tile): Tile[][] {
        if (!target.isNumberTile) return [];
        const results: Tile[][] = [];
        const suit = target.suit;
        const rank = target.rank;
        // 三种顺子组合: target可作顺子的第1/2/3张
        const patterns: [number, number][] = [
            [rank - 2, rank - 1], // target为第3张
            [rank - 1, rank + 1], // target为第2张
            [rank + 1, rank + 2], // target为第1张
        ];
        for (const [r1, r2] of patterns) {
            if (r1 < 1 || r2 > MAX_RANK) continue;
            const t1 = hand.find(t => t.suit === suit && t.rank === r1);
            const t2 = hand.find(t => t.suit === suit && t.rank === r2);
            if (t1 && t2) results.push([t1, t2]);
        }
        return results;
    }

    /**
     * 检测所有可能的副露(碰/杠/吃)
     * 优先级: 杠 > 碰 > 吃
     * @param hand 手牌
     * @param target 别家打出的牌
     * @param canChi 是否允许吃(仅下家可吃)
     */
    static detectAll(hand: Tile[], target: Tile, canChi: boolean): MeldCandidate[] {
        const candidates: MeldCandidate[] = [];
        const kan = MeldDetector.canKan(hand, target);
        if (kan) candidates.push({ type: 'kan', handTiles: kan });
        const pon = MeldDetector.canPon(hand, target);
        if (pon) candidates.push({ type: 'pon', handTiles: pon });
        if (canChi) {
            const chis = MeldDetector.canChi(hand, target);
            for (const c of chis) candidates.push({ type: 'chi', handTiles: c });
        }
        return candidates;
    }

    /** 从候选中构建 Meld(把触发牌与手牌组合;吃胡不走这里) */
    static toMeld(candidate: MeldCandidate, sourceTile: Tile, fromPlayer: number): Meld {
        const tiles = [...candidate.handTiles, sourceTile];
        const type: MeldType = candidate.type === 'ron' ? 'pon' : candidate.type;
        return new Meld(type, tiles, sourceTile, fromPlayer);
    }
}
