/**
 * 规则设置持久化测试(直接跑编译后的 GameRulesStore, 用一个假 `cc` 顶替 sys.localStorage)
 *
 * 【为什么要专门测这个】原生(JSB)平台上 `sys.localStorage` 是异步挂上去的,
 * 早期为了绕开"读不到"直接 `if (sys.isNative) return;`, 结果真机上改完规则
 * 杀进程再进来全回默认值 —— 这类"存了但没存上"的 bug 光看代码看不出来。
 *
 * 用到的桩: `temp/rules-persist/node_modules/cc/index.js`
 *   `sys.localStorage` 做成 getter(每次访问取当前值), 于是可以模拟
 *   "启动时还没就绪 → 几百毫秒后才挂上"这个真实时序。
 *
 * 跑法(项目根目录):
 *   node "$TSC" --module commonjs --target ES2020 --strict false --skipLibCheck \
 *        --outDir temp/rules-persist assets/scripts/game/GameRules.ts assets/scripts/game/AIBrain.ts
 *   node "$TSC" --module commonjs --target ES2020 --strict false --skipLibCheck \
 *        --outDir temp/d tools/ai-test/rules-persist-test.ts
 *   node temp/d/rules-persist-test.js
 */
declare const require: any;
declare const process: any;

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'temp/rules-persist');
const SRC = path.join(OUT, 'game/GameRules.js');
const KEY = 'majiang.rules.v2';

let pass = 0;
let fail = 0;

function ok(cond: any, name: string, extra?: any): void {
    if (cond) {
        pass++;
        console.log(`  ✓ ${name}`);
    } else {
        fail++;
        console.log(`  ✗ ${name}${extra === undefined ? '' : `   (实际: ${JSON.stringify(extra)})`}`);
    }
}

function eq(actual: any, expected: any, name: string): void {
    ok(actual === expected, name, actual);
}

// ---- 假 cc: sys.localStorage 做成 getter, 可以随时"挂上"或"摘掉" ----
const CC_STUB = `'use strict';
let storage = {};
module.exports = {
    __setStorage(s) { storage = s; },
    sys: {
        isNative: true,
        get localStorage() { return storage; },
    },
};
`;
const ccDir = path.join(OUT, 'node_modules/cc');
fs.mkdirSync(ccDir, { recursive: true });
fs.writeFileSync(path.join(ccDir, 'index.js'), CC_STUB, 'utf8');
const cc = require(path.join(ccDir, 'index.js'));

/** 一个最小可用的 localStorage 替身(记录写入次数, 便于断言"改一次写一次") */
function makeStorage(initial?: { [k: string]: string }) {
    const map = new Map<string, string>();
    if (initial) for (const k of Object.keys(initial)) map.set(k, initial[k]);
    const st: any = {
        writes: 0,
        getItem(k: string) { return map.has(k) ? map.get(k)! : null; },
        setItem(k: string, v: string) { st.writes++; map.set(k, String(v)); },
        raw(k: string) { return map.has(k) ? map.get(k)! : null; },
        dump(k: string) { const r = st.raw(k); return r ? JSON.parse(r) : null; },
    };
    return st;
}

/** 模拟"重启": 清掉模块缓存重新 require(构造时会重新读盘) */
function bootGameRules() {
    delete require.cache[require.resolve(SRC)];
    return require(SRC).GAME_RULES;
}

// 编译产物存在性(编译命令见文件头)
if (!fs.existsSync(SRC)) {
    console.error(`缺少编译产物: ${SRC}\n先按文件头注释编译 GameRules.ts / AIBrain.ts`);
    process.exit(1);
}

console.log('\n[规则持久化]');

// ==================== A. 存储还没就绪(原生启动早期) ====================
console.log('\nA 组: 存储未就绪时不崩、按默认值走');
cc.__setStorage({});            // 空对象 = 原生上还没挂 localStorage 的状态
let G = bootGameRules();
eq(G.ensureLoaded(), false, 'A1 空存储对象被识别为"未就绪"');
eq(G.rules.allowChi, true, 'A2 未就绪时读 rules 拿到默认值(不抛错)');
eq(G.rules.bgmVolume, 0.5, 'A3 默认 BGM 音量为 0.5');
let threw = false;
try { G.setAllowChi(false); } catch (e) { threw = true; }
eq(threw, false, 'A4 未就绪时 setXxx 不抛错');
eq(G.rules.allowChi, false, 'A5 未就绪时的改动在内存里生效');
eq(G.ensureLoaded(), false, 'A6 仍然算未读(下次访问继续试)');

// ==================== B. 延迟就绪: 存档晚到, UI 要自己纠回来 ====================
console.log('\nB 组: 存储晚到(已存过自定义规则) → 读回来并通知 UI');
const saved = makeStorage({
    [KEY]: JSON.stringify({
        allowChi: false, allowAddKan: true, allowChiHu: false, allowRobKan: false,
        allowMultiRon: false, allowRiichi: true,
        aiDelay: 3,           // 旧存档里的脏字段: 必须被忽略
        sfxVolume: 0, bgmEnabled: false, bgmVolume: 0.25,
    }),
});
cc.__setStorage({});            // 先"未就绪"
G = bootGameRules();
eq(G.rules.allowChi, true, 'B1 读到之前先按默认值(allowChi=true)');
let notified = 0;
G.onChange(() => { notified++; });
cc.__setStorage(saved);         // 存储挂上了
eq(G.ensureLoaded(), true, 'B2 就绪后再访问即读到存档');
eq(G.rules.allowChi, false, 'B3 存档里的 allowChi=false 生效');
eq(G.rules.allowChiHu, false, 'B4 存档里的 allowChiHu=false 生效');
eq(G.rules.allowRobKan, false, 'B5 存档里的 allowRobKan=false 生效');
eq(G.rules.allowMultiRon, false, 'B6 存档里的 allowMultiRon=false 生效');
eq(G.rules.sfxVolume, 0, 'B7 存档里的音效音量 0 生效(不是默认 1)');
eq(G.rules.bgmEnabled, false, 'B8 存档里的 BGM 关闭生效');
eq(G.rules.bgmVolume, 0.25, 'B9 存档里的 BGM 音量 0.25 生效');
eq(G.rules.aiDelay, 0.9, 'B10 aiDelay 忽略存档脏值, 恒为 AI_DELAY');
ok(notified >= 1, 'B11 读到存档后通知了监听者(UI 才会刷新选中态)', notified);
eq(saved.writes, 0, 'B12 只是读盘, 不会反写存档');

// ==================== C. 就绪后: 改一次写一次 ====================
console.log('\nC 组: 就绪后每次改动立刻落盘');
G.setAllowAddKan(false);
G.setBgmVolume(0.75);
G.setBgmEnabled(true);
eq(saved.writes, 3, 'C1 三次设置写了三次盘(不攒着)');
eq(saved.dump(KEY).allowAddKan, false, 'C2 最新值已写入存档');
eq(saved.dump(KEY).bgmVolume, 0.75, 'C3 BGM 音量已写入存档');
eq(saved.dump(KEY).bgmEnabled, true, 'C4 BGM 开关已写入存档');

// ==================== D. 重启(杀进程再进) ====================
console.log('\nD 组: 模拟退出软件再进入');
cc.__setStorage(saved);
G = bootGameRules();            // 新实例 = 重启; 存储这次一开始就绪
eq(G.rules.allowChi, false, 'D1 重启后仍是用户设的 allowChi=false');
eq(G.rules.allowAddKan, false, 'D2 重启后仍是用户设的 allowAddKan=false');
eq(G.rules.bgmVolume, 0.75, 'D3 重启后仍是用户设的 BGM 音量');
eq(G.rules.bgmEnabled, true, 'D4 重启后仍是用户设的 BGM 开关');
eq(G.rules.allowRiichi, true, 'D5 没动过的项仍是存档里的值');

// ==================== E. 存档损坏 ====================
console.log('\nE 组: 存档损坏时退回默认值, 不阻断游戏');
const broken = makeStorage({ [KEY]: '{这不是 JSON' });
cc.__setStorage(broken);
threw = false;
try { G = bootGameRules(); } catch (e) { threw = true; }
eq(threw, false, 'E1 损坏存档不抛错');
eq(G.rules.allowChi, true, 'E2 退回默认规则');
G.setAllowChi(false);
eq(broken.dump(KEY).allowChi, false, 'E3 之后仍能正常写入(自愈)');

// ==================== F. 越界值被夹住 ====================
console.log('\nF 组: 越界音量被夹到 0~1');
const weird = makeStorage({
    [KEY]: JSON.stringify({ sfxVolume: 5, bgmVolume: -3, allowChi: 'yes' }),
});
cc.__setStorage(weird);
G = bootGameRules();
eq(G.rules.sfxVolume, 1, 'F1 sfxVolume=5 夹到 1');
eq(G.rules.bgmVolume, 0, 'F2 bgmVolume=-3 夹到 0');
eq(G.rules.allowChi, true, 'F3 非布尔值的 allowChi 被忽略(保持默认)');

// ==================== G. 恢复默认也要落盘 ====================
console.log('\nG 组: "恢复默认"同样写盘');
G.setAllowChi(false);
G.reset();
eq(G.rules.allowChi, true, 'G1 内存里已回默认');
eq(weird.dump(KEY).allowChi, true, 'G2 默认值已写入存档');
eq(weird.dump(KEY).sfxVolume, 1, 'G3 存档里的音量也回默认');

// ==================== H. 源码层: 不许再出现 "原生就跳过" ====================
console.log('\nH 组: 源码不再对原生平台放弃持久化');
// 必须先剥注释: 本文件/源码的说明里就写着那句错误写法, 直接全文匹配会自我命中
function stripComments(s: string): string {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
const src = stripComments(fs.readFileSync(path.join(ROOT, 'assets/scripts/game/GameRules.ts'), 'utf8'));
ok(src.indexOf('isNative') < 0, 'H1 GameRules.ts 里没有 isNative 早退');
ok(src.indexOf('typeof s.getItem') >= 0 && src.indexOf('typeof s.setItem') >= 0,
    'H2 读写前做了存储就绪探测');
ok(src.indexOf('_loadedCbs') >= 0, 'H3 有"读盘完成"回调(音频补同步音量用)');

const mainSrc = stripComments(fs.readFileSync(path.join(ROOT, 'assets/scripts/Main.ts'), 'utf8'));
ok(mainSrc.indexOf('GAME_RULES.onLoaded') >= 0, 'H4 Main.ts 注册了读盘完成回调(同步音量)');
ok(mainSrc.indexOf('_tryRestoreRules') >= 0, 'H5 Main.ts 有存储晚到的重试');

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
