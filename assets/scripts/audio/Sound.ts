import { AudioClip, AudioSource, Node, director, resources } from 'cc';
import { GAME_RULES } from '../game/GameRules';
import { Tile } from '../core/Tile';
import { tileIndexOf } from '../core/TileDefine';
import type { MeldType } from '../core/Meld';

/**
 * 音效 / 背景音乐播放
 *
 * 音频文件放在 assets/resources/audio,运行时用 resources.load 预加载为 AudioClip,
 * 播放器(AudioSource)在首次播放时程序化创建,不需要预制体、也不用往场景里挂组件。
 * 文件名:
 *   btn_click → 按钮点击声
 *   discard   → 麻将出牌声(牌型播报缺失时的兜底)
 *   bgm       → 背景音乐(循环播放)
 *   1wan ~ 9tong / dongfeng ~ beifeng / hongzhong、facai、baipi
 *            → 34 种牌型各自的播报(出牌时按牌型播)
 *   chi / peng / gang / hule / guo → 吃/碰/杠/胡/过 的动作播报
 *
 * 【音量与开关】
 * 音量不写死在这里, 而是运行时读 GAME_RULES(可在设置页调整)。
 * 关键点: 改设置必须**立刻生效**, 不能要求重启游戏:
 *   - 音效: 每次 playOneShot 都带当前音量 → 天然即时
 *   - BGM: AudioSource.volume 在开始播放时就固定了, 所以必须
 *     setBgmVolume() 主动同步到正在播放的播放器上;关开关则要 stop()
 */

/** 资源子目录 */
const AUDIO_DIR = 'audio';

/** 音频名(=文件名,与 resources/audio 下一致) */
const CLICK = 'btn_click';
const DISCARD = 'discard';
const BGM = 'bgm';

/** 动作播报 */
const SFX_CHI = 'chi';
const SFX_PENG = 'peng';
const SFX_GANG = 'gang';
const SFX_HULE = 'hule';
const SFX_GUO = 'guo';

/** 各音效的相对音量系数(在玩家设定的总音量之上再乘这个) */
const CLICK_VOLUME = 1;
const DISCARD_VOLUME = 1;
/**
 * 牌型播报音量
 *
 * 牌型播报比"啪"的出牌声更抢注意力(是有人在报牌), 所以略低一点,
 * 否则连续出牌时会盖住彼此。
 */
const TILE_VOICE_VOLUME = 0.9;
/** 动作播报音量: 胡最大(全场唯一的结束音), 其余次之 */
const ACTION_VOICE_VOLUME = 1;

/**
 * 牌型 → 音频文件名的映射
 *
 * 数牌用 `${rank}${花色}` (wan/tiao/tong) 由循环生成; 风牌与箭牌文件名不规则, 单独列。
 * 键是紧凑下标 `tileIndexOf(suit, rank)`(0~33), 与 AI 侧口径一致 ——
 * **下标写错不会抛异常, 只会播错音**, 所以由 tools/ai-test/voice-map-test.ts 对拍防回归。
 */
const TILE_VOICE_NAMES: Record<number, string> = (() => {
    const map: Record<number, string> = {};
    for (let r = 1; r <= 9; r++) {
        map[r - 1] = `${r}wan`;       // 万1-9  → 0-8
        map[8 + r] = `${r}tiao`;      // 条1-9  → 9-17
        map[17 + r] = `${r}tong`;     // 筒1-9  → 18-26
    }
    // 风牌: 东 南 西 北 (rank 1~4, 与 FENG_CHARS 同序)
    const fengNames = ['dongfeng', 'nanfeng', 'xifeng', 'beifeng'];
    for (let i = 0; i < fengNames.length; i++) map[26 + i + 1] = fengNames[i];
    // 箭牌: 中 发 白 (rank 1~3, 与 JIAN_CHARS 同序) — 文件名用俗名而非字面
    map[30 + 1] = 'hongzhong';   // 中
    map[30 + 2] = 'facai';       // 发
    map[30 + 3] = 'baipi';       // 白
    return map;
})();

/** 已加载的音频缓存: 文件名 → AudioClip */
const clips = new Map<string, AudioClip>();

/** 全局音效播放器(首次播放时创建,常驻场景根节点) */
let player: AudioSource | null = null;
/** 背景音乐播放器: 与音效分开,循环播放不会被打断 */
let bgmPlayer: AudioSource | null = null;
/** 是否请求过播放背景音乐(clip 还没加载完时置位,加载完成后自动补播) */
let bgmWanted = false;

/** 在场景根节点下建一个音频播放器 */
function createSource(nodeName: string): AudioSource | null {
    const scene = director.getScene();
    if (!scene) return null;
    const node = new Node(nodeName);
    node.parent = scene;
    return node.addComponent(AudioSource);
}

/** 取全局音效播放器,没有就现场创建一个 */
function getPlayer(): AudioSource | null {
    if (!player || !player.isValid) player = createSource('SoundPlayer');
    return player;
}

/** 取背景音乐播放器,没有就现场创建一个 */
function getBgmPlayer(): AudioSource | null {
    if (!bgmPlayer || !bgmPlayer.isValid) bgmPlayer = createSource('BgmPlayer');
    return bgmPlayer;
}

/** 当前设置里的音效总音量 */
function sfxVolume(): number {
    return GAME_RULES.rules.sfxVolume;
}

/** 当前设置里的 BGM 音量(开关关掉时返回 0) */
function bgmVolume(): number {
    return GAME_RULES.rules.bgmEnabled ? GAME_RULES.rules.bgmVolume : 0;
}

/** 播放某个音效(clip 还没加载好就静默跳过,不阻塞游戏) */
function play(name: string, scale: number): void {
    const clip = clips.get(name);
    if (!clip) return;
    const vol = sfxVolume();
    // 音量为 0 时直接跳过, 也避免 playOneShot(0) 产生无意义的播放调用
    if (vol <= 0.001) return;
    getPlayer()?.playOneShot(clip, vol * scale);
}

/** 按钮点击音效 */
export function playButtonClick(): void {
    play(CLICK, CLICK_VOLUME);
}

/** 出牌音效(自己与三家 AI 出牌都播) */
export function playDiscard(): void {
    play(DISCARD, DISCARD_VOLUME);
}

/**
 * 播报"打出了哪张牌"
 *
 * 四家出牌都调用, 播的是**牌型专属**的人声播报(如"五万"), 而不是统一的落牌声 ——
 * 这正是麻将听声辨牌的意义所在。
 * 找不到该牌型的音频(比如某个 mp3 没导入)时自动退回通用落牌声, 不会静默。
 */
export function playTileVoice(tile: Tile): void {
    const name = TILE_VOICE_NAMES[tileIndexOf(tile.suit, tile.rank)];
    if (name && clips.has(name)) {
        play(name, TILE_VOICE_VOLUME);
    } else {
        play(DISCARD, DISCARD_VOLUME);
    }
}

/** 副露动作播报(吃/碰/杠), 只报动作不报牌型 —— 动作词比牌型更重要, 玩家要立刻知道能不能动手 */
export function playMeldVoice(type: MeldType): void {
    const name = type === 'chi' ? SFX_CHI : type === 'pon' ? SFX_PENG : SFX_GANG;
    play(name, ACTION_VOICE_VOLUME);
}

/** 胡牌播报 */
export function playHuVoice(): void {
    play(SFX_HULE, ACTION_VOICE_VOLUME);
}

/** "过"播报: 玩家主动放弃吃碰杠/点炮时反馈 */
export function playPassVoice(): void {
    play(SFX_GUO, ACTION_VOICE_VOLUME);
}

/**
 * 播放背景音乐(循环)
 * 重复调用无副作用: 已经在播就直接返回;clip 还没加载完则记下意图,加载完成后自动补播。
 * 设置里关掉 BGM 时本函数不会开声(preload 完成后会自动补播,那里同样会判开关)。
 */
export function playBgm(): void {
    if (!GAME_RULES.rules.bgmEnabled) {
        bgmWanted = false;
        stopBgm();
        return;
    }
    bgmWanted = true;
    const clip = clips.get(BGM);
    if (!clip) return;
    const src = getBgmPlayer();
    if (!src || src.playing) {
        // 已经在播: 顺手把音量同步到最新设置(玩家中途调过音量的情况)
        if (src && src.playing) src.volume = bgmVolume();
        return;
    }
    src.clip = clip;
    src.loop = true;
    src.volume = bgmVolume();
    src.play();
}

/**
 * 停止背景音乐
 * AudioSource 的 volume 在 play() 时就固定了, 所以"关掉开关"不能只把音量设成 0
 * (那样播放器仍在占用, 还可能被 playBgm 的"已在播就返回"逻辑挡住),
 * 必须真的 stop()。
 */
export function stopBgm(): void {
    bgmWanted = false;
    const src = bgmPlayer;
    if (src && src.isValid && src.playing) src.stop();
}

/**
 * 设置页改了音量/开关后调用, 把新值同步到正在播放的播放器
 *
 * 不直接依赖 GameRules 的 onChange: 那是 UI 层的事,
 * 音频模块自己提供显式同步口, 避免设置页忘了调用导致"改了没反应"。
 */
export function syncAudioSettings(): void {
    // BGM: 关 → 停;开且没在播 → 补播;在播 → 只更新音量
    if (!GAME_RULES.rules.bgmEnabled) {
        stopBgm();
    } else {
        const src = bgmPlayer;
        if (src && src.isValid && src.playing) {
            src.volume = bgmVolume();
        } else {
            playBgm();
        }
    }
}

/**
 * 预加载全部音效与背景音乐,全部完成后回调 onReady
 *
 * 39 个播报文件都很短(0.2~0.4s, 几 KB), 一次性预加载的开销可以忽略,
 * 换来的是"第一张牌打出来就有声音" —— 否则首轮出牌会因资源未就绪而静音。
 */
export function preloadSounds(onReady?: () => void): void {
    const names = [
        CLICK, DISCARD, BGM,
        SFX_CHI, SFX_PENG, SFX_GANG, SFX_HULE, SFX_GUO,
        ...Object.keys(TILE_VOICE_NAMES).map(k => TILE_VOICE_NAMES[Number(k)]),
    ];
    const finish = (): void => {
        // 之前调用过 playBgm 但资源还没好: 在这里补播
        // (playBgm 内部会判开关, 关着就不会开声)
        if (bgmWanted) playBgm();
        onReady?.();
    };
    let pending = names.length;
    for (const name of names) {
        if (clips.has(name)) {
            pending--;
            continue;
        }
        resources.load(`${AUDIO_DIR}/${name}`, AudioClip, (err, clip) => {
            if (!err && clip) {
                clips.set(name, clip);
            } else if (err) {
                console.warn(`[Sound] 加载音频失败: ${name}`, err);
            }
            pending--;
            if (pending === 0) finish();
        });
    }
    if (pending === 0) finish();
}