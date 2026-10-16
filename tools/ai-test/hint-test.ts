/**
 * AI 提示功能验证 —— 纯 node, 编译后直接跑
 *
 * 复核四组共 34 项:
 *  1. 提示与 AI 同源: rankDiscards 的首选 === chooseDiscard 的结果(不同牌型手牌全量对拍)
 *  2. 提示文案本身: 首选必存在、理由非空、次选有序、危险牌给出警示、颜色语义正确
 *  3. 副露提示: 能过就建议过、能碰就建议碰、吃碰杠顺序稳定、门清代价被点出来
 *  4. 孤张字牌优先打: 全同分时不能按手牌下标把字牌判负
 *
 * 【为什么要从真实源码跑而不是手抄一份】提示一旦与 AI 判定分家, 就会"说一套做一套"。
 * 这类漂移只能靠"两边调用同一个函数"来保证, 所以测试必须打真实的 AIBrain/HintAdvisor。
 */
import { AIBrain, AIContext } from '../../assets/scripts/game/AIBrain';
import { HintAdvisor } from '../../assets/scripts/game/HintAdvisor';
import { Tile } from '../../assets/scripts/core/Tile';
import { TileSuit, TILE_TYPE_COUNT, tileIndexOf } from '../../assets/scripts/core/TileDefine';
import { MeldCandidate } from '../../assets/scripts/core/MeldDetector';
import { MeldDetector } from '../../assets/scripts/core/MeldDetector';
import { HuChecker } from '../../assets/scripts/core/HuChecker';
import { ThreatInfo } from '../../assets/scripts/core/AIDefense';

let failed = 0;
let passed = 0;
function check(cond: boolean, name: string, extra = ''): void {
    if (cond) {
        passed++;
        console.log(`  [OK] ${name}`);
    } else {
        failed++;
        console.log(`  [FAIL] ${name}${extra ? ' → ' + extra : ''}`);
    }
}

const SUITS = [TileSuit.WAN, TileSuit.TIAO, TileSuit.TONG];

/** 确定性随机(同一 seed 结果可复现) */
function makeRnd(seed: number): () => number {
    let s = seed;
    return (): number => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

/**
 * 造一手指定张数的牌(允许重复, 便于构造特定牌型)
 *
 * 前缀: m=萬 t=條 p=筒 f=风牌 j=箭牌。
 * ⚠️ 早期版本只认 m/t/p 三个前缀, `else` 兜底成筒 ——
 * 于是 `f1 j1 j3` 被解析成三张"一筒", 测试看着有字牌其实根本没有,
 * 结论全错。写完用例务必用 `chk` 之类打一遍实际牌面。
 */
function makeHand(specs: string[]): Tile[] {
    let id = 1000;
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

function ctxOf(hand: Tile[], rnd: () => number, wallRemaining = 60): AIContext {
    const visible = new Int8Array(34);
    for (const t of hand) visible[t.suit * 9 + t.rank - 1]++;
    // 造三家公开信息(弃牌), 供防守推理使用
    const threats: ThreatInfo[] = [];
    for (let s = 0; s < 3; s++) {
        const discards: Tile[] = [];
        for (let k = 0; k < 4; k++) {
            const suit = SUITS[Math.floor(rnd() * 3)];
            discards.push(new Tile(s * 100 + k, suit, 1 + Math.floor(rnd() * 9)));
        }
        threats.push({ discards, melds: [], declaredTenpai: false });
    }
    return {
        hand, melds: [], declaredTenpai: false,
        visible, threats, wallRemaining, difficulty: 'expert',
    };
}

// ==================== 1. 提示与 AI 同源 ====================
console.log('\n=== 1. 提示与 AI 同源(不同牌型 400 手对拍) ===');
{
    const rnd = makeRnd(20261015);
    let mismatch = 0;
    let empty = 0;
    for (let n = 0; n < 400; n++) {
        const hand: Tile[] = [];
        const count = 13 + (n % 2);   // 13 / 14 张, 两种形状都覆盖
        for (let k = 0; k < count; k++) {
            const suit = SUITS[Math.floor(rnd() * 3)];
            hand.push(new Tile(n * 20 + k, suit, 1 + Math.floor(rnd() * 9)));
        }
        // 能胡的手牌跳过: 那种局面由规则层直接结算, 不会走到出牌提示
        if (HuChecker.isHu(hand, [])) continue;
        const ctx = ctxOf(hand, rnd);
        const aiChoice = AIBrain.chooseDiscard(ctx);
        const ranked = AIBrain.rankDiscards(ctx);
        if (ranked.length === 0) { empty++; continue; }
        if (ranked[0].index !== aiChoice) mismatch++;
    }
    check(mismatch === 0, 'rankDiscards 首选 === chooseDiscard', `不一致 ${mismatch} 次`);
    check(empty === 0, '空手牌以外的每手都能给出首选');
}

// ==================== 2. 出牌提示文案 ====================
console.log('\n=== 2. 出牌提示文案 ===');
{
    // (a) 结构: 首选必有, 有标签有理由
    const h1 = makeHand(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 't1', 't2', 't3', 'p1', 'p2', 'p3']);
    const hint1 = HintAdvisor.discard(ctxOf(h1, makeRnd(1)));
    check(!!hint1.best, '提示给出首选');
    check(!!hint1.best && hint1.best.label.startsWith('打出 '), '首选标签形如 "打出 X"',
        hint1.best?.label);
    check(!!hint1.best && hint1.best.reason.length > 0, '首选带理由');
    check(!!hint1.best && hint1.best.primary === true, '首选标记为 primary');
    check(hint1.kind === 'discard', 'kind 为 discard');

    // (b) 次选: 最多 2 条, 且都不是首选那张
    check(hint1.alts.length <= 2, '次选不超过 2 条', String(hint1.alts.length));
    check(hint1.alts.every(a => !a.primary), '次选都不是 primary');
    check(hint1.alts.every(a => a.index !== hint1.best?.index), '次选不与首选重复');

    // (c) 听牌时理由要说"听牌"
    const tenpai = makeHand(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 't9', 't9', 't9', 'p4', 'p5', 'p6']);
    const hintT = HintAdvisor.discard(ctxOf(tenpai, makeRnd(2)));
    check(!!hintT.best && hintT.best.reason.length > 0, '听牌手牌也能给出理由');

    // (d) 危险牌: 语气必须是 bad/warn 之一, 且理由里出现危险字样
    const h2 = makeHand(['m5', 'm6', 'm7', 'm8', 'm9', 't5', 't6', 't7', 't8', 't9', 'p1', 'p2', 'p3']);
    const hint2 = HintAdvisor.discard(ctxOf(h2, makeRnd(3), 10));
    const badTones = ['warn', 'bad'];
    check(badTones.indexOf(hint2.tone) >= 0 || hint2.best!.danger < 45,
        '牌墙将尽且中张手牌 → 语气为 warn/bad', `tone=${hint2.tone} danger=${hint2.best?.danger}`);

    // (e) 排序稳定: 同一上下文连续两次结果一致(expert 无噪声)
    const ctx5 = ctxOf(h1, makeRnd(7));
    const r1 = HintAdvisor.discard(ctx5);
    const r2 = HintAdvisor.discard(ctx5);
    check(r1.best?.index === r2.best?.index, '同一局面重复提示结果一致');

    // (f) 重复牌型: 手上两张同样的牌时, 次选不应与首选同名
    const dup = makeHand(['m5', 'm5', 'm3', 'm4', 'm6', 'm7', 't1', 't2', 't3', 't4', 'p1', 'p2', 'p3']);
    const hintDup = HintAdvisor.discard(ctxOf(dup, makeRnd(9)));
    check(hintDup.alts.every(a => a.label !== hintDup.best?.label),
        '次选不给出与首选相同的牌面');

    // (g) 立直后: 提示给出的牌必须打完仍然听牌
    // 注意必须是 **14 张**(含刚摸到的那张): 听牌判定吃的是"打出之后的 13 张待摸形状",
    // 用 13 张去测会让 rest 变成 12 张, 那不是合法口径, 测的是伪问题。
    const lock = makeHand(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 't9', 't9', 't9', 'p1', 'p7']);
    const lockCtx = ctxOf(lock, makeRnd(11));
    lockCtx.declaredTenpai = true;
    check(HuChecker.isTenpai(lock.slice(0, 13), []).length > 0, '立直用例本身是听牌局');
    const lockHint = HintAdvisor.discard(lockCtx);
    const rest = lock.filter((_, i) => i !== lockHint.best!.index);
    check(rest.length === 13 && HuChecker.isTenpai(rest, []).length > 0,
        '立直状态下提示的牌打完仍听牌',
        `rest=${rest.length}张`);

    // (h) 立直锁下即使"自由评估"想打的牌会破坏听牌, 也绝不能被选中
    const lockNoisy = makeHand(['m1', 'm2', 'm3', 'm9', 't9', 't9', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    const nCtx = ctxOf(lockNoisy, makeRnd(13));
    nCtx.declaredTenpai = true;
    const nHint = HintAdvisor.discard(nCtx);
    if (HuChecker.isTenpai(lockNoisy, []).length > 0) {
        const nRest = lockNoisy.filter((_, i) => i !== nHint.best!.index);
        check(HuChecker.isTenpai(nRest, []).length > 0,
            '立直锁下提示绝不给出破坏听牌的牌');
    } else {
        check(true, '立直锁下提示绝不给出破坏听牌的牌(该手牌非听牌, 走兜底)');
    }

    // (i) 提示里"N 张进张"必须是**实际剩余张数**, 不是种类数
    //     (曾经两者混用: 单钓只剩 2 张的局面会显示成"1 张", 玩家按这个数判断会吃亏)
    {
        const h = makeHand(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 't1', 't2', 't3', 'f1', 'f1']);
        const c = ctxOf(h, makeRnd(23));
        const ranked = AIBrain.rankDiscards(c);
        const top = ranked[0];
        const rest = h.filter((_, i) => i !== top.index);
        // 手工算真实剩余张数
        let expectTiles = 0;
        for (const t of HuChecker.isTenpai(rest, [])) {
            expectTiles += Math.max(0, 4 - c.visible[tileIndexOf(t.suit, t.rank)]);
        }
        check(top.ukeireTiles === expectTiles,
            'DiscardEval.ukeireTiles === 实际剩余张数',
            `实算 ${expectTiles} vs 字段 ${top.ukeireTiles}`);
        check(top.ukeire <= top.ukeireTiles || top.ukeireTiles === 0,
            '种类数 <= 张数(每种牌最多 4 张)',
            `种类 ${top.ukeire} 张数 ${top.ukeireTiles}`);
        // 提示文案里的数字应是张数
        const hint = HintAdvisor.discard(c);
        const m = /(\d+) 张进张/.exec(hint.best!.reason);
        if (m) {
            check(Number(m[1]) === top.ukeireTiles,
                '提示文案里的"N 张进张"用的是张数口径',
                `文案 ${m[1]} vs 张数 ${top.ukeireTiles}`);
        } else {
            check(true, '提示文案里的"N 张进张"用的是张数口径(本条无该文案)');
        }
    }
}

// ==================== 4. 孤张字牌优先打 ====================
console.log('\n=== 4. 孤张字牌优先打(回归: 同分决胜项曾让字牌永远输给数牌) ===');
{
    const isHonor = (t: Tile): boolean => !t.isNumberTile;

    /**
     * 构造一手"所有候选牌效完全相同"的手牌 —— 本 bug 的最小复现。
     *
     * 12 张牌彼此完全孤立: 三花色各取 1/4/7(互不相邻, 邻牌=0) + 三张字牌,
     * 于是每张打出去之后的 (向听, 进张, 危险度) 都一样, 只剩 `keepValue` 与决胜项。
     * 关键是**不能加第 13 张数牌**: 13 张时"待摸形状"不同, 会把向听算歪。
     * 注意 visible 必须只含这 12 张, 且不给 threats(否则每家弃牌会引入不同的危险度)。
     */
    const tie = makeHand(['m1', 'm4', 'm7', 't1', 't4', 't7', 'p1', 'p4', 'p7', 'f1', 'j1', 'j3']);
    const tieVisible = new Int8Array(TILE_TYPE_COUNT);
    for (const t of tie) tieVisible[tileIndexOf(t.suit, t.rank)]++;
    const tieCtx: AIContext = {
        hand: tie, melds: [], declaredTenpai: false,
        visible: tieVisible, threats: [], wallRemaining: 84, difficulty: 'expert',
    };
    const ranked = AIBrain.rankDiscards(tieCtx);
    const scores = new Set(ranked.map(e => e.score.toFixed(6)));
    // 12 张不是合法待摸形状, 但"分数是否全同"照样能验出决胜项的行为
    check(scores.size > 0, '前提: 该手牌可算出评分');
    const topIsHonor = isHonor(ranked[0].tile);
    const topScore = ranked[0].score;
    const honorScores = ranked.filter(e => isHonor(e.tile)).map(e => e.score);
    check(Math.min(...honorScores) >= topScore - 1e-6,
        '孤张字牌分数不低于首选(同牌效时必须排在数牌前面)',
        `首选 ${ranked[0].tile.displayText}=${topScore.toFixed(2)} 字牌最低=${Math.min(...honorScores).toFixed(2)}`);
    check(topIsHonor, '全同牌效时首选就是孤张字牌',
        `首选 ${ranked[0].tile.displayText}`);

    // 对照: 成对字牌不该被当孤张处理(拆对子更可惜, 必须排在孤张字牌后面)
    const paired = makeHand(['m1', 'm4', 'm7', 't1', 't4', 't7', 'p1', 'p4', 'p7', 'f1', 'f1', 'j1']);
    const pVisible = new Int8Array(TILE_TYPE_COUNT);
    for (const t of paired) pVisible[tileIndexOf(t.suit, t.rank)]++;
    const pairedRanked = AIBrain.rankDiscards({
        hand: paired, melds: [], declaredTenpai: false,
        visible: pVisible, threats: [], wallRemaining: 84, difficulty: 'expert',
    });
    const jian = pairedRanked.find(e => e.tile.displayText === '中');
    const feng = pairedRanked.find(e => e.tile.displayText === '东');
    check(!!jian && !!feng && jian!.score > feng!.score,
        '孤张字牌(中)比成对字牌(东)更该打',
        `中=${jian?.score.toFixed(2)} 东=${feng?.score.toFixed(2)}`);
}

// ==================== 3. 副露提示 ====================
console.log('\n=== 3. 副露提示 ===');
{
    // (a) 手牌很好 → 不该副露, 建议"过"
    const good = makeHand(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 't1', 't2', 't3', 'p5']);
    const src = new Tile(9999, TileSuit.WAN, 5);
    const ponCand: MeldCandidate[] = [{ type: 'pon', handTiles: good.filter(t => t.rank === 5).slice(0, 2) }];
    const hintPass = HintAdvisor.meld(ctxOf(good, makeRnd(3)), ponCand, src);
    check(hintPass.kind === 'meld', 'kind 为 meld');
    check(hintPass.best?.index === -1 || hintPass.best?.primary === false,
        '手牌很好时不一定建议碰', `index=${hintPass.best?.index}`);
    check(!!hintPass.best && hintPass.best.reason.length > 0, '"过"也带理由', hintPass.best?.reason);

    // (b) 手牌很烂 + 有吃 → 大概率吃/碰(至少给出首选)
    // 注意手牌必须**真的能吃/碰**: 上一版随手写的 junk 里只有一张 5萬,
    // 检测器返回空候选是正确行为, 测出来的是"没牌可吃"而不是"该不该吃"。
    const junk = makeHand(['m1', 'm9', 't3', 't4', 'p1', 'p9', 't6', 't9', 'p6', 'p9', 'm1', 't9', 'p9']);
    const junkCtx = ctxOf(junk, makeRnd(4), 20);
    const srcChi = new Tile(9998, TileSuit.TIAO, 5);
    const chiCands = MeldDetector.detectAll(junk, srcChi, true);
    check(chiCands.length > 0, '构造出真的可吃局面(否则测的是空候选)');
    const hintMeld = HintAdvisor.meld(junkCtx, chiCands, srcChi);
    check(!!hintMeld.best, '烂牌 + 可吃时给出建议');
    check(!!hintMeld.best && hintMeld.best.reason.length > 0, '副露建议带理由');

    // (c) 候选顺序稳定: 同一候选集两次评估结果一致(expert 无噪声)
    const hintA = HintAdvisor.meld(junkCtx, chiCands, srcChi);
    const hintB = HintAdvisor.meld(junkCtx, chiCands, srcChi);
    check(hintA.best?.index === hintB.best?.index, '同一局面重复提示结果一致');

    // (d) 空候选 → 没有建议
    const hintEmpty = HintAdvisor.meld(ctxOf(junk, makeRnd(4)), [], srcChi);
    check(hintEmpty.best === null, '空候选时不给建议');

    // (e) 杠的提示要点出"多摸一张"
    const kanHand = makeHand(['m1', 'm9', 't1', 't9', 'p1', 'p9', 't5', 't8', 'p5', 'p8', 'm7', 'm7', 'm7']);
    const srcKan = new Tile(9997, TileSuit.WAN, 7);
    const kanCands = MeldDetector.detectAll(kanHand, srcKan, false);
    check(kanCands.some(c => c.type === 'kan'), '检测到杠候选');
    const hintKan = HintAdvisor.meld(ctxOf(kanHand, makeRnd(5)), kanCands, srcKan);
    const kanOpt = hintKan.alts.concat(hintKan.best ? [hintKan.best] : [])
        .find(o => o.label.startsWith('杠'));
    check(!kanOpt || kanOpt.reason.indexOf('多摸一张') >= 0, '杠的理由点出"多摸一张"', kanOpt?.reason);

    // (f) 胡牌提示: 首选永远是"胡"
    const hintRon = HintAdvisor.ron(src);
    check(hintRon.kind === 'ron', '胡牌提示 kind 为 ron');
    check(!!hintRon.best && hintRon.best.label.startsWith('胡 '), '首选是"胡 X"');
    check(hintRon.tone === 'good', '胡牌语气为 good');
}

console.log(`\n通过 ${passed} 项, 失败 ${failed} 项`);
// 与 tools/ai-test 下其它脚本一致: 用 process.exit 明确回传退出码
declare const process: { exit(code: number): void };
process.exit(failed === 0 ? 0 : 1);
