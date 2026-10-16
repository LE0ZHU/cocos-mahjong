/**
 * 向听数(Shanten) 与 HuChecker 的一致性验证
 *
 * 关键不变量:
 *  1. 14 张(4-副露)×3+2) → Shanten == -1  ⟺  HuChecker.isHu
 *  2. 13 张(4-副露)×3+1) → Shanten ==  0  ⟺  HuChecker.isTenpai 非空
 *  3. 进张集合 = HuChecker.isTenpai 的听牌张(只对听牌手牌成立)
 *
 * 随机对拍之外还有一组**断言式的手工用例**: 随机采样撞不到"4 面子 + 将牌被面子吃掉"
 * 这种结构化形状(概率极低), 所以必须显式构造 —— 那个形状曾让 calc 错报 -1。
 */
declare const process: { exit(code: number): never };
import { Tile } from '../../assets/scripts/core/Tile';
import { TileSuit, MAX_RANK, TILE_TYPE_COUNT, tileIndexOf } from '../../assets/scripts/core/TileDefine';
import { HuChecker } from '../../assets/scripts/core/HuChecker';
import { Shanten } from '../../assets/scripts/core/Shanten';
import { Meld } from '../../assets/scripts/core/Meld';

let rngState = 123456789;
function rnd(): number {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
}

function buildWall(): Tile[] {
    const tiles: Tile[] = [];
    let id = 0;
    for (const suit of [TileSuit.WAN, TileSuit.TIAO, TileSuit.TONG]) {
        for (let r = 1; r <= MAX_RANK; r++) {
            for (let c = 0; c < 4; c++) tiles.push(new Tile(id++, suit, r));
        }
    }
    for (let r = 1; r <= 4; r++) for (let c = 0; c < 4; c++) tiles.push(new Tile(id++, TileSuit.FENG, r));
    for (let r = 1; r <= 3; r++) for (let c = 0; c < 4; c++) tiles.push(new Tile(id++, TileSuit.JIAN, r));
    return tiles;
}

function shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}

function randomMelds(count: number): Meld[] {
    const melds: Meld[] = [];
    for (let i = 0; i < count; i++) {
        const isKan = rnd() < 0.2;
        const type = isKan ? 'kan' : (rnd() < 0.5 ? 'pon' : 'chi');
        let tiles: Tile[];
        if (type === 'pon' || type === 'kan') {
            const suit = Math.floor(rnd() * 5) as TileSuit;
            const rank = suit >= 3 ? Math.floor(rnd() * (suit === 3 ? 4 : 3)) + 1 : Math.floor(rnd() * 9) + 1;
            tiles = [];
            for (let k = 0; k < (type === 'kan' ? 4 : 3); k++) tiles.push(new Tile(-1, suit, rank));
        } else {
            const suit = Math.floor(rnd() * 3) as TileSuit;
            const start = Math.floor(rnd() * 7) + 1;
            tiles = [start, start + 1, start + 2].map(r => new Tile(-1, suit, r));
        }
        const source = tiles[tiles.length - 1];
        melds.push(new Meld(type as 'chi' | 'pon' | 'kan', tiles, source, 1));
    }
    return melds;
}

let failWin = 0;
let failTenpai = 0;
let checkedWin = 0;
let checkedTenpai = 0;
let failUkeire = 0;
let checkedUkeire = 0;
const failByMeld: Record<number, number> = {};

const wall = buildWall();
for (let iter = 0; iter < 6000; iter++) {
    const meldCount = Math.floor(rnd() * 5); // 0..4
    const melds = randomMelds(meldCount);
    const need = (4 - meldCount) * 3 + 2;
    const hand = shuffle(wall.slice()).slice(0, need);

    // 不变量 1: 和牌
    const isHu = HuChecker.isHu(hand, melds);
    const sHu = Shanten.calc(hand, melds.length);
    checkedWin++;
    const expectHu = sHu === Shanten.WIN;
    if (isHu !== expectHu) {
        failWin++;
        failByMeld[meldCount] = (failByMeld[meldCount] ?? 0) + 1;
        if (failWin <= 8) {
            console.log(`[和牌不一致] huChecker=${isHu} shanten=${sHu} melds=${meldCount} melds=${melds.map(m => m.toString()).join('|')} hand=${hand.map(t => t.displayText).join('')}`);
        }
    }

    // 不变量 2: 听牌(去掉一张后)
    if (hand.length >= 1) {
        const rest = hand.slice(0, hand.length - 1);
        const waiting = HuChecker.isTenpai(rest, melds);
        const sTenpai = Shanten.calc(rest, melds.length);
        checkedTenpai++;
        const expectTenpai = sTenpai === Shanten.TENPAI;
        if ((waiting.length > 0) !== expectTenpai) {
            failTenpai++;
            if (failTenpai <= 5) {
                console.log(`[听牌不一致] isTenpai=${waiting.length > 0} shanten=${sTenpai} melds=${melds.length} hand=${rest.map(t => t.displayText).join('')}`);
            }
        }

        // 不变量 3: 进张集合一致(仅听牌手牌)
        if (expectTenpai) {
            const uk = Shanten.ukeire(rest, melds.length, null);
            checkedUkeire++;
            const a = uk.map(t => `${t.suit}-${t.rank}`).sort().join(',');
            const b = waiting.map(t => `${t.suit}-${t.rank}`).sort().join(',');
            if (a !== b) {
                failUkeire++;
                if (failUkeire <= 5) {
                    console.log(`[进张不一致] ukeire=${a} waiting=${b} hand=${rest.map(t => t.displayText).join('')}`);
                }
            }
        }
    }
}

console.log('--- 一致性验证 ---');
console.log(`和牌   : ${checkedWin - failWin}/${checkedWin}`);
console.log(`听牌   : ${checkedTenpai - failTenpai}/${checkedTenpai}`);
console.log(`进张   : ${checkedUkeire - failUkeire}/${checkedUkeire}`);
console.log('和牌不一致按副露数分布:', JSON.stringify(failByMeld));

// --- 手工用例 ---
console.log('\n--- 手工用例 ---');
function mk(spec: string[]): Tile[] {
    return spec.map(s => {
        const idx = Number(s);
        const suit = idx < 9 ? TileSuit.WAN : idx < 18 ? TileSuit.TIAO : idx < 27 ? TileSuit.TONG : idx < 31 ? TileSuit.FENG : TileSuit.JIAN;
        const rank = idx < 9 ? idx + 1 : idx < 18 ? idx - 8 : idx < 27 ? idx - 17 : idx < 31 ? idx - 26 : idx - 30;
        return new Tile(-1, suit, rank);
    });
}

/**
 * 手工用例一律用 **断言** 而不是 console.log
 *
 * 【教训】这几条原本只打印不断言, 于是"期望值"写错了也没人发现 ——
 * 其中 tp1 那条的期望 `-1` 恰恰是 `Shanten.calc` 的 bug 本身
 * (4 面子 + 将牌被面子吃掉的形状被错判为已和牌), 测试反而把它固化了下来。
 * 凡是能被断言的期望值就一定要断言, 否则等于没测。
 */
let failHand = 0;
function expectCalc(name: string, spec: string[], want: number, meldCount = 0): void {
    const h = mk(spec);
    const got = Shanten.calc(h, meldCount);
    const ok = got === want;
    if (!ok) failHand++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}: shanten = ${got} (期望 ${want})  [${h.length}张] ${h.map(t => t.displayText).join('')}`);
}
function expectHu(name: string, spec: string[], want: boolean): void {
    const h = mk(spec);
    const got = HuChecker.isHu(h, []);
    const ok = got === want;
    if (!ok) failHand++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}: isHu = ${got} (期望 ${want})  [${h.length}张]`);
}
function expectTenpai(name: string, spec: string[], want: boolean): void {
    const h = mk(spec);
    const got = HuChecker.isTenpai(h, []).length > 0;
    const ok = got === want;
    if (!ok) failHand++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}: isTenpai = ${got} (期望 ${want})  [${h.length}张]`);
}

// ── 基本牌型 ──
// 平胡和牌: 4 顺子 + 1 对(14 张)
expectCalc('平胡和牌(4面子+将)', ['0','1','2','3','4','5','6','7','8','9','10','11','22','22'], -1);
expectHu('平胡和牌(4面子+将)', ['0','1','2','3','4','5','6','7','8','9','10','11','22','22'], true);
// 4 顺子 + 1 孤张 = 听牌(13 张)
expectCalc('4面子+1孤张(13张)', ['0','1','2','3','4','5','6','7','8','9','10','11','12'], 0);
expectTenpai('4面子+1孤张(13张)', ['0','1','2','3','4','5','6','7','8','9','10','11','12'], true);

/**
 * ── 「将牌被面子吃掉」的最小复现(本 bug 的回归用例) ──
 *
 * 一萬一萬 二萬…九萬 一條二條三條东 (14 张):
 *   面子 一二三萬/四五六萬/七八九萬/一二三條 消耗了两张一萬中的**一张**,
 *   剩下「一萬 + 东」凑不成将 → 不是和牌。
 *   但 counts[一萬] === 2 会让"手牌里存在对子"判真, 旧实现因此错报 -1,
 *   连带 ukeire 把 13 种牌都当成"能进张"(实际只有东能胡)。
 */
expectCalc('将牌被面子吃掉(14张)', ['0','0','1','2','3','4','5','6','7','8','9','10','11','27'], 0);
expectHu('将牌被面子吃掉(14张)', ['0','0','1','2','3','4','5','6','7','8','9','10','11','27'], false);
expectTenpai('将牌被面子吃掉(13张, 听东)', ['0','1','2','3','4','5','6','7','8','9','10','11','27'], true);
// 该形状的进张必须只有「东」(旧实现返回 13 种)
{
    const h = mk(['0','1','2','3','4','5','6','7','8','9','10','11','27']);
    const uk = Shanten.ukeire(h, 0, null);
    const ok = uk.length === 1 && uk[0].displayText === '东';
    if (!ok) failHand++;
    console.log(`  ${ok ? '✓' : '✗'} 「将牌被吃掉」的进张只有东: [${uk.map(t => t.displayText).join(',')}] (${uk.length} 种)`);
}
// 同一形状但牌数不同: 4 面子 + 2 张不成对的孤张(14 张) → 仍不是和牌
expectCalc('4面子+2孤张不成对(14张)', ['0','1','2','3','4','5','6','7','8','9','10','11','12','22'], 0);
// 将牌与刻子同型: 一萬×3 作刻子 + 九条×2 作将 → 真和牌
expectCalc('刻子与将牌同型(14张)', ['0','0','0','1','2','3','4','5','6','9','10','11','26','26'], -1);
expectHu('刻子与将牌同型(14张)', ['0','0','0','1','2','3','4','5','6','9','10','11','26','26'], true);

// ── 七对 / 十三幺 / 散牌 ──
expectCalc('七对13张', ['0','0','1','1','9','9','17','17','18','18','26','26','27'], 0);
expectCalc('十三幺13张', ['0','0','8','8','9','9','17','17','18','18','26','26','27'], 0);
expectCalc('全孤张', ['0','3','6','9','10','13','16','19','22','25','28','31','32'], 6);

// tileIndexOf 与 toCounts 一致性
let idxOk = true;
for (let i = 0; i < TILE_TYPE_COUNT; i++) {
    const t = (Shanten as unknown as { _protoOf(i: number): Tile })._protoOf(i);
    if (tileIndexOf(t.suit, t.rank) !== i) { idxOk = false; console.log('下标不一致', i, t.displayText); }
}
console.log('tileIndexOf 往返一致:', idxOk);

// 性能
const t0 = Date.now();
for (let i = 0; i < 2000; i++) {
    const hand = shuffle(wall.slice()).slice(0, 13);
    Shanten.calc(hand, 0);
    Shanten.ukeire(hand, 0, null);
}
console.log(`\n性能: 2000 次 (calc + 34选张 ukeire) 用时 ${Date.now() - t0} ms`);

if (!idxOk) { failHand++; console.log('下标往返不一致'); }

const totalFail = failWin + failTenpai + failUkeire + failHand;
console.log(`\n=== ${totalFail === 0 ? '全部通过' : `失败 ${totalFail} 项`} ===`);
process.exit(totalFail === 0 ? 0 : 1);
