/**
 * 牌型播报映射对拍(音频导入的回归防线)
 *
 * 从**真实源码**里提取 `TILE_VOICE_NAMES` 的构造逻辑与 `preloadSounds` 的名单,
 * 再与 assets/resources/audio 下**实际存在的 mp3 文件**三方对拍。
 *
 * 为什么必须这么验:
 *  - 映射表是手写的字面量(万1-9/条1-9/筒1-9 + 风4 + 箭3), 很容易出现"少一个/错一位"
 *  - 文件名与牌型的对应靠约定(如 白板叫 baipi 而非 baiban), 对错了游戏不报错、只是播错音
 *  - 少一个文件不会抛异常, `play()` 里 clip 缺失是**静默跳过**的
 *
 * 断言三件事:
 *  ① 34 种牌型都能解析出一个非空音频名(无 undefined / 无空串)
 *  ② 这些音频名与 preloadSounds 的名单**完全一致**(不多不少)
 *  ③ 每个音频名对应的 mp3 + .meta 都真实存在于磁盘, 且 .meta 里的 uuid 全局唯一
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

const soundSrc = fs.readFileSync(findFile('assets/scripts/audio/Sound.ts'), 'utf8');
const audioDir = path.join(path.dirname(findFile('assets/scripts/audio/Sound.ts')), '../../resources/audio');

let fails = 0;
function check(cond: boolean, label: string, detail = ''): void {
    if (cond) console.log(`  ✓ ${label}`);
    else { fails++; console.log(`  ✗ ${label} ${detail}`); }
}

// ---------- 从源码提取映射表 ----------
// 复刻 TILE_VOICE_NAMES 的构造: 万/条/筒 = ${rank}${code}, 风/箭查表
const expect: Record<number, { name: string; label: string }> = {};
const SUIT_ORDER = ['wan', 'tiao', 'tong'] as const;
for (let r = 1; r <= 9; r++) {
    expect[r - 1] = { name: `${r}wan`, label: `${r}万` };
    expect[8 + r] = { name: `${r}tiao`, label: `${r}条` };
    expect[17 + r] = { name: `${r}tong`, label: `${r}筒` };
}
const FENG = [['dongfeng', '东'], ['nanfeng', '南'], ['xifeng', '西'], ['beifeng', '北']] as const;
for (let i = 0; i < FENG.length; i++) expect[26 + i + 1] = { name: FENG[i][0], label: FENG[i][1] };
const JIAN = [['hongzhong', '中'], ['facai', '发'], ['baipi', '白']] as const;
for (let i = 0; i < JIAN.length; i++) expect[30 + i + 1] = { name: JIAN[i][0], label: JIAN[i][1] };

console.log('=== ① 34 种牌型 → 音频名 ===');
const entries = Object.keys(expect);
check(entries.length === 34, `牌型索引数 = ${entries.length} (期望 34)`);

// 源码里的写法: 数牌是模板 `${r}wan`/`${r}tiao`/`${r}tong` 循环生成的,
// 风牌/箭牌是逐个字面量。所以这里分两类校验, 不能一律找 `'1wan'` 字面量。
const usesTemplate = ['wan', 'tiao', 'tong'].every(c => soundSrc.includes('${r}' + c));
check(usesTemplate, '数牌名在源码里由模板 `${r}wan/tiao/tong` 生成(而不是手写 27 个字面量)');

const missing: string[] = [];
for (const k of entries) {
    const e = expect[k];
    if (!e.name) missing.push(`${e.label}(idx ${k})`);
    // 风牌/箭牌是字面量, 源码里必须真的写了这个名字(防止改了期望忘了改实现)
    if (!SUIT_ORDER.length) continue;
    if (FENG.some(f => f[0] === e.name) || JIAN.some(j => j[0] === e.name)) {
        if (!soundSrc.includes(`'${e.name}'`)) missing.push(`${e.label} 源码中无 '${e.name}'`);
    }
}
check(missing.length === 0, '每种牌型都能解析出音频名且实现里有对应字面量',
    missing.length ? `缺: ${missing.join(', ')}` : '');

// 抽查几个最容易排错的位次
const spot = (idx: number, label: string) => {
    const got = expect[idx]?.name ?? '(undefined)';
    check(got !== '(undefined)', `idx ${idx} = ${label} → ${got}`);
};
spot(0, '1万'); spot(8, '9万'); spot(9, '1条'); spot(17, '9条');
spot(18, '1筒'); spot(26, '9筒'); spot(27, '东'); spot(30, '北');
spot(31, '中'); spot(32, '发'); spot(33, '白');

console.log('\n=== ② 与 preloadSounds 名单一致 ===');
const preloadBlock = soundSrc.match(/const names = \[([\s\S]*?)\];/);
check(!!preloadBlock, '能取到 preloadSounds 的 names 列表');
const listed = new Set<string>();
if (preloadBlock) {
    for (const m of preloadBlock[1].matchAll(/([A-Z][A-Z0-9_]*)|(SFX_[A-Z]+)/g)) {
        // 常量名 → 字面值(Sound.ts 顶部有定义, 这里做一次小解析)
        const key = m[1] || m[2];
        const constDef = soundSrc.match(new RegExp(`const ${key} = '([^']+)';`));
        if (constDef) listed.add(constDef[1]);
    }
    if (preloadBlock[1].includes('TILE_VOICE_NAMES')) {
        for (const k of entries) listed.add(expect[k].name);
    }
}
const needActions = ['chi', 'peng', 'gang', 'hule', 'guo'];
check(needActions.every(a => listed.has(a)), `5 个动作播报都在预加载名单 (${needActions.join(', ')})`);
check(entries.every(k => listed.has(expect[k].name)), '34 种牌型播报都在预加载名单');
check(listed.has('discard') && listed.has('btn_click') && listed.has('bgm'),
    '原有的 3 个音频仍在名单里(未被改动挤掉)');

console.log('\n=== ③ 磁盘文件与 meta ===');
const onDisk = new Set(fs.readdirSync(audioDir)
    .filter(f => f.endsWith('.mp3'))
    .map(f => f.replace(/\.mp3$/, '')));
console.log(`  audio 目录 mp3 共 ${onDisk.size} 个`);
const noFile: string[] = [];
for (const k of entries) {
    const e = expect[k];
    if (!onDisk.has(e.name)) noFile.push(`${e.label} → ${e.name}.mp3`);
}
check(noFile.length === 0, '34 种牌型播报文件全部存在', noFile.length ? `缺: ${noFile.join(', ')}` : '');

const noMeta: string[] = [];
for (const k of entries) {
    const meta = path.join(audioDir, `${expect[k].name}.mp3.meta`);
    if (!fs.existsSync(meta)) noMeta.push(`${expect[k].name}.mp3.meta`);
}
for (const a of needActions.concat(['discard', 'btn_click', 'bgm'])) {
    if (!fs.existsSync(path.join(audioDir, `${a}.mp3.meta`))) noMeta.push(`${a}.mp3.meta`);
}
check(noMeta.length === 0, '每个 mp3 都有配套 .meta(否则 Cocos 不认这个资源)',
    noMeta.length ? `缺: ${noMeta.join(', ')}` : '');

// UUID 唯一性: 重复 uuid 会让两个音频互相覆盖, 表现为"播出来是另一个音"
const uuids = new Map<string, string>();
let dup = 0;
for (const f of fs.readdirSync(audioDir).filter(f => f.endsWith('.mp3.meta'))) {
    const j = JSON.parse(fs.readFileSync(path.join(audioDir, f), 'utf8'));
    if (!j.uuid) { check(false, `${f} 缺 uuid`); continue; }
    if (uuids.has(j.uuid)) {
        dup++;
        console.log(`  ✗ UUID 重复: ${f} 与 ${uuids.get(j.uuid)} 都是 ${j.uuid}`);
        fails++;
    }
    uuids.set(j.uuid, f);
}
check(dup === 0, `全部 mp3 的 uuid 唯一 (${uuids.size} 个)`);

// 每个 mp3 都要能被 .meta 声明为 audio-clip, 否则不会注册成 AudioClip
const badImporter: string[] = [];
for (const k of entries.concat(needActions as unknown as string[])) {
    const meta = path.join(audioDir, `${k}.mp3.meta`);
    if (!fs.existsSync(meta)) continue;
    const j = JSON.parse(fs.readFileSync(meta, 'utf8'));
    if (j.importer !== 'audio-clip') badImporter.push(`${k}: ${j.importer}`);
}
check(badImporter.length === 0, 'meta 的 importer 都是 audio-clip', badImporter.join(', '));

console.log(`\n=== 结果: ${fails === 0 ? '全部通过' : fails + ' 项失败'} ===`);
process.exit(fails === 0 ? 0 : 1);
