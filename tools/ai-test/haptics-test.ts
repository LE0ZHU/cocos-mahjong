/**
 * 震动反馈校验 —— 从真实源码提取断言, 跑数字
 *
 * 复核五组:
 *  1. 平台守卫: 原生探测 jsb 上带 vibrate 的 Device(两种大小写都试)、Web 走 navigator.vibrate,
 *     取不到就静默跳过(桌面/旧版本不报错), 全程 try/catch
 *  2. 时长口径: 碰/杠短促、胡牌略重, 都在"轻震"范围内; 原生调用按秒(ms/1000), Web 按毫秒
 *  3. Main 接线: 碰/杠震(吃不震)、胡牌挂在 onSettle 的 kind==='hu' 上(**不能挂 onHu** ——
 *     流局也会走 _fireHu, 挂了流局会白震一下, 同 AGENTS.md 硬约束 11b)
 *  4. Android 权限链: native manifest 已声明 VIBRATE; patch-apk.ps1 在 repack 之前注入;
 *     patcher 幂等、克隆现有 uses-permission 元素、修根 chunk 尺寸
 *  5. 若快迭代产物存在(temp/apkpatch), 直接对**二进制产物**复查:
 *     VIBRATE 字符串在 manifest 里、根 chunk 尺寸与文件长度一致
 *
 * 【为什么第 5 组存在】链路上任何一环出错(权限没注入/清单结构写坏)在电脑上都"看着正常",
 * 只有真机会不震或装不上。清单是二进制 AXML, 肉眼不可读 —— 必须机器复查。
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

const hapticsSrc = fs.readFileSync(findFile('assets/scripts/feedback/Haptics.ts'), 'utf8');
const mainSrc = fs.readFileSync(findFile('assets/scripts/Main.ts'), 'utf8');
const manifestXml = fs.readFileSync(findFile('native/engine/android/app/AndroidManifest.xml'), 'utf8');
const patchPs1 = fs.readFileSync(findFile('tools/patch-apk.ps1'), 'utf8');
const patcherPy = fs.readFileSync(findFile('tools/patch_manifest_vibrate.py'), 'utf8');

let fails = 0;
function check(cond: boolean, name: string, extra = ''): void {
    if (cond) console.log(`  [OK] ${name}`);
    else { fails++; console.log(`  [FAIL] ${name}${extra ? ' → ' + extra : ''}`); }
}

/** 去注释(含 // 与 /* *\/ ), 断行保留 —— 与其它校验脚本一致 */
function stripComments(s: string): string {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
/** 从源码里取数值常量 */
function num(src: string, name: string): number {
    const patterns = [
        new RegExp(`const\\s+${name}\\s*(?::[^=]*)?=\\s*(-?[\\d.]+)`),
        new RegExp(`private\\s+readonly\\s+${name}\\s*(?::[^=]*)?=\\s*(-?[\\d.]+)`),
    ];
    for (const re of patterns) {
        const m = re.exec(src);
        if (m) return Number(m[1]);
    }
    throw new Error(`源码里找不到常量 ${name}`);
}

const haptics = stripComments(hapticsSrc);
const main = stripComments(mainSrc);

console.log('\n=== 震动反馈校验 ===\n');

// ---------------------------------------------------------------- 1
console.log('[1] 平台守卫(原生探测 / Web navigator / 静默跳过)');
check(/import\s*\{[^}]*sys[^}]*\}\s*from\s*'cc'/.test(haptics), 'Haptics 只用 cc 的 sys(纯工具模块, 不依赖节点)');
check(/sys\.isNative/.test(haptics), '按 sys.isNative 分流原生/Web');
check(/typeof jsb === 'undefined'/.test(haptics), '原生分支先判 jsb 是否存在(Web 上引用不炸)');
check(/'Device'/.test(haptics) && /'device'/.test(haptics),
    '两种大小写(Device/device)都探测 —— 引擎各版本绑定名不一致');
check(/typeof d\.vibrate === 'function'/.test(haptics), '取到对象还要确认 vibrate 是函数(缺失则跳过)');
check(/typeof nav\.vibrate === 'function'/.test(haptics), 'Web 分支先做特性检测(navigator.vibrate 不存在就跳过)');
check(/try\s*\{/.test(haptics) && /catch/.test(haptics), '调用包在 try/catch 里(震动失败不影响牌局)');
// 原生收"秒"、Web 收"毫秒" —— 换算必须在原生分支里出现
const nativeCall = /nativeDevice\(\)\?\.vibrate\(([^)]*)\)/.exec(haptics);
check(!!nativeCall && /\/\s*1000/.test(nativeCall[1]), '原生调用把毫秒换算成秒(ms / 1000)',
    nativeCall ? nativeCall[1] : '找不到调用');
check(/nav\.vibrate\(ms\)/.test(haptics), 'Web 直接把毫秒传给 navigator.vibrate');

// ---------------------------------------------------------------- 2
console.log('\n[2] 时长口径');
const msMeld = num(haptics, 'MS_MELD');
const msHu = num(haptics, 'MS_HU');
check(msMeld >= 10 && msMeld <= 80, `碰/杠时长 ${msMeld}ms 在 10~80(短促一下, 不抢注意力)`);
check(msHu >= msMeld && msHu <= 160, `胡牌时长 ${msHu}ms 在 [${msMeld}, 160](比副露重但不能是长震)`);
check(/export function vibrateMeld\(\)/.test(haptics) && /export function vibrateHu\(\)/.test(haptics),
    '对外只有 vibrateMeld / vibrateHu 两个入口(调用点语义自明)');

// ---------------------------------------------------------------- 3
console.log('\n[3] Main 接线(碰杠震 / 胡牌震 / 流局不震)');
check(/from '\.\/feedback\/Haptics'/.test(main), 'Main 从 ./feedback/Haptics 导入');
const meldBody = main.slice(main.indexOf('gm.onMeld ='), main.indexOf('gm.onMeld =') + 400);
check(/meld\.type !== 'chi'/.test(meldBody), 'onMeld 里吃牌被排除(type !== chi)');
check(/vibrateMeld\(\)/.test(meldBody), 'onMeld 里调 vibrateMeld()');
const settleBody = main.slice(main.indexOf('gm.onSettle ='), main.indexOf('gm.onSettle =') + 500);
check(/data\.kind === 'hu'/.test(settleBody), 'onSettle 里按 kind === hu 区分胡牌/流局');
check(/vibrateHu\(\)/.test(settleBody), 'onSettle 里调 vibrateHu()');
const huHandler = main.slice(main.indexOf('gm.onHu ='), main.indexOf('gm.onHu =') + 200);
check(!/vibrat/i.test(huHandler), 'onHu 上**没有**震动(流局也会走 _fireHu, 同硬约束 11b)');
// 文件与 meta 都在(Cocos 对新增 .ts 要求同目录 meta)
check(fs.existsSync(findFile('assets/scripts/feedback/Haptics.ts.meta')), 'Haptics.ts.meta 存在');
check(fs.existsSync(findFile('assets/scripts/feedback.meta')), 'feedback 目录 meta 存在');

// ---------------------------------------------------------------- 4
console.log('\n[4] Android 权限链(真机生效的前提)');
check(/android\.permission\.VIBRATE/.test(manifestXml), 'native 工程 manifest 已声明 VIBRATE');
check(!/android:name="android\.permission\.VIBRATE"\s*\/>\s*<uses-permission[^>]*VIBRATE/.test(manifestXml),
    'VIBRATE 只声明了一条(没有重复)');
const ps1Call = /patch_manifest_vibrate\.py'\)\s*\$unpack/.test(patchPs1);
check(ps1Call, 'patch-apk.ps1 在解包后调用注入脚本');
check(/patch_manifest_vibrate\.py[\s\S]{0,400}?repack_apk\.py/.test(patchPs1),
    '注入发生在 repack 之前(顺序不能反, 否则打包的是旧清单)');
check(/'patch_manifest_vibrate\.py failed'/.test(patchPs1), '注入失败会中止流程(不静默出包)');
check(/PERMISSION = 'android\.permission\.VIBRATE'/.test(patcherPy), 'patcher 的目标权限写死为 VIBRATE');
const patcher = patcherPy;
check(/if value_index is not None:[\s\S]{0,200}?return False/.test(patcher), 'patcher 幂等(已有权限则跳过)');
check(/uses_permission\[-1\]/.test(patcher), 'patcher 克隆现成的 uses-permission 元素(不手拼编码)');
check(/root_size \+ inserted_len/.test(patcher), 'patcher 修正根 chunk 尺寸');
check(/style_count != 0/.test(patcher), '无样式数据的前提有显式检查(结构不符时报错而不是写坏)');

// ---------------------------------------------------------------- 5
console.log('\n[5] 二进制产物复查(快迭代产物存在时)');
const flowManifest = path.join(path.dirname(findFile('tools/patch-apk.ps1')), '..', 'temp', 'apkpatch', 'unpacked', 'AndroidManifest.xml');
const flowPath = path.normalize(flowManifest);
if (fs.existsSync(flowPath)) {
    const buf: any = fs.readFileSync(flowPath);
    const asUtf16 = buf.toString('utf16le');
    check(asUtf16.indexOf('android.permission.VIBRATE') >= 0, '产出的二进制 manifest 里有 VIBRATE(UTF-16 字符串池)');
    const rootType = buf.readUInt16LE(0);
    const rootSize = buf.readUInt32LE(4);
    check(rootType === 0x0003, '根 chunk 类型正确(0x0003)');
    check(rootSize === buf.length, `根 chunk 尺寸与文件长度一致(${rootSize} == ${buf.length})`);
    // 完整权限串只应出现一份(字符串池里那一条; 元素引用的是索引, 不会再存一份明文)
    const full = 'android.permission.VIBRATE';
    let fullHits = 0;
    let from = 0;
    for (;;) {
        const at = asUtf16.indexOf(full, from);
        if (at < 0) break;
        fullHits++;
        from = at + 1;
    }
    check(fullHits === 1, `完整字符串只出现 1 次(实际 ${fullHits})`);
} else {
    console.log('  [SKIP] 未找到 temp/apkpatch/unpacked/AndroidManifest.xml(跑一次 tools/patch-apk.ps1 -NoInstall 后复查)');
}

console.log(`\n${fails === 0 ? '全部通过' : fails + ' 项失败'}\n`);
process.exit(fails === 0 ? 0 : 1);
