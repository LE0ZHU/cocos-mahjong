/**
 * 跨会话战绩 + AI 拟人化 校验
 *
 * 两组:
 *  A. 纯逻辑(编译真实源码后跑): 生涯统计的累加口径、存档编解码与"脏数据"防御、
 *     AI 名字与台词的完整性
 *  B. 源码级接线: 战绩在什么时候落盘/恢复/清档、台词在哪里触发、UI 有没有真的接上
 *
 * 【为什么连接线也要机器查】这类改动最容易"写了一半": 统计算对了但没落盘、
 * 落盘了但没恢复、台词抽出来了但 UI 没接 —— 三种都不会报错, 只是功能安静地不存在。
 * 尤其"气泡在结算面板打开时不显示"这条, 手动点一遍很难注意到(面板盖住了, 看不见
 * 就是"没发生")。
 */
declare const require: (m: string) => any;
declare const __dirname: string;
declare const process: { exit(code: number): never };
const fs = require('fs');
const path = require('path');

import {
    EMPTY_CAREER, SEAT_COUNT, applyOutcome, careerText, decodeCareerData,
    encodeCareerData, sanitizeCareer, sanitizeSession,
} from '../../assets/scripts/game/CareerStats';
import {
    AI_PERSONAS, SPEECH_KINDS, SPEECH_MAX_LEN, aiName, speechLine,
} from '../../assets/scripts/game/AIPersona';

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
const menuSrc = fs.readFileSync(findFile('assets/scripts/ui/MenuUI.ts'), 'utf8');
const settleSrc = fs.readFileSync(findFile('assets/scripts/ui/SettlementPanel.ts'), 'utf8');
const huScoreSrc = fs.readFileSync(findFile('assets/scripts/core/HuScore.ts'), 'utf8');
const storeSrc = fs.readFileSync(findFile('assets/scripts/game/CareerStore.ts'), 'utf8');

let fails = 0;
function check(cond: boolean, name: string, extra = ''): void {
    if (cond) console.log(`  [OK] ${name}`);
    else { fails++; console.log(`  [FAIL] ${name}${extra ? ' → ' + extra : ''}`); }
}

/** 取某个方法的方法体(先去注释, 免得注释里同名的方法名命中在前) */
function methodBody(src: string, sig: string): string {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const i = code.indexOf(sig);
    if (i < 0) return '';
    let depth = 0;
    let started = false;
    for (let j = i; j < code.length; j++) {
        const ch = code[j];
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') {
            depth--;
            if (started && depth === 0) return code.slice(code.indexOf('{', i), j + 1);
        }
    }
    return '';
}

console.log('\n=== 跨会话战绩 + AI 拟人化 ===\n');

// ---------------------------------------------------------------- A1
console.log('[A1] 生涯统计的累加口径');
{
    const c0 = { ...EMPTY_CAREER };
    // 流局: 局数 +1, 胡牌次数与最高番不动(没胡不该把纪录刷成 0)
    const c1 = applyOutcome(c0, { playerHu: false, fan: 0, streak: 0 });
    check(c1.games === 1 && c1.hu === 0 && c1.bestFan === 0 && c1.bestStreak === 0,
        '流局只涨局数', JSON.stringify(c1));
    // 胡: 次数 +1, 最高番取本次, 最长连庄取本次
    const c2 = applyOutcome(c1, { playerHu: true, fan: 4, streak: 1 });
    check(c2.games === 2 && c2.hu === 1 && c2.bestFan === 4 && c2.bestStreak === 1,
        '胡牌涨次数/最高番/连庄', JSON.stringify(c2));
    // 连庄 3 次后没胡: 局数继续涨, 最高连庄保持
    const c3 = applyOutcome(c2, { playerHu: true, fan: 2, streak: 3 });
    const c4 = applyOutcome(c3, { playerHu: false, fan: 0, streak: 0 });
    check(c4.games === 4 && c4.bestStreak === 3 && c4.bestFan === 4,
        '断庄不拉低历史纪录', JSON.stringify(c4));
    // 纯函数: 不改入参
    check(c0.games === 0 && c3.bestStreak === 3, 'applyOutcome 不改入参');
}

// ---------------------------------------------------------------- A2
console.log('\n[A2] 存档编解码与脏数据防御');
{
    const c = { games: 12, hu: 5, bestFan: 6, bestStreak: 3 };
    const s = { scores: [10, -4, 2, -8], streaks: [2, 0, 0, 1] };
    const back = decodeCareerData(encodeCareerData({ career: c, session: s }));
    check(!!back && back.career.games === 12 && back.career.bestFan === 6, '编码 → 解码 往返一致');
    check(!!back && !!back.session && back.session.scores.join() === '10,-4,2,-8', '比分快照往返一致');
    check(decodeCareerData('') === null, '空串 → null(按"没存档"处理)');
    check(decodeCareerData('{坏掉的 json') === null, '坏 JSON → null(不抛异常)');
    check(decodeCareerData('null') === null, 'null 字面量 → null');

    // 手改过的存档: 负数 / 小数 / 缺元素 / 全垃圾
    const junk = sanitizeCareer({ games: -3, hu: 2.7, bestFan: 'x', bestStreak: null });
    check(junk.games === 0 && junk.hu === 2 && junk.bestFan === 0 && junk.bestStreak === 0,
        '生涯: 负数夹到 0、小数取整、非数字归 0', JSON.stringify(junk));
    check(JSON.stringify(sanitizeCareer(undefined)) === JSON.stringify(EMPTY_CAREER), '生涯: 非对象 → 空战绩');
    const bad = sanitizeSession({ scores: [1, 2], streaks: [] });
    check(!!bad && bad.scores.length === SEAT_COUNT && bad.streaks.length === SEAT_COUNT,
        '会话: 缺元素补齐到四家(少了会让 scores[3] 变 NaN)', JSON.stringify(bad));
    check(sanitizeSession({ scores: 1, streaks: 2 }) === null, '会话: 字段不是数组 → null');
    check(sanitizeSession(null) === null, '会话: null → null');
}

// ---------------------------------------------------------------- A3
console.log('\n[A3] AI 名字与台词');
{
    const names = [1, 2, 3].map(aiName);
    check(names.every(n => /^[一-龥]{2}$/.test(n)), `三家名字都是两个汉字: ${names.join('/')}`,
        '改名字时务必保持两字 —— 比分条四枚芯片与"xx·听"标记是按"上家/左家/右家"的宽度排的');
    check(new Set(names).size === 3, '三家名字互不相同');
    check(aiName(0) === '' && aiName(9) === '', '座位 0(玩家)与越界都没有名字');

    let allK = 0;
    let tooLong = '';
    for (let seat = 1; seat <= 3; seat++) {
        for (const kind of SPEECH_KINDS) {
            allK++;
            const line = speechLine(seat, kind, 0.5);
            if (!line) { check(false, `座位${seat} 的 ${kind} 有台词`); continue; }
            if ([...line].length > SPEECH_MAX_LEN) tooLong += `${seat}/${kind}:${line} `;
        }
    }
    check(allK === 3 * SPEECH_KINDS.length, `遍历了 ${allK} 组(座位 × 场合)`);
    check(tooLong === '', '台词都不超过长度上限(长了会撑破气泡)', tooLong);
    check(speechLine(1, 'pon', 0) === AI_PERSONAS[1]!.pon[0], 'rnd=0 → 第一条');
    check(speechLine(1, 'pon', 0.999) === AI_PERSONAS[1]!.pon[AI_PERSONAS[1]!.pon.length - 1],
        'rnd→1 → 最后一条');
    check(speechLine(1, 'pon', -5) === AI_PERSONAS[1]!.pon[0]
        && speechLine(1, 'pon', 99) === AI_PERSONAS[1]!.pon[AI_PERSONAS[1]!.pon.length - 1],
        '越界的 rnd 被夹住(不会取到 undefined)');
    check(speechLine(0, 'pon', 0.5) === '' && speechLine(9, 'pon', 0.5) === '',
        '玩家座位与越界座位没有台词');
    // 三家同一场合的说法必须不同 —— 玩家靠措辞就能分清是谁在说话
    for (const kind of SPEECH_KINDS) {
        const set = new Set([1, 2, 3].map(s => speechLine(s, kind, 0)));
        check(set.size === 3, `${kind}: 三家说法各不相同`, [...set].join(' / '));
    }
    console.log(`  生涯文案样例: ${careerText({ games: 12, hu: 5, bestFan: 6, bestStreak: 3 })}`);
}

// ---------------------------------------------------------------- B1
console.log('\n[B1] 战绩: 落盘 / 恢复 / 清档的接线');
{
    const endGame = methodBody(gmSrc, 'private _endGame(');
    check(endGame.includes('CAREER.recordGame'), '_endGame 里写生涯统计与比分快照');
    // 必须在推给 UI 之前: 结算面板显示的就是更新后的生涯数据
    const iRecord = endGame.indexOf('CAREER.recordGame');
    const iSettle = endGame.indexOf('this.onSettle?.(');
    check(iRecord > 0 && iSettle > 0 && iRecord < iSettle, '落盘在 onSettle 之前(面板显示的是最新值)');
    check(/playerHu:\s*!!myWin/.test(endGame), '胡牌次数按"玩家有没有胡"记');
    check(/streak:\s*this\._streaks\[0\]/.test(endGame), '最高连庄取更新后的连庄次数');

    const stop = methodBody(gmSrc, 'stopGame(): void {');
    check(stop.includes('CAREER.clearSession'), 'stopGame(返回主页面)清掉会话快照');
    check(/this\._scores\s*=\s*\[0, 0, 0, 0\]/.test(stop), 'stopGame 同时把内存里的比分清零');

    const onLoad = methodBody(gmSrc, 'onLoad(): void {');
    check(onLoad.includes('_restoreSession'), 'onLoad 里尝试恢复上次没打完的比分');
    const startGame = methodBody(gmSrc, 'startGame(');
    check(startGame.includes('_restoreSession'), 'startGame 里再试一次(原生平台存档是异步就绪的)');
    const restore = methodBody(gmSrc, 'private _restoreSession(');
    check(restore.includes('CAREER.session'), '恢复读的是存档里的会话快照');
    check(/if\s*\(\s*this\._sessionRestored\s*\)\s*return/.test(restore), '恢复只做一次');
    check(restore.includes('some(v => v !== 0)'), '已经打过局的会话不被存档覆盖');

    // 原生平台 sys.localStorage 是**异步**就绪的: 没就绪时只读不写, 否则会用
    // 内存里的空战绩覆盖真存档(历史成绩静默丢失, 且没有任何报错)
    check(storeSrc.includes('private _ready()'), '存档区分"存储就绪"与"有数据"');
    const ensure = methodBody(storeSrc, 'private _ensureLoaded(');
    check(/if \(!s\) return/.test(ensure), '存储没就绪时不标记已读(下次访问还会再试)');
    const save = methodBody(storeSrc, 'private _save(');
    check(/if \(!s\) return/.test(save), '存储没就绪时不写盘(免得用空值覆盖真存档)');
    check(!/sys\.localStorage\s*\?\./.test(save), '写盘走 _ready() 的统一守卫');
}

// ---------------------------------------------------------------- B2
console.log('\n[B2] AI 台词: 触发点与 UI 接线');
{
    check(gmSrc.includes('onAISpeech:'), 'GameManager 声明了 onAISpeech 回调');
    const doMeld = methodBody(gmSrc, 'private _doMeld(');
    check(/_fireSpeech\(seat, meld\.type\)/.test(doMeld), '_doMeld 里给碰/杠配台词');
    check(doMeld.includes("meld.type === 'pon' || meld.type === 'kan'"), '吃不给台词(频率太高会成噪音)');
    const upgrade = methodBody(gmSrc, 'private _upgradeToKan(');
    check(upgrade.includes("_fireSpeech(seat, 'kan')"), '续杠也说话');
    const fireSpeech = methodBody(gmSrc, 'private _fireSpeech(');
    check(fireSpeech.includes('if (seat === 0) return'), '玩家自己不会自言自语');

    // 胡牌/点炮的台词随结算数据走(牌桌那时已被遮罩盖住)
    const finishHu = methodBody(gmSrc, 'private _finishWithHu(');
    check(finishHu.includes("w.isSelfDraw ? 'tsumo' : 'ron'"), '自摸与吃胡是两套说法');
    check(/payerSeat > 0/.test(finishHu) && finishHu.includes("'deal'"), '点炮的那家也有台词');
    check(finishHu.includes('lines.slice(0, 2)'), '台词最多两句(多了会压到分隔线)');
    check(huScoreSrc.includes('speech?: string'), 'SettlementData 带 speech 字段');

    // Main 侧
    check(/gm\.onAISpeech\s*=/.test(mainSrc), 'Main 接上了 onAISpeech');
    const show = methodBody(mainSrc, 'private _showAISpeech(');
    check(show.includes('this._settlement?.isOpen'), '结算面板开着时不冒气泡(那句台词在面板里)');
    check(show.includes('seatLabel(seat)'), '气泡带上名字(牌桌没有常驻名字牌)');
    const update = methodBody(mainSrc, 'update(dt: number): void {');
    check(update.includes('_updateAISpeech(dt)'), 'update 里推进气泡的停留/淡出');
    const clear = methodBody(mainSrc, 'private _clearTable(');
    check(clear.includes('_hideAISpeech'), '清牌桌时收起气泡');
    check(/this\._aiBubbleHold\s*=\s*\[0, 0, 0\]/.test(clear), '_clearTable 归零气泡计时( _aiBubbleHold )');
    check(/this\._aiBubbleFade\s*=\s*\[0, 0, 0\]/.test(clear), '_clearTable 归零气泡计时( _aiBubbleFade )');
    check(mainSrc.includes('_aiBubblePos[0].set(0, topHandY, 0)'), '气泡位置随可见高度重排(不写死 y)');
}

// ---------------------------------------------------------------- B3
console.log('\n[B3] 战绩的展示');
{
    check(/this\._refreshCareer\(\)/.test(menuSrc), '主菜单显示时刷新生涯战绩');
    const showHome = methodBody(menuSrc, 'showHome(): void {');
    check(showHome.includes('_refreshCareer'), 'showHome 里刷新(打完一局回菜单就能看到)');
    check(menuSrc.includes('careerText(CAREER.career)'), '菜单与结算面板共用同一份文案');
    check(settleSrc.includes('data.speech'), '结算面板渲染本局台词');
    check(settleSrc.includes('careerText(CAREER.career)'), '结算面板渲染生涯战绩');
    check(/const H_CAREER = \d+/.test(settleSrc) && /GAP_CAREER/.test(settleSrc),
        '生涯行进了纵向排版(不是叠在别的东西上)');
    const layout = methodBody(settleSrc, 'private static _computeLayout(');
    check(layout.includes('GAP_CAREER + H_CAREER'), '生涯行计入内容高度');
    check(/careerY = y - H_CAREER \/ 2/.test(layout) && /y -= H_CAREER \+ GAP_BUTTON/.test(layout),
        '生涯行按"游标 = 上一段底边"的写法排(硬约束 3)');
    // 比分条用名字而不是方位词
    const strip = methodBody(mainSrc, 'private _refreshScoreStrip(');
    check(strip.includes('seatLabel(s)') && !strip.includes('SEAT_NAMES'), '比分条用 AI 名字');
    // 2026-10-17 起四角"xx·听"小牌已并入座位名牌(名字后面加"·听"),
    // 只剩玩家自己的标记还用 createTenpaiChip(玩家没有名牌)
    check(mainSrc.includes('createTenpaiChip(seatLabel(0))'), '"听"标记只剩玩家的, 且用 seatLabel 出名字');
}

// ---------------------------------------------------------------- B4
// 气泡是**浮在牌面上**的东西: 光看代码算不出它压到了什么, 跑数字才看得见
// (AGENTS.md 验证工作流: 各分辨率不溢出 / 元素不撞车)。
console.log('\n[B4] AI 台词气泡的落位(按最坏情况算)');
{
    function num(src: string, name: string): number {
        const patterns = [
            new RegExp(`const\\s+${name}\\s*(?::[^=]*)?=\\s*(-?[\\d.]+)`),
            new RegExp(`readonly\\s+${name}\\s*(?::[^=]*)?=\\s*(-?[\\d.]+)`),
        ];
        for (const re of patterns) {
            const m = re.exec(src);
            if (m) return Number(m[1]);
        }
        throw new Error(`源码里找不到常量 ${name}`);
    }
    const FONT = num(mainSrc, 'SPEECH_FONT');
    const BH = num(mainSrc, 'SPEECH_H');
    const PAD = num(mainSrc, 'SPEECH_PAD');
    const SIDE_DX = num(mainSrc, 'SPEECH_SIDE_DX');
    const HALF_W = num(mainSrc, 'CONTENT_W') / 2;
    const HAND_SCALE = num(mainSrc, 'HAND_SCALE');
    const TILE_W = num(mainSrc, 'BASE_TILE_W') * HAND_SCALE;
    const TILE_H = num(mainSrc, 'BASE_TILE_H') * HAND_SCALE;
    const TOP_W = num(mainSrc, 'BASE_TOP_TILE_W');
    const RIVER_W = num(mainSrc, 'BASE_RIVER_TILE_W');
    const RIVER_GAP = num(mainSrc, 'RIVER_GAP');
    const SIDE_COLS = num(mainSrc, 'SIDE_RIVER_COLS');
    const MELD_GAP = num(mainSrc, 'MELD_MARK_GAP');
    // AI_LAYOUT 的三行: 手牌 x / 弃牌河 x(按顺序取)
    const hxs = (mainSrc.match(/hx:\s*(-?\d+)/g) ?? []).map(s => Number(s.replace(/[^\d-]/g, '')));
    const dxs = (mainSrc.match(/dx:\s*(-?\d+)/g) ?? []).map(s => Number(s.replace(/[^\d-]/g, '')));
    check(hxs.length === 3 && dxs.length === 3, `取到三家的手牌/牌河 x: ${hxs.join()} | ${dxs.join()}`);

    // 桌面侧边倾角(与 _buildTable 的几何推导一致)
    const TILT = Math.atan2(786 - 786 * 0.78, 526 + 526 * (530 / 560));
    const rivH = (RIVER_W * TILE_H) / TILE_W;
    const topH = (TOP_W * TILE_H) / TILE_W;
    const meldH = rivH;

    /** 最坏情况的气泡宽度: 名字 + 最长的一句台词 */
    let worstW = 0;
    let worstText = '';
    for (let seat = 1; seat <= 3; seat++) {
        for (const kind of SPEECH_KINDS) {
            const pool = AI_PERSONAS[seat]![kind];
            for (const line of pool) {
                const t = `${aiName(seat)}：${line}`;
                let w = PAD * 2;
                for (const ch of t) w += ch.codePointAt(0)! >= 0x2e80 ? FONT : FONT * 0.5;
                if (w > worstW) { worstW = w; worstText = t; }
            }
        }
    }
    console.log(`  最宽的一句: "${worstText}" → ${Math.ceil(worstW)}px`);

    // 各家可见半高(硬约束 2): 21:9 最扁, 是最坏情况
    for (const halfH of [472, 387, 360]) {
        const topHandY = halfH - 8 - topH / 2;
        // 上家气泡: 完整在可见区内, 且不压到上家的副露行
        const topBubbleTop = topHandY + BH / 2;
        const topMeldTop = topHandY - topH / 2 - meldH / 2 - MELD_GAP + meldH / 2;
        check(topBubbleTop <= halfH, `半高 ${halfH}: 上家气泡不出可见上沿(${topBubbleTop.toFixed(1)} ≤ ${halfH})`);
        check(topHandY - BH / 2 > topMeldTop,
            `半高 ${halfH}: 上家气泡不压副露行(${(topHandY - BH / 2).toFixed(1)} > ${topMeldTop.toFixed(1)})`);

        // 左右家气泡: 完整在屏幕内, 且让开自己的弃牌河(残局第三排)
        for (const i of [1, 2]) {
            const cx = hxs[i] + (i === 1 ? -SIDE_DX : SIDE_DX);
            const left = cx - worstW / 2;
            const right = cx + worstW / 2;
            check(Math.abs(left) <= HALF_W && Math.abs(right) <= HALF_W,
                `半高 ${halfH}: ${i === 1 ? '左' : '右'}家气泡不出左右屏边(${left.toFixed(0)}~${right.toFixed(0)})`);
            // 牌河最外沿(3 排)在气泡的**内侧**: 侧边手牌的内侧就是自家牌河
            const th = (i === 1 ? 1 : -1) * (90 - (TILT * 180) / Math.PI) * Math.PI / 180;
            const stepY = rivH + RIVER_GAP;
            const stepX = RIVER_W + RIVER_GAP;
            let riverEdge = dxs[i];
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < SIDE_COLS; col++) {
                    const lx = -SIDE_COLS * stepX / 2 + stepX / 2 + col * stepX;
                    const ly = row * stepY;
                    const wx = dxs[i] + (lx * Math.cos(th) - ly * Math.sin(th));
                    const half = (RIVER_W / 2) * Math.abs(Math.cos(th)) + (rivH / 2) * Math.abs(Math.sin(th));
                    const edge = wx + (i === 1 ? -half : half);
                    if (i === 1 ? edge < riverEdge : edge > riverEdge) riverEdge = edge;
                }
            }
            const gap = i === 1 ? riverEdge - right : left - riverEdge;
            check(gap > 0,
                `半高 ${halfH}: ${i === 1 ? '左' : '右'}家气泡让开自家弃牌河(余 ${gap.toFixed(1)}px)`,
                `气泡 ${left.toFixed(0)}~${right.toFixed(0)} / 牌河沿 ${riverEdge.toFixed(0)}`);
        }
        // 气泡不能压到玩家自己的手牌(手牌区必须始终可点, 硬约束 13b)
        const handTop = -halfH + TILE_H / 2 + 8 + TILE_H / 2;
        check(-BH / 2 > handTop, `半高 ${halfH}: 左/右家气泡不压玩家手牌(${(-BH / 2).toFixed(0)} > ${handTop.toFixed(0)})`);
    }
}

console.log(`\n=== ${fails === 0 ? '全部通过' : fails + ' 项失败'} ===\n`);
if (fails > 0) process.exit(1);
