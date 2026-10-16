/**
 * 跨局状态归零复核(返回主页面 → 再开新局)
 *
 * 【真实 bug, 堆栈见 temp/logs/project.log】
 * 对局中点"返回主页面", 再点"开始游戏"必崩:
 *     Cannot read properties of null (reading 'length')
 *     at Node._findComponent ← Main._clearHintMark ← Main._hideHint
 *                              ← Main._refreshHintButton ← Main._refreshInfo
 *                              ← GameManager.startGame
 *
 * 成因: `_clearTable()` 销毁了手牌容器里的牌节点, 却只清了 `_handSlots` /
 * `_prevHandSlots` / `_riverCount`, **唯独没清 `_handNodes`** ——
 * 于是它成了跨局残留的悬垂引用。
 * `node.destroy()` 是**延迟销毁**: 同一 tick 内(对局中直接"重新开始")
 * 节点还没真被销毁, `_components` 仍是有效数组, 不崩;
 * 隔一帧再点"开始游戏"(返回主页面走的就是这条路) 时节点已销毁,
 * `_components` 成了 null, 引擎读它的 `.length` 就抛。
 *
 * 这类"跨局残留引用"是本项目最容易复发的一类 bug(硬约束 6c 里
 * `_dealing` 残留是同一形状), 所以从**真实源码**提取断言锁住。
 */
declare const require: (m: string) => any;
declare const __dirname: string;
declare const process: { exit(code: number): never };
const fs = require('fs');
const path = require('path');

function findFile(rel: string): string {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        const p = path.join(dir, ...rel.split('/'));
        if (fs.existsSync(p)) return p;
        dir = path.dirname(dir);
    }
    throw new Error(`找不到 ${rel}`);
}

const mainCode = stripComments(fs.readFileSync(findFile('assets/scripts/Main.ts'), 'utf8'));

let fails = 0;
function check(cond: boolean, label: string, detail = ''): void {
    if (cond) console.log(`  ✓ ${label}`);
    else { fails++; console.log(`  ✗ ${label} ${detail}`); }
}

/** 剥离块注释与行注释, 只留真实代码 */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
}

/** 取方法体(花括号配平), 在去注释后的源码里找; 找不到返回空串 */
function methodBody(code: string, signature: string): string {
    const i = code.indexOf(signature);
    if (i < 0) return '';
    let depth = 0, started = false;
    for (let j = code.indexOf('{', i); j < code.length; j++) {
        const ch = code[j];
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') {
            depth--;
            if (started && depth === 0) return code.slice(code.indexOf('{', i), j + 1);
        }
    }
    return '';
}

console.log('\n=== 跨局状态归零复核 ===\n');

// ---------------------------------------------------------------- A 组
// 根因: 清牌桌时必须把手牌节点引用一并归零
console.log('[A] 清牌桌时归零跨局状态');
const clearTable = methodBody(mainCode, 'private _clearTable(');
check(clearTable.length > 0, '_clearTable() 能定位到');
for (const field of ['_handSlots', '_prevHandSlots', '_riverCount', '_handNodes', '_hintedTileIndex']) {
    // 必须**赋值**归零, 而不是只读一遍(读一遍等于没清)
    const assigned = new RegExp(`this\\.${field}\\s*(\\.clear\\(\\)|=)`).test(clearTable);
    check(assigned, `_clearTable() 归零了 ${field}`);
}

// ---------------------------------------------------------------- B 组
// 防御: 对 _handNodes 里的节点取组件前必须判 isValid
console.log('\n[B] 访问手牌节点前判 isValid(防销毁后 getComponent)');
// 规则: 每一处 getComponent(TileView) 所在行都必须带 isValid 判断
const tileViewLines = mainCode.split('\n')
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(x => x.l.includes('getComponent(TileView)'));
check(tileViewLines.length >= 4, `找到 ${tileViewLines.length} 处 TileView 组件访问`);
for (const { l, n } of tileViewLines) {
    check(l.includes('isValid'), `Main.ts:${n} 取 TileView 前判了 isValid`, `实际: ${l.trim()}`);
}
for (const sig of ['private _clearHintMark(', 'private _reapplyHintMark(', 'private _setSelection(']) {
    const body = methodBody(mainCode, sig);
    check(body.includes('isValid'), `${sig.replace('private ', '').replace('(', '()')} 里有 isValid 防御`);
}
// centerOf 内部同样会 getComponent, 把 _handNodes 里的节点喂进去前也要判有效性。
// 节点常先取到局部变量再传(不是同一行), 所以按"取节点的行往后看 3 行"来找。
const allLines = mainCode.split('\n');
let handNodeFeed = 0;
for (let i = 0; i < allLines.length; i++) {
    if (!allLines[i].includes('_handNodes[')) continue;
    const win = allLines.slice(i, i + 4).join(' ');
    if (!win.includes('centerOf(')) continue;
    handNodeFeed++;
    check(win.includes('isValid'), `Main.ts:${i + 1} 附近把手牌节点喂给 centerOf 前判了 isValid`);
}
check(handNodeFeed > 0, `找到 ${handNodeFeed} 处"手牌节点 → centerOf"`);

// ---------------------------------------------------------------- C 组
// Main 自己的 scheduleOnce 只能由 Main 自己清:
// GameManager.unscheduleAllCallbacks() 作用在 GM 组件上, 清不到 Main
console.log('\n[C] 打断对局时清掉 Main 自己排队的帧');
const backBody = methodBody(mainCode, 'private _backToMenu(');
check(backBody.includes('unscheduleAllCallbacks'), '_backToMenu() 调了 Main 的 unscheduleAllCallbacks()');
// 返回主页面只停对局不开新局 —— 反过来若在这里开新局, 刚排的帧会被自己清掉
check(!backBody.includes('_startDealing()'), '_backToMenu() 不开新局(只 stopGame + 回主页面)');

const restartBody = methodBody(mainCode, 'private _onRestartClick(');
check(restartBody.includes('unscheduleAllCallbacks'), '_onRestartClick() 调了 Main 的 unscheduleAllCallbacks()');
// 顺序: 必须先清旧帧, 再开新局(反了会把新局的帧一起清掉)
const clearAt = restartBody.indexOf('unscheduleAllCallbacks');
const startAt = restartBody.indexOf('_startDealing()');
check(clearAt >= 0 && startAt > clearAt, '_onRestartClick() 里"清旧帧"排在"开新局"之前');

// ---------------------------------------------------------------- D 组
// Node[] 里不许塞 null: "元素为空"与"节点已销毁"两种状态混在一起极难排查
console.log('\n[D] 手牌数组保持纯 Node[]');
check(
    !/_handNodes\s*=\s*new Array\([^)]*\)\.fill\(/.test(mainCode),
    '_handNodes 不用 fill(null)(用等长空洞)',
);

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
process.exit(fails === 0 ? 0 : 1);