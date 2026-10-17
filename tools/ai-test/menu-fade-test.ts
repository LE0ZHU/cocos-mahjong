/**
 * 菜单页面切换过渡校验 —— 从真实源码提取 `_beginShow` 的方法体执行
 *
 * 复核四组:
 *  1. 时长常量: 淡出/淡入总时长在 [0.15s, 0.6s] —— 短到不拖沓, 长到看得出"换了一页"
 *  2. **行为**(跑真实的 `_beginShow` 体 + mock 节点/补间):
 *     首次显示不动画 / 正常切换淡出淡入 / 快速连点打断后最终状态正确 /
 *     重复进入同一页不重播动画 / 动画只补间透明度(不留半位移残留)
 *  3. 结构: 三页互斥、打断保护(序列号 + kill 补间)、销毁时停补间
 *  4. 与原生补画的接线不受影响(各 showXxx 仍补画按钮)
 *
 * 【为什么把方法体抽出来跑】"淡出→切换→淡入"里最容易错的是**时序**(回调先隐藏了
 * 正在淡入的页、打断后留下半透明), 这类 bug 光看代码看不出来 —— 用 mock 补间把
 * 真实实现跑一遍, 把"补间都播完"后的最终状态断言出来。
 * 体里的补间目标/时长都从源码读, 不手抄一份实现(手抄必然漂移)。
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

const menuSrc = fs.readFileSync(findFile('assets/scripts/ui/MenuUI.ts'), 'utf8');

let fails = 0;
function check(cond: boolean, name: string, extra = ''): void {
    if (cond) console.log(`  [OK] ${name}`);
    else { fails++; console.log(`  [FAIL] ${name}${extra ? ' → ' + extra : ''}`); }
}

function stripComments(s: string): string {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
function num(src: string, name: string): number {
    const m = new RegExp(`const\\s+${name}\\s*(?::[^=]*)?=\\s*(-?[\\d.]+)`).exec(src);
    if (!m) throw new Error(`源码里找不到常量 ${name}`);
    return Number(m[1]);
}
/** 提取某个方法的方法体(先剥注释, 再大括号配对) */
function methodBody(src: string, signature: string): string {
    const code = stripComments(src);
    const at = code.indexOf(signature);
    if (at < 0) throw new Error(`找不到方法 ${signature}`);
    const open = code.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < code.length; i++) {
        const ch = code[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return code.slice(open + 1, i);
        }
    }
    throw new Error('大括号不配对');
}

const code = stripComments(menuSrc);
const FADE_OUT = num(menuSrc, 'PAGE_FADE_OUT');
const FADE_IN = num(menuSrc, 'PAGE_FADE_IN');
const body = methodBody(menuSrc, 'private _beginShow(to: Node | null): void');

// ---------------------------------------------------------------- mock 环境
interface FakeOp { opacity: number }
interface FakeNode { name: string; active: boolean; op: FakeOp }
interface FakeTo { dur: number; props: Record<string, unknown> }
interface FakeChain {
    target: FakeOp; delay: number; tos: FakeTo[];
    calls: (() => void)[]; stopped: boolean; done: boolean;
}

function makeNode(name: string): FakeNode {
    return { name, active: false, op: { opacity: 255 } };
}

// 读状态经这两个小函数: 直接比较属性会被 TS 的控制流收窄成字面量类型而报"无重叠"
const isOn = (n: FakeNode): boolean => n.active;
const alpha = (n: FakeNode): number => n.op.opacity;

/** 建一套 mock: 记录 start 的补间链, 可整体"播完", 效果等价于引擎执行到底 */
function harness(page: string | null) {
    const chains: FakeChain[] = [];
    const stops: FakeOp[] = [];
    const home = makeNode('home');
    const rules = makeNode('rules');
    const help = makeNode('help');
    const nodes: Record<string, FakeNode> = { home, rules, help };

    const ensureOpacity = (n: FakeNode): FakeOp => n.op;
    const fakeTween = (target: FakeOp): any => {
        const chain: FakeChain = { target, delay: 0, tos: [], calls: [], stopped: false, done: false };
        const api: any = {
            to: (dur: number, props: Record<string, unknown>, _opts?: unknown) => {
                chain.tos.push({ dur, props });
                return api;
            },
            call: (fn: () => void) => { chain.calls.push(fn); return api; },
            delay: (d: number) => { chain.delay += d; return api; },
            start: () => { chains.push(chain); return api; },
        };
        return api;
    };
    const Tween = {
        stopAllByTarget: (t: FakeOp): void => {
            stops.push(t);
            for (const c of chains) if (c.target === t) c.stopped = true;
        },
    };
    const ctx = {
        _currentPage: page ? nodes[page] : null,
        _transitSeq: 0,
        _homeNode: home,
        _rulesNode: rules,
        _helpNode: help,
    };
    const fn = new Function('ensureOpacity', 'Tween', 'tween', 'PAGE_FADE_OUT', 'PAGE_FADE_IN', 'to', body) as any;

    return {
        home, rules, help, chains, stops, ctx,
        /** 调一次真实的 _beginShow(全部补间立即开跑, 但还没"播完") */
        show: (target: string) => fn.call(ctx, ensureOpacity, Tween, fakeTween, FADE_OUT, FADE_IN, nodes[target]),
        /** 把还活着的补间模拟播到底: 应用 to 的属性, 再按顺序执行 call 回调 */
        finish: () => {
            for (const c of chains) {
                if (c.done || c.stopped) continue;
                for (const t of c.tos) Object.assign(c.target, t.props);
                for (const fn2 of c.calls) fn2();
                c.done = true;
            }
        },
    };
}

console.log('\n=== 菜单页面切换过渡校验 ===\n');

// ---------------------------------------------------------------- 1
console.log('[1] 时长常量');
check(FADE_OUT > 0.05 && FADE_OUT <= 0.3, `淡出 ${FADE_OUT}s 在 (0.05, 0.3]`);
check(FADE_IN > 0.05 && FADE_IN <= 0.3, `淡入 ${FADE_IN}s 在 (0.05, 0.3]`);
const total = FADE_OUT + FADE_IN;
check(total >= 0.15 && total <= 0.6, `总过渡 ${total.toFixed(2)}s 在 [0.15, 0.6](看得出但不拖沓)`);
check(FADE_IN >= FADE_OUT, `淡入(${FADE_IN}) ≥ 淡出(${FADE_OUT})(收尾柔一点)`);

// ---------------------------------------------------------------- 2
console.log('\n[2] 行为(跑真实 _beginShow 方法体)');

// A. 首次显示(启动 onLoad → showHome): 不动画, 直接是最终状态
{
    const h = harness(null);
    h.show('home');
    h.finish();
    check(h.chains.length === 0, '首次显示不建补间(第一帧就是主页面)');
    check(isOn(h.home) && alpha(h.home) === 255, '首次显示目标页直接可见且不透明');
    check(!isOn(h.rules) && !isOn(h.help), '首次显示时其它两页收起');
    check(h.ctx._currentPage === h.home, '_currentPage 指向目标页');
}

// B. 正常切换 home → rules: 淡出 + 淡入, 播完后只有 rules 可见
{
    const h = harness('home');
    h.home.active = true;
    h.show('rules');
    check(h.chains.length === 2, '切换建两条补间(旧页淡出 + 新页淡入)');
    check(isOn(h.rules), '目标页立即激活(补间只动透明度)');
    check(alpha(h.rules) === 0, '目标页从全透明开始淡入');
    const [cOut, cIn] = h.chains;
    check(cOut.target === h.home.op && cOut.tos[0].dur === FADE_OUT,
        '第一条是旧页淡出, 时长 = PAGE_FADE_OUT');
    check(cIn.target === h.rules.op && cIn.delay === FADE_OUT && cIn.tos[0].dur === FADE_IN,
        '第二条是新页淡入, 先等淡出完(延迟 = PAGE_FADE_OUT)');
    h.finish();
    check(!isOn(h.home), '播完后旧页收起');
    check(alpha(h.rules) === 255 && isOn(h.rules), '播完后新页完全不透明');
    check(h.stops.length === 2, '切换开始时停掉了两个页面上的旧补间');
    // 动画只碰透明度(位置/缩放由布局定稿, 过渡阶段改它们会留下半位移残留)
    const keys = h.chains.reduce<string[]>((acc, c) => acc.concat(c.tos.map(t => Object.keys(t.props)[0])), []);
    check(keys.every(k => k === 'opacity'), `补间只改 opacity(实际: ${keys.join(',')})`);
}

// C. 快速连点打断: home→rules 没播完就 rules→home, 最终状态必须是"home 可见"
{
    const h = harness('home');
    h.home.active = true;
    h.show('rules');
    const staleCall = h.chains[0].calls[0];     // 旧过渡"隐藏 home"的回调(带旧序列号)
    h.show('home');                              // 立刻点返回
    h.finish();
    check(isOn(h.home) && alpha(h.home) === 255, '被打断后最终 home 可见且不透明');
    check(!isOn(h.rules), '被打断后 rules 收起(旧回调没有把它误伤/漏收)');
    check(h.stops.length === 4, '两段过渡各自停了两个页面的补间(累计 4 次)');
    // 旧回调即便被触发(引擎里可能已排队), 也必须因序列号作废而不动手
    staleCall();
    check(isOn(h.home), '过期回调被序列号作废(不会隐藏正在淡入的页)');
    check(h.ctx._transitSeq === 2, `序列号随每次切换递增(实际 ${h.ctx._transitSeq})`);
}

// D. 重复进入同一页(从对局返回 showHome): 不重播动画, 保证可见
{
    const h = harness('home');
    h.show('home');
    h.finish();
    check(h.chains.length === 0, '已在目标页时不建补间');
    check(alpha(h.home) === 255, '已在目标页时强制不透明(挡掉异常残留的半透明)');
}

// ---------------------------------------------------------------- 3
console.log('\n[3] 结构与保护(源码级)');
check(/_currentPage: Node \| null/.test(code), '有 _currentPage 字段(过渡的"从哪来"凭据)');
check(/_transitSeq\s*=\s*0/.test(code), '有 _transitSeq 序列号字段');
check(/\+\+this\._transitSeq/.test(code), '每次切换递增序列号');
check(/seq === this\._transitSeq/.test(code), '过渡回调里用序列号作废过期动作');
check(/Tween\.stopAllByTarget\(ensureOpacity\(from\)\)/.test(code) && /Tween\.stopAllByTarget\(opTo\)/.test(code),
    '切换开始时停掉两页上的旧补间');
check(/\[this\._homeNode, this\._rulesNode, this\._helpNode\]/.test(body),
    '三页互斥: 与本次过渡无关的页一律收起');
check(/opTo\.opacity = 255/.test(body), '目标页最终不透明(不会停在半透明)');
check(/ensureOpacity\(to\)/.test(body), '透明度组件经 ensureOpacity 获取(与 Anim.ts 同一套)');
for (const fn of ['showHome', 'showRules', 'showHelp']) {
    const b = methodBody(menuSrc, `${fn}(): void`);
    check(/_beginShow\(this\.\w+Node\)/.test(b), `${fn}() 经由 _beginShow 切页`);
    check(/repaintButtons\(/.test(b), `${fn}() 仍补画按钮(原生 JSB 接线不受过渡影响)`);
}
// 进入对局/返回: hide 只切根节点开关, 不参与过渡(回主菜单是瞬显, 这是有意为之)
const hideBody = methodBody(menuSrc, 'hide(): void');
check(/_root\.active = false/.test(hideBody) && !/tween/.test(hideBody), 'hide() 只关根节点(不叠加过渡)');
check(/Tween\.stopAllByTarget/.test(methodBody(menuSrc, 'onDestroy(): void')), 'onDestroy 停掉三页上的补间');

// ---------------------------------------------------------------- 4
console.log('\n[4] 与原生补画/滚动条接线不受影响');
check(/this\._paintPageDims\(\)/.test(methodBody(menuSrc, 'showRules(): void')), 'showRules 仍补画阅读底板');
check(/this\._rulesScroll\.barKey = '#'/.test(methodBody(menuSrc, 'showRules(): void')), 'showRules 仍强制重画滚动条');
const helpBody = methodBody(menuSrc, 'showHelp(): void');
check(helpBody.includes('_paintHelpDividers()'), 'showHelp 仍补画分隔线');
check(helpBody.includes('_paintPageDims()'), 'showHelp 仍补画阅读底板');
check(/this\._helpScroll\.barKey = '#'/.test(helpBody), 'showHelp 仍强制重画滚动条');

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
process.exit(fails === 0 ? 0 : 1);
