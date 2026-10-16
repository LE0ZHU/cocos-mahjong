/**
 * 播报时序复核(声音会不会叠在一起)
 *
 * 背景: 牌名播报(0.2~0.4s)与吃/碰/杠播报如果**同帧**响起, 两段声音会重叠,
 * 玩家什么都听不清(真机反馈)。修复方式是给"别家响应"加一个反应间隔
 * `GameManager.MELD_REACT_DELAY`, 让牌名放完再开口。
 *
 * 这个脚本的价值: **间隔是按素材时长定的**, 换一批更长的语音就会重新叠上,
 * 而这种问题在编辑器里看不出来(要真机听)。所以从真实源码取间隔、
 * 从真实 mp3 量时长, 两边对拍。
 *
 * 复核三件事:
 *  ① 反应间隔 ≥ 最长牌名播报(否则牌名还没放完就被"碰"盖住)
 *  ② 反应间隔不超 0.8s(AI 不能显得迟钝)
 *  ③ 副露播报 → 下一张牌名播报 的总间隔 ≥ 动作播报时长
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

const gmSrc = fs.readFileSync(findFile('assets/scripts/managers/GameManager.ts'), 'utf8');
const audioDir = path.join(path.dirname(findFile('assets/scripts/managers/GameManager.ts')),
    '../../resources/audio');

let fails = 0;
function check(cond: boolean, label: string, detail = ''): void {
    if (cond) console.log(`  ✓ ${label}`);
    else { fails++; console.log(`  ✗ ${label} ${detail}`); }
}

/** mp3 时长(秒): 扫第一个帧头, 用 MPEG1 Layer3 码率表换算 */
function mp3Duration(file: string): number {
    const b = fs.readFileSync(file);
    const BITRATE = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
    const SAMPLERATE = [44100, 48000, 32000, 0];
    for (let i = 0; i < Math.min(b.length - 4, 4000); i++) {
        if (b[i] === 0xFF && (b[i + 1] & 0xE0) === 0xE0) {
            const br = BITRATE[(b[i + 2] >> 4) & 0xF] * 1000;
            const sr = SAMPLERATE[(b[i + 2] >> 2) & 0x3];
            if (br > 0 && sr > 0) return (b.length - i) * 8 / br;
        }
    }
    return 0;
}

// 从真实源码取两个时序常量
const reactM = gmSrc.match(/const MELD_REACT_DELAY = ([0-9.]+);/);
check(!!reactM, '源码里能取到 MELD_REACT_DELAY');
const REACT = reactM ? Number(reactM[1]) : 0;

const aiDelayM = gmSrc.match(/import\s*\{[^}]*AI_DELAY[^}]*\}\s*from\s*'\.\.\/game\/GameRules'/)
    || gmSrc.match(/AI_DELAY/);
check(!!aiDelayM, 'GameManager 引入了 AI_DELAY');

const rulesSrc = fs.readFileSync(findFile('assets/scripts/game/GameRules.ts'), 'utf8');
const aiM = rulesSrc.match(/export const AI_DELAY = ([0-9.]+);/);
const AI_DELAY = aiM ? Number(aiM[1]) : 0;

// 分类素材
const all = fs.readdirSync(audioDir).filter(f => f.endsWith('.mp3'));
const isTile = (f: string): boolean =>
    /^\d(tiao|tong|wan)\.mp3$/.test(f)
    || /^(dongfeng|nanfeng|xifeng|beifeng|hongzhong|facai|baipi)\.mp3$/.test(f);
const tileFiles = all.filter(isTile);
const actFiles = ['chi', 'peng', 'gang'].map(n => `${n}.mp3`).filter(f => all.includes(f));

const maxOf = (files: string[]): number =>
    files.reduce((m, f) => Math.max(m, mp3Duration(path.join(audioDir, f))), 0);

const maxTile = maxOf(tileFiles);
const maxAct = maxOf(actFiles);

console.log('=== 提取到的时序 ===');
console.log(`  MELD_REACT_DELAY = ${REACT}s   AI_DELAY = ${AI_DELAY}s`);
console.log(`  牌名播报 ${tileFiles.length} 个, 最长 ${maxTile.toFixed(2)}s`);
console.log(`  动作播报 ${actFiles.length} 个, 最长 ${maxAct.toFixed(2)}s`);

console.log('\n=== ① 牌名与副露播报不重叠 ===');
check(REACT >= maxTile, `反应间隔 ${REACT}s ≥ 最长牌名播报 ${maxTile.toFixed(2)}s`,
    REACT < maxTile ? `→ 仍重叠 ${(maxTile - REACT).toFixed(3)}s, 换更长的语音会复发` : '');

console.log('\n=== ② 节奏观感 ===');
// 上限: 超过 0.8s AI 就显得在"想很久", 反而拖沓
check(REACT <= 0.8, `反应间隔 ${REACT}s ≤ 0.8s(AI 不显迟钝)`);
// 下限的另一种表达: 间隔太短(<0.15s)玩家会以为是"卡了一下"而不是"对家在反应"
check(REACT >= 0.15, `反应间隔 ${REACT}s ≥ 0.15s(短到不像停顿会像卡顿)`);

console.log('\n=== ③ 副露播报 → 下一张牌名 ===');
// 副露者接着出牌, 走 _continueAfterKanDraw 再等 AI_DELAY
const gap = REACT + AI_DELAY;
check(gap >= maxAct, `碰 → 下一张牌名 间隔 ${gap.toFixed(2)}s ≥ 动作播报 ${maxAct.toFixed(2)}s`);

console.log('\n=== ④ 状态机完整性 ===');
// DISCARDING 必须存在, 否则等待窗口内玩家点了手牌却"没反应"
check(/DISCARDING/.test(gmSrc), 'GamePhase 里有 DISCARDING(别家反应窗口)');
// UI 不应再手写 phase 枚举, 否则漏掉 DISCARDING 会导致指针闪烁
check(gmSrc.includes('isTurnRunning'), 'GameManager 提供 isTurnRunning');
const mainSrc = fs.readFileSync(findFile('assets/scripts/Main.ts'), 'utf8');
check(!/phase === GamePhase\.PLAYER_TURN \|\| .*phase === GamePhase\.AI_TURN/.test(mainSrc),
    'Main.ts 不再手写"进行中=PLAYER_TURN||AI_TURN"(漏 DISCARDING 会闪烁)');
// 窗口内必须禁止出牌, 否则玩家能在别人反应前抢先打牌
check(/phase !== GamePhase\.PLAYER_TURN \|\| !gm\.canDiscard/.test(mainSrc),
    '点击/拖拽出牌仍以 PLAYER_TURN 为准(窗口内点不动)');

console.log(`\n=== 结果: ${fails === 0 ? '全部通过' : fails + ' 项失败'} ===`);
process.exit(fails === 0 ? 0 : 1);