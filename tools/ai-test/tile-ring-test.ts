/**
 * 牌边金/青边框的几何复核
 *
 * 【真实 bug(2026-10-17)】"刚摸到"的金色高光框与牌边不契合, 角上露出一道桌布色的缝。
 * 成因两条, 都在"贴牌边画圈"这件事上:
 *
 *  1) 圆角半径另取了一套比例。牌面素材是把圆角裁在图片上的
 *     (半径 = 短边 × 12%, 见 tools/make-tile-faces.py), 而边框用的是
 *     短边 × 12% / 16% 再 +2。两者不同心 → 弧线在角的"肩部"离牌边而去。
 *     63×84 的牌上, 45° 方向就偏了 1.5px。
 *  2) 画在牌身**之下**的圈, 路径直接压在牌边上 → 内侧半个线宽被不透明的牌面
 *     吃掉: 直边只剩 1.5px 细线, 角上被吃得更多, 看起来像"框断了"。
 *
 * 锁住三条不变量(全部从真实源码提取):
 *  A 比例唯一: TS 的 TILE_RADIUS_RATIO 必须等于 python 裁剪脚本的 RADIUS_RATIO,
 *    且五个画圈函数里不许再出现别的"× 0.xx"比例;
 *  B 同心: 五个函数都用 tileRadius(w, h), 不自己算圆角;
 *  C 描边位置: 路径外扩量 = 线宽/2 上下 0.5px 以内(grow - lineWidth/2 ∈ [-0.5, 0]),
 *    也就是描边正好从牌边起笔, 内侧最多藏半像素、绝不出现缝隙。
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

/** 剥离块注释与行注释, 只留真实代码(方法名常出现在注释里, 必须先剥) */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
}

/** 取函数/方法体(花括号配平), 在去注释后的源码里找; 找不到返回空串 */
function body(code: string, signature: string): string {
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

let fails = 0;
function check(cond: boolean, label: string, detail = ''): void {
    if (cond) console.log(`  ✓ ${label}`);
    else { fails++; console.log(`  ✗ ${label} ${detail}`); }
}

const tileView = stripComments(fs.readFileSync(findFile('assets/scripts/ui/TileView.ts'), 'utf8'));
const mainCode = stripComments(fs.readFileSync(findFile('assets/scripts/Main.ts'), 'utf8'));
const settle = stripComments(fs.readFileSync(findFile('assets/scripts/ui/SettlementPanel.ts'), 'utf8'));
const py = fs.readFileSync(findFile('tools/make-tile-faces.py'), 'utf8');

/** 递归收集 assets/scripts 下所有 .ts */
function walk(dir: string, out: string[] = []): string[] {
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) walk(p, out);
        else if (name.endsWith('.ts')) out.push(p);
    }
    return out;
}
/**
 * 只认真正的源码目录。
 * ⚠️ 不能直接 findFile('assets/scripts'): `temp/d/assets/scripts` 是别的测试
 * 编译出来的 JS 制品, 同名目录会被 existsSync 先命中, 于是扫到一堆 .js 却一个 .ts 都没有。
 */
function findScriptDir(): string {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        const p = path.join(dir, 'assets', 'scripts');
        if (fs.existsSync(p) && fs.statSync(p).isDirectory() && walk(p).length > 0) return p;
        dir = path.dirname(dir);
    }
    throw new Error('找不到 assets/scripts');
}
const scripts = walk(findScriptDir());

console.log('\n=== 牌边边框几何复核 ===\n');

// ---------------------------------------------------------------- A 组
console.log('[A] 圆角比例只有一个来源');
const pyRatio = /^RADIUS_RATIO\s*=\s*([\d.]+)/m.exec(py);
const tsRatio = /TILE_RADIUS_RATIO\s*=\s*([\d.]+)/.exec(tileView);
check(!!pyRatio, 'make-tile-faces.py 里有 RADIUS_RATIO');
check(!!tsRatio, 'TileView.ts 里有 TILE_RADIUS_RATIO');
check(
    !!pyRatio && !!tsRatio && parseFloat(pyRatio[1]) === parseFloat(tsRatio[1]),
    `两处比例一致(py ${pyRatio ? pyRatio[1] : '?'} / ts ${tsRatio ? tsRatio[1] : '?'})`,
);
// 曾经 UIFactory.ts 里还留着一份 TILE_FACE_RADIUS_RATIO(=0.093) 的死代码,
// 改圆角时漏了它就又变成"两套比例"。这里锁住: 全项目只允许 TileView.ts 定义一份。
const ratioHolders = scripts
    .filter((f: string) => /RADIUS_RATIO\s*=\s*[\d.]+/.test(stripComments(fs.readFileSync(f, 'utf8'))))
    .map((f: string) => path.basename(f));
check(ratioHolders.length === 1 && ratioHolders[0] === 'TileView.ts',
    '全项目只有 TileView.ts 定义圆角比例', `实际: ${ratioHolders.join(', ') || '无'}`);

// ---------------------------------------------------------------- B + C 组
const targets: Array<{ file: string; code: string; sig: string; name: string }> = [
    { file: 'TileView.ts', code: tileView, sig: 'function drawDrawnMark(', name: 'drawDrawnMark(刚摸到)' },
    { file: 'TileView.ts', code: tileView, sig: 'function drawHintMark(', name: 'drawHintMark(AI 提示)' },
    { file: 'TileView.ts', code: tileView, sig: 'function drawDragGlow(', name: 'drawDragGlow(拖牌)' },
    { file: 'Main.ts', code: mainCode, sig: 'function addClaimedRing(', name: 'addClaimedRing(副露触发牌)' },
    { file: 'SettlementPanel.ts', code: settle, sig: 'private _placeTile(', name: '_placeTile(WinRing)' },
];

console.log('\n[B] 所有"贴牌边画圈"的地方共用 tileRadius()');
const bodies: Record<string, string> = {};
for (const t of targets) {
    const b = body(t.code, t.sig);
    bodies[t.name] = b;
    check(b.length > 0, `${t.name} 能定位到`, t.file);
    check(b.includes('tileRadius('), `${t.name} 用了 tileRadius()`);
}

console.log('\n[C] 没有第二套圆角比例');
// 只认"乘一个 0.xx 的常量"这种写法(排除 +1 / -2 这类外扩量与 1 / 0.5 之类的系数)
for (const [name, b] of Object.entries(bodies)) {
    const bad = /\*\s*0\.(?!093)\d+/.exec(b);
    check(!bad, `${name} 里没有别的比例`, bad ? `命中 ${bad[0]}` : '');
}

console.log('\n[D] 描边正好从牌边起笔(grow - lineWidth/2 ∈ [-0.5, 0])');
/**
 * 按 src 顺序把 lineWidth 与它后面第一个 roundRect 的外扩量配对:
 * `g.lineWidth = L` 之后写 `g.roundRect(-w / 2 - G, ..., w + 2G, ...)`,
 * 描边以内侧边界 = G - L/2 起笔(负值 = 藏进牌下)。
 */
function ringPairs(b: string): Array<{ L: number; G: number }> {
    const out: Array<{ L: number; G: number }> = [];
    const re = /lineWidth\s*=\s*([\d.]+)\s*;[\s\S]*?roundRect\(\s*-w\s*\/\s*2\s*-\s*([\d.]+)/g;
    let m = re.exec(b);
    while (m) {
        out.push({ L: parseFloat(m[1]), G: parseFloat(m[2]) });
        m = re.exec(b);
    }
    return out;
}
for (const [name, b] of Object.entries(bodies)) {
    const pairs = ringPairs(b);
    check(pairs.length > 0, `${name} 找到描边路径`, `实际 ${pairs.length} 条`);
    for (const { L, G } of pairs) {
        const inner = G - L / 2;
        check(
            inner >= -0.5001 && inner <= 0.0001,
            `${name} 线宽 ${L} / 外扩 ${G} → 内侧 ${inner.toFixed(2)}`,
            inner < -0.5 ? '(描边离牌边太远, 会露缝)' : '(内侧露出太多, 会被牌面盖掉)',
        );
    }
    // 外扩量必须与 roundRect 的 `w + 2G` 自洽, 否则图形宽度和路径中心对不上
    const sums = b.match(/roundRect\(\s*-w\s*\/\s*2\s*-\s*([\d.]+)\s*,\s*-h\s*\/\s*2\s*-\s*[\d.]+\s*,\s*w\s*\+\s*([\d.]+)/g) || [];
    for (const s of sums) {
        const m = /-\s*([\d.]+)\s*,[^,]*,\s*w\s*\+\s*([\d.]+)/.exec(s);
        if (!m) continue;
        check(
            Math.abs(parseFloat(m[2]) - 2 * parseFloat(m[1])) < 1e-6,
            `${name} 的 roundRect 宽度与偏移自洽(${m[1]} → +${m[2]})`,
        );
    }
}

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
process.exit(fails === 0 ? 0 : 1);
