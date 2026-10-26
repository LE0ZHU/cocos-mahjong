/**
 * 危险牌角标 + 流局听牌 校验 —— 纯 node, 编译后直接跑
 *
 * 五组:
 *  A. 档位阈值: `dangerLevel` 的边界(两个 UI 共用这一条线)
 *  B. 角标与提示同源: 手牌角标读的危险度 === `rankDiscards` 的 `DiscardEval.danger`
 *     === 提示面板首选项的 `danger`(同一张牌必须处处一致)
 *  C. 危险度确实反映公开信息: 现物归零 / 立直加压 / 断幺中张变危险
 *  D. 流局听牌口径: 13 张听牌手牌能算出听什么; 14 张(胡牌局)算不出 —— 这正是
 *     UI 只在流局才调 `HuChecker.isTenpai` 的原因
 *  E. 源码接线: 三处真的接上了(这类改动最容易"写了一半", 而且不会报错)
 *
 * 【为什么组 B 是本文件的重点】玩家侧角标与 AI 防守必须是**同一份计算**。
 * 一旦有人改了 `_mergeThreats` 只更新 AI、忘了 `dangerMap`, 就会出现
 * "提示说这张安全、角标却是红的" —— 那比没有角标更糟。这种漂移不会崩、不会报错,
 * 只能靠对拍守住。
 */
declare const require: (m: string) => any;
declare const __dirname: string;
declare const process: { exit(code: number): never };
const fs = require('fs');
const path = require('path');

import { AIBrain, AIContext } from '../../assets/scripts/game/AIBrain';
import { HintAdvisor, dangerLevel } from '../../assets/scripts/game/HintAdvisor';
import { AIDefense, ThreatInfo } from '../../assets/scripts/core/AIDefense';
import { Tile } from '../../assets/scripts/core/Tile';
import { TileSuit, tileIndexOf } from '../../assets/scripts/core/TileDefine';
import { HuChecker } from '../../assets/scripts/core/HuChecker';
import { Meld } from '../../assets/scripts/core/Meld';

function findFile(rel: string): string {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        const p = path.join(dir, ...rel.split('/'));
        if (fs.existsSync(p)) return p;
        dir = path.dirname(dir);
    }
    throw new Error(`找不到 ${rel}`);
}

const gmSrc = fs.readFileSync(findFile('assets/scripts/managers/GameManager.ts'), 'utf8');
const mainSrc = fs.readFileSync(findFile('assets/scripts/Main.ts'), 'utf8');
const settleSrc = fs.readFileSync(findFile('assets/scripts/ui/SettlementPanel.ts'), 'utf8');
const tileSrc = fs.readFileSync(findFile('assets/scripts/ui/TileView.ts'), 'utf8');

let failed = 0;
function check(cond: boolean, name: string, extra = ''): void {
    if (cond) console.log(`  [OK] ${name}`);
    else { failed++; console.log(`  [FAIL] ${name}${extra ? ' → ' + extra : ''}`); }
}

const SUITS = [TileSuit.WAN, TileSuit.TIAO, TileSuit.TONG];

/** 确定性随机(同 seed 可复现) */
function makeRnd(seed: number): () => number {
    let s = seed;
    return (): number => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

/** 造一手指定牌面的牌(前缀 m=萬 t=條 p=筒 f=风 j=箭) */
function makeHand(specs: string[]): Tile[] {
    let id = 5000;
    const out: Tile[] = [];
    for (const sp of specs) {
        const rank = +sp.slice(1);
        if (sp.startsWith('m')) out.push(new Tile(id++, TileSuit.WAN, rank));
        else if (sp.startsWith('t')) out.push(new Tile(id++, TileSuit.TIAO, rank));
        else if (sp.startsWith('p')) out.push(new Tile(id++, TileSuit.TONG, rank));
        else if (sp.startsWith('f')) out.push(new Tile(id++, TileSuit.FENG, rank));
        else if (sp.startsWith('j')) out.push(new Tile(id++, TileSuit.JIAN, rank));
        else throw new Error(`无法解析的牌面: ${sp}`);
    }
    return out;
}

/**
 * 只带**一家**威胁的上下文
 *
 * 为什么只要一家: `dangerMap` 取的是"任意一家的最大值", 三家都在时
 * "这张对老陈是现物"会被另一家压掉, 就测不出单条判据了。
 */
function ctxOf(hand: Tile[], threat: ThreatInfo, wallRemaining = 60): AIContext {
    const visible = new Int8Array(34);
    for (const t of hand) visible[tileIndexOf(t.suit, t.rank)]++;
    for (const t of threat.discards) visible[tileIndexOf(t.suit, t.rank)]++;
    return {
        hand, melds: [], declaredTenpai: false,
        visible, threats: [threat], wallRemaining, difficulty: 'expert',
    };
}

function threatOf(discards: Tile[], declaredTenpai = false): ThreatInfo {
    return { discards, melds: [], declaredTenpai };
}

/** 34 型危险度的平均值(用来看"整体加压"这类方向性变化) */
function avgDanger(map: Int8Array): number {
    let sum = 0;
    for (let i = 0; i < 34; i++) sum += map[i];
    return sum / 34;
}

// ==================== A. 档位阈值 ====================
console.log('\n=== A. 危险度档位(角标与提示共用) ===');
{
    check(dangerLevel(0) === 0, '0 → 不标');
    check(dangerLevel(44) === 0, '44 → 不标(低于留意线)');
    check(dangerLevel(45) === 1, '45 → 留意(边界取等)');
    check(dangerLevel(64) === 1, '64 → 留意');
    check(dangerLevel(65) === 2, '65 → 危险(边界取等)');
    check(dangerLevel(100) === 2, '100 → 危险');
    check(dangerLevel(-5) === 0, '负数不会溢出成档位');
}

// ==================== B. 角标与提示同源 ====================
console.log('\n=== B. 角标与提示同源(200 手对拍) ===');
{
    const rnd = makeRnd(20261026);
    let mismatchRanked = 0;
    let mismatchHint = 0;
    let compared = 0;
    for (let n = 0; n < 200; n++) {
        const hand: Tile[] = [];
        const count = 13 + (n % 2);
        for (let k = 0; k < count; k++) {
            hand.push(new Tile(n * 40 + k, SUITS[Math.floor(rnd() * 3)], 1 + Math.floor(rnd() * 9)));
        }
        if (HuChecker.isHu(hand, [])) continue;
        // 三家的弃牌用同一份随机流, 保证每手牌的威胁各不相同
        const discards: Tile[] = [];
        for (let k = 0; k < 6; k++) {
            discards.push(new Tile(n * 60 + k, SUITS[Math.floor(rnd() * 3)], 1 + Math.floor(rnd() * 9)));
        }
        const ctx = ctxOf(hand, threatOf(discards, n % 3 === 0));
        const map = AIBrain.dangerMap(ctx);

        for (const e of AIBrain.rankDiscards(ctx)) {
            compared++;
            if (e.danger !== map[tileIndexOf(e.tile.suit, e.tile.rank)]) mismatchRanked++;
        }
        const hint = HintAdvisor.discard(ctx);
        if (hint.best && hint.best.index >= 0) {
            const t = hand[hint.best.index];
            if (hint.best.danger !== map[tileIndexOf(t.suit, t.rank)]) mismatchHint++;
        }
    }
    check(compared > 1000, '对拍样本足够', String(compared));
    check(mismatchRanked === 0, 'rankDiscards 的 danger === dangerMap(同 source)', `不一致 ${mismatchRanked} 次`);
    check(mismatchHint === 0, '提示首选的 danger === dangerMap', `不一致 ${mismatchHint} 次`);
}

// ==================== C. 危险度反映公开信息 ====================
console.log('\n=== C. 危险度确实随公开信息变化 ===');
{
    const hand = makeHand(['m5', 'm5', 'm3', 'm4', 'm6', 't1', 't2', 't3', 'p1', 'p2', 'p3', 'f1', 'f2']);

    // (a) 现物: 该家打过五萬 → 五萬对他是 0(打出去绝不点炮)
    const nowTile = makeHand(['m5']);
    const ctxA = ctxOf(hand, threatOf(nowTile));
    check(AIBrain.dangerMap(ctxA)[tileIndexOf(TileSuit.WAN, 5)] === 0, '现物 → 危险度 0');

    // (b) 立直加压: 同一组弃牌, 宣告听牌后整体危险度必须升高
    const plain = makeHand(['t9', 'p9', 'f1', 'f1']);
    const baseCtx = ctxOf(hand, threatOf(plain, false));
    const riichiCtx = ctxOf(hand, threatOf(plain, true));
    const baseAvg = avgDanger(AIBrain.dangerMap(baseCtx));
    const riichiAvg = avgDanger(AIBrain.dangerMap(riichiCtx));
    check(riichiAvg > baseAvg, '宣告听牌后整体危险度上升', `${baseAvg.toFixed(1)} → ${riichiAvg.toFixed(1)}`);

    // (c) 断幺推断: 弃牌全是幺九/字牌 → 中张变危险、幺九反而安全
    const tanyaoDiscards = makeHand(['m1', 'm9', 't1', 'p9', 'f1', 'j1', 'm9']);
    const tanyaoCtx = ctxOf(hand, threatOf(tanyaoDiscards));
    const tmap = AIBrain.dangerMap(tanyaoCtx);
    check(tmap[tileIndexOf(TileSuit.WAN, 5)] >= 65, '断幺家的中张 → 危险档',
        String(tmap[tileIndexOf(TileSuit.WAN, 5)]));
    check(tmap[tileIndexOf(TileSuit.WAN, 1)] < 45, '断幺家的幺九 → 安全档',
        String(tmap[tileIndexOf(TileSuit.WAN, 1)]));

    // (d) 一致性: dangerAgainst 逐型结果与 dangerMap 在单家威胁下完全相同
    let sameAsDefense = true;
    const est = AIDefense.dangerAgainst(threatOf(plain, true), baseCtx.visible);
    const merged = AIBrain.dangerMap(riichiCtx);
    for (let i = 0; i < 34; i++) if (est[i].danger !== merged[i]) sameAsDefense = false;
    check(sameAsDefense, 'dangerMap 就是 AIDefense 的单家结果(没有二次加工)');
}

// ==================== D. 流局听牌口径 ====================
console.log('\n=== D. 流局听牌口径 ===');
{
    // 单钓五筒: 一二三万 四五六万 七八九万 一二三条 + 五筒 → 听 五筒
    const tenpai = makeHand(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 't1', 't2', 't3', 'p5']);
    const wait = HuChecker.isTenpai(tenpai, []);
    check(wait.length > 0, '13 张听牌手牌能算出听的牌', String(wait.length));
    check(wait.some(t => t.suit === TileSuit.TONG && t.rank === 5), '单钓算出来的是五筒');

    const text = HintAdvisor.waitingText(wait);
    check(text.length > 0 && text.indexOf('筒') >= 0, '听牌文案里带花色', text);

    // 胡牌局的手牌是 14 张: 再补一张枚举毫无意义(会算成 15 张), 所以 UI 只在流局调用
    const won = makeHand(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 't1', 't2', 't3', 'p5', 'p5']);
    check(HuChecker.isHu(won, []), '14 张的这手确实是胡牌(前置条件)');
    check(HuChecker.isTenpai(won, []).length === 0,
        '14 张手牌调 isTenpai 得不到有效结果(这就是只给流局用的原因)');

    // 副露手牌(10 张 + 1 个碰)也要能算 —— 流局时四家多半都有副露
    const ponTiles = makeHand(['p5', 'p5', 'p5']);
    const ponMeld = new Meld('pon', ponTiles, ponTiles[0], 1);
    const melded = makeHand(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 't1']);
    const meldWait = HuChecker.isTenpai(melded, [ponMeld]);
    check(meldWait.length > 0, '10 张手牌 + 1 个副露(碰)能算出听牌', String(meldWait.length));
    check(meldWait.some(t => t.suit === TileSuit.TIAO && t.rank === 1), '算出来的是单钓一条');
}

// ==================== E. 源码接线 ====================
console.log('\n=== E. 源码接线 ===');
{
    const has = (src: string, s: string): boolean => src.indexOf(s) >= 0;

    check(has(gmSrc, 'getHandDanger()') && has(gmSrc, 'AIBrain.dangerMap'),
        'GameManager 暴露 getHandDanger 且走 AIBrain.dangerMap');
    check(has(gmSrc, "this._phase !== GamePhase.PLAYER_TURN") && has(gmSrc, '_awaitingPlayerMeld'),
        'getHandDanger 只在玩家出牌阶段给值(别家回合/副露选择返回空)');

    check(has(mainSrc, 'getHandDanger()'), 'Main 取了危险度');
    check(has(mainSrc, 'view.setDanger(dangerLevel('), 'Main 把档位写到牌上(阈值走 dangerLevel)');
    check(has(mainSrc, 'danger[i] ?? 0') && has(mainSrc, 'danger[count - 1] ?? 0'),
        '普通手牌与"刚摸到的那张"都带上了危险度');

    check(has(tileSrc, 'drawDangerDot') && has(tileSrc, '_paintDanger'),
        'TileView 有角标绘制与补画入口');
    check(has(tileSrc, 'this._paintDanger();'), 'onEnable 里补画(原生 Graphics 隐藏后会丢)');
    check(has(tileSrc, 'mark.setSiblingIndex(this.node.children.length - 1)'),
        '角标画在牌面最上层(不被牌面/金框盖掉)');

    check(has(settleSrc, 'HuChecker.isTenpai(seat.hand, seat.melds)'),
        '结算面板自己算听牌(不需要 GameManager 传)');
    check(has(settleSrc, "data.kind === 'draw'"), '只在流局时算');
    check(has(settleSrc, 'showWaiting'), '流局开关传到了每一行');
    check(has(settleSrc, 'HintAdvisor.waitingText(waiting)'),
        '听牌文案复用同一套(与手牌上方的听牌芯片一致)');
}

// ==================== F. 几何不变量 ====================
console.log('\n=== F. 几何不变量 ===');
{
    // 角标必须**完全落在牌面内**: 越出边界会被牌身裁掉, 看起来像"牌上有个缺口"
    // 公式镜像 `TileView.drawDangerDot`: 内缩 17%、半径 10.5% / 7.5% + 外圈 2.6%
    const sizes: [number, number, string][] = [
        [91, 122, '手牌(手机)'],
        [100, 134, '手牌(平板)'],
        [52, 70, '副露牌'],
        [36, 48, '结算面板小牌'],
    ];
    let overflow = '';
    for (const [w, h, name] of sizes) {
        const short = Math.min(w, h);
        const inset = short * 0.17;
        const cx = w / 2 - inset;
        const cy = h / 2 - inset;
        const ring = short * 0.105 + Math.max(1.6, short * 0.026);
        if (cx + ring > w / 2 + 0.01 || cy + ring > h / 2 + 0.01) {
            overflow += `${name} `;
        }
    }
    check(overflow === '', '危险角标完全落在牌面内', overflow);

    // 四家手牌行: "听 X" 那格的左界必须让开手牌 + 满副露的右缘
    // 常量镜像 `SettlementPanel` 顶部那一组(改布局要同步改这里)
    const CARD_W = 1420;
    const ROW_HALF = (CARD_W - 80) / 2;
    const HAND_TILES_X = -ROW_HALF + 180;
    const HAND_TILE_W = 36;
    const MELD_TILE_W = 26;
    const MELD_GAP = 16;
    const SCORE_CX = ROW_HALF - 110;
    const WAIT_W = 200;
    const WAIT_FONT = 20;
    // 最坏情况: 14 张手牌 + 4 个杠(16 张副露)
    const tilesRight = HAND_TILES_X + 14 * HAND_TILE_W;
    const meldRight = tilesRight + MELD_GAP + 16 * MELD_TILE_W;
    const textLeft = SCORE_CX - WAIT_W / 2;
    check(textLeft - meldRight >= 8,
        '听牌文字的左界让开了满副露(净空 >= 8px)', `净空 ${(textLeft - meldRight).toFixed(1)}`);

    // 长文案必须能被截断到放得下 —— 否则 Label 的 SHRINK 会把字压成蚂蚁字
    // textWidth 与 `_fitWaitingText` 同口径(CJK 按字号, 数字/斜杠按半角)
    const textWidth = (text: string, font: number): number => {
        let sum = 0;
        for (const ch of text) sum += ch.codePointAt(0)! >= 0x2e80 ? font : font * 0.5;
        return sum;
    };
    const fit = (waiting: Tile[]): string => {
        let text = HintAdvisor.waitingText(waiting);
        if (textWidth(`听 ${text}`, WAIT_FONT) <= WAIT_W) return text;
        for (let n = waiting.length - 1; n >= 1; n--) {
            text = `${HintAdvisor.waitingText(waiting.slice(0, n))} 等`;
            if (textWidth(`听 ${text}`, WAIT_FONT) <= WAIT_W) return text;
        }
        return text;
    };

    // 最长的听牌形状: 国士无双的 13 面
    const thirteen = makeHand(['m1', 'm9', 't1', 't9', 'p1', 'p9', 'f1', 'f2', 'f3', 'f4', 'j1', 'j2', 'j3']);
    check(thirteen.length === 13, '国士 13 面手牌构造正确');
    const rawText = HintAdvisor.waitingText(thirteen);
    check(textWidth(`听 ${rawText}`, WAIT_FONT) > WAIT_W,
        '13 面听牌原样输出确实超宽(所以必须截断)', `${Math.round(textWidth(`听 ${rawText}`, WAIT_FONT))}px`);
    const fitted = fit(thirteen);
    check(textWidth(`听 ${fitted}`, WAIT_FONT) <= WAIT_W, '截断后能放进 200px',
        `${Math.round(textWidth(`听 ${fitted}`, WAIT_FONT))}px`);
    check(fitted.length > 0, '截断不会把文案削成空');

    // 常规 1~2 面听: 不该被截断(否则每次流局都多一个没必要的"等")
    const normal = makeHand(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 't1', 't2', 't3', 'p5']);
    const normalWait = HuChecker.isTenpai(normal, []);
    check(fit(normalWait) === HintAdvisor.waitingText(normalWait), '常规听牌不触发截断');

    // 结算面板每次打开要为四家各算一次, 不能卡住面板弹出
    const t0 = Date.now();
    const ROUNDS = 20;
    for (let i = 0; i < ROUNDS; i++) HuChecker.isTenpai(normal, []);
    const perCall = (Date.now() - t0) / ROUNDS;
    check(perCall < 20, `单家听牌计算 ${perCall.toFixed(2)}ms(四家一局 < 80ms)`);
}

console.log('');
if (failed === 0) {
    console.log('全部通过');
    process.exit(0);
}
console.log(`${failed} 项失败`);
process.exit(1);
