/**
 * AI 对局模拟器 —— 四家对战, 支持自摸与点炮
 *
 * 为什么要单独抽出来: 只测"自摸"的模拟器会让防守策略显得毫无价值
 * (防守只能靠点炮获利), 测出来的难度差异是假的。所以这里实现了点炮。
 *
 * 座位 0 用难度 A, 座位 1-3 用难度 B, 便于做单挑对比。
 */
import { Tile } from '../../assets/scripts/core/Tile';
import { TileSuit, TILE_TYPE_COUNT, tileIndexOf } from '../../assets/scripts/core/TileDefine';
import { Wall } from '../../assets/scripts/core/Wall';
import { HuChecker } from '../../assets/scripts/core/HuChecker';
import { AIBrain, AIContext, AIDifficulty } from '../../assets/scripts/game/AIBrain';
import { Player } from '../../assets/scripts/game/Player';
import { ThreatInfo } from '../../assets/scripts/core/AIDefense';
import { Meld } from '../../assets/scripts/core/Meld';
import { computeHu } from '../../assets/scripts/core/HuScore';

const NEXT = [3, 2, 0, 1];

/** 一次模拟的结果 */
export interface SimResult {
    /** 各座位胡牌次数(自摸+点炮都算) */
    wins: number[];
    /** 各座位累计得分(用真实 HuScore 算番) */
    scores: number[];
    /** 是否流局 */
    draw: boolean;
    /** 出现的非法操作(应为空) */
    errors: string[];
}

/**
 * 跑一局
 * @param diffA 座位0 的难度
 * @param diffB 座位1-3 的难度
 * @param seed 随机种子(同种子结果可复现)
 */
export function simulateGame(diffA: AIDifficulty, diffB: AIDifficulty, seed: number): SimResult {
    let s = seed;
    const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };

    const wall = new Wall();
    const players: Player[] = [new Player(), new Player(), new Player(), new Player()];
    for (let i = 0; i < 13; i++) {
        for (const p of players) {
            const t = wall.draw();
            if (t) p.addTile(t);
        }
    }
    for (const p of players) p.sortHand();

    const wins = [0, 0, 0, 0];
    const scores = [0, 0, 0, 0];
    const errors: string[] = [];
    const visible = new Int8Array(TILE_TYPE_COUNT);
    const diffOf = (seat: number): AIDifficulty => (seat === 0 ? diffA : diffB);

    const refreshVisible = (): void => {
        visible.fill(0);
        for (const p of players) {
            for (const t of p.hand) visible[tileIndexOf(t.suit, t.rank)]++;
            for (const t of p.discards) visible[tileIndexOf(t.suit, t.rank)]++;
            for (const m of p.melds) for (const t of m.tiles) visible[tileIndexOf(t.suit, t.rank)]++;
        }
    };

    const buildCtx = (seat: number): AIContext => {
        const me = players[seat];
        const threats: ThreatInfo[] = [];
        for (let k = 0; k < 4; k++) {
            if (k === seat) continue;
            threats.push({
                discards: players[k].discards,
                melds: players[k].melds,
                declaredTenpai: players[k].declaredTenpai,
            });
        }
        return {
            hand: me.hand,
            melds: me.melds,
            declaredTenpai: me.declaredTenpai,
            visible,
            threats,
            wallRemaining: wall.remaining,
            difficulty: diffOf(seat),
        };
    };

    /** 让某家出一张牌, 返回打出的牌; 非法时返回 null */
    const doDiscard = (seat: number): Tile | null => {
        const p = players[seat];
        refreshVisible();
        const ctx = buildCtx(seat);
        const idx = p.declaredTenpai
            ? AIBrain.chooseDiscardTenpaiSafe(ctx)
            : AIBrain.chooseDiscard(ctx);
        if (idx < 0 || idx >= p.hand.length) {
            errors.push(`座位${seat} 非法出牌索引 ${idx} (手牌 ${p.hand.length} 张)`);
            return null;
        }
        // 立直锁: 打完必须仍然听牌
        if (p.declaredTenpai) {
            const rest = p.hand.filter((_, i) => i !== idx);
            if (HuChecker.isTenpai(rest, p.melds).length === 0) {
                errors.push(`座位${seat} 立直后打出破坏听牌的牌`);
            }
        }
        const d = p.removeTile(idx)!;
        p.discards.push(d);
        p.sortHand();
        if (HuChecker.isTenpai(p.hand, p.melds).length > 0) p.declaredTenpai = true;
        return d;
    };

    /** 检查是否有人能胡这张牌(点炮) */
    const ronSeats = (discarder: number, tile: Tile): number[] => {
        const out: number[] = [];
        for (let k = 0; k < 4; k++) {
            if (k === discarder) continue;
            if (HuChecker.isHu([...players[k].hand, tile], players[k].melds)) out.push(k);
        }
        return out;
    };

    /** 自摸结算: 赢家加分, 输家按番数付分 */
    const settleSelfDraw = (seat: number): void => {
        wins[seat]++;
        const p = players[seat];
        const pts = computeHu({
            hand: p.hand, melds: p.melds, isSelfDraw: true, isAfterKan: false,
            isLastTile: false, isRobKan: false, streak: 1,
            declaredTenpai: p.declaredTenpai,
        }).points;
        scores[seat] += pts * 3;
        for (let k = 0; k < 4; k++) if (k !== seat) scores[k] -= pts;
    };

    /** 点炮结算: 赢家从放铳者手里拿分 */
    const settleRon = (winners: number[], payer: number): void => {
        for (const w of winners) {
            wins[w]++;
            const p = players[w];
            const pts = computeHu({
                hand: [...p.hand, players[payer].discards[players[payer].discards.length - 1]],
                melds: p.melds, isSelfDraw: false, isAfterKan: false,
                isLastTile: false, isRobKan: false, streak: 1,
                declaredTenpai: p.declaredTenpai,
            }).points;
            scores[w] += pts;
            scores[payer] -= pts;
        }
    };

    let turn = -1;
    let draw = false;
    for (let step = 0; step < 900; step++) {
        turn = (turn + 1) % 4;
        const me = players[turn];
        if (wall.remaining <= 0) { draw = true; break; }
        const drawn = wall.draw();
        if (!drawn) { draw = true; break; }
        me.addTile(drawn);
        if (HuChecker.isHu(me.hand, me.melds)) { settleSelfDraw(turn); break; }

        // 续杠: 摸到已碰牌面的第 4 张
        const addKan = me.melds.find(m => m.type === 'pon' && m.handTilesRef().some(t => t.sameType(drawn)));
        if (addKan && rnd() < 0.8) {
            addKan.upgradeToKan(drawn);
            me.removeTileRef(drawn);
            if (wall.remaining <= 0) { draw = true; break; }
            const rep = wall.draw();
            if (!rep) { draw = true; break; }
            me.addTile(rep);
            if (HuChecker.isHu(me.hand, me.melds)) { settleSelfDraw(turn); break; }
        }
        if (HuChecker.isTenpai(me.hand, me.melds).length > 0) me.declaredTenpai = true;

        const discarded = doDiscard(turn);
        if (!discarded) break;

        // 点炮优先于副露
        const rons = ronSeats(turn, discarded);
        if (rons.length > 0) { settleRon(rons, turn); break; }

        // 副露: 只允许下家碰/杠(简化: 不处理吃)
        const nxt = NEXT[turn];
        const np = players[nxt];
        if (!np.declaredTenpai) {
            refreshVisible();
            const same = np.hand.filter(t => t.sameType(discarded));
            let cand: { type: 'pon' | 'kan'; handTiles: Tile[] }[] = [];
            if (same.length >= 3) cand = [{ type: 'kan', handTiles: same.slice(0, 3) }];
            else if (same.length === 2) cand = [{ type: 'pon', handTiles: same.slice(0, 2) }];
            if (cand.length > 0) {
                const chosen = AIBrain.chooseMeld(buildCtx(nxt), cand, discarded);
                if (chosen && chosen.type !== 'ron') {
                    np.addMeld(new Meld(chosen.type, [...chosen.handTiles, discarded], discarded, turn));
                    if (chosen.type === 'kan') {
                        if (wall.remaining <= 0) { draw = true; break; }
                        const rep = wall.draw();
                        if (!rep) { draw = true; break; }
                        np.addTile(rep);
                        if (HuChecker.isHu(np.hand, np.melds)) { settleSelfDraw(nxt); break; }
                    }
                    if (HuChecker.isTenpai(np.hand, np.melds).length > 0) np.declaredTenpai = true;
                    const d2 = doDiscard(nxt);
                    if (!d2) break;
                    const rons2 = ronSeats(nxt, d2);
                    if (rons2.length > 0) { settleRon(rons2, nxt); break; }
                    continue;
                }
            }
        }
    }
    return { wins, scores, draw, errors };
}

/** 批量跑 N 局, 返回汇总 */
export function runBatch(
    diffA: AIDifficulty,
    diffB: AIDifficulty,
    n: number,
    seedBase: number,
): {
    winA: number; winB: number; draw: number; errors: string[];
    /** 座位0 的平均得分 */
    avgScoreA: number;
    /** 座位1-3 的平均得分(合计) */
    avgScoreB: number;
    huTotal: number;
} {
    let winA = 0; let winB = 0; let draw = 0; let huTotal = 0;
    let scoreA = 0; let scoreB = 0;
    const errors: string[] = [];
    for (let i = 0; i < n; i++) {
        const r = simulateGame(diffA, diffB, seedBase + i * 271);
        if (r.errors.length > 0) errors.push(...r.errors.slice(0, 2));
        const sumA = r.wins[0];
        const sumB = r.wins[1] + r.wins[2] + r.wins[3];
        huTotal += r.wins.reduce((a, b) => a + b, 0);
        scoreA += r.scores[0];
        scoreB += r.scores[1] + r.scores[2] + r.scores[3];
        if (r.draw || (sumA === 0 && sumB === 0)) draw++;
        else if (sumA > sumB) winA++;
        else if (sumB > sumA) winB++;
        else draw++;
    }
    return {
        winA, winB, draw, errors, huTotal,
        avgScoreA: scoreA / n,
        avgScoreB: scoreB / n,
    };
}