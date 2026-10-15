import { AudioClip, AudioSource, Node, director, resources } from 'cc';

/**
 * 音效 / 背景音乐播放
 *
 * 音频文件放在 assets/resources/audio,运行时用 resources.load 预加载为 AudioClip,
 * 播放器(AudioSource)在首次播放时程序化创建,不需要预制体、也不用往场景里挂组件。
 * 文件名:
 *   btn_click → 按钮点击声
 *   discard   → 麻将出牌声
 *   bgm       → 背景音乐(循环播放)
 */

/** 资源子目录 */
const AUDIO_DIR = 'audio';

/** 音频名(=文件名,与 resources/audio 下一致) */
const CLICK = 'btn_click';
const DISCARD = 'discard';
const BGM = 'bgm';

/** 各音效音量(0~1) */
const CLICK_VOLUME = 1;
const DISCARD_VOLUME = 1;
/** 背景音乐音量(低于音效,避免盖过出牌声) */
const BGM_VOLUME = 0.5;

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

/** 播放某个音效(clip 还没加载好就静默跳过,不阻塞游戏) */
function play(name: string, volume: number): void {
    const clip = clips.get(name);
    if (!clip) return;
    getPlayer()?.playOneShot(clip, volume);
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
 * 播放背景音乐(循环)
 * 重复调用无副作用: 已经在播就直接返回;clip 还没加载完则记下意图,加载完成后自动补播。
 */
export function playBgm(): void {
    bgmWanted = true;
    const clip = clips.get(BGM);
    if (!clip) return;
    const src = getBgmPlayer();
    if (!src || src.playing) return;
    src.clip = clip;
    src.loop = true;
    src.volume = BGM_VOLUME;
    src.play();
}

/** 预加载全部音效与背景音乐,全部完成后回调 onReady */
export function preloadSounds(onReady?: () => void): void {
    const names = [CLICK, DISCARD, BGM];
    const finish = (): void => {
        // 之前调用过 playBgm 但资源还没好: 在这里补播
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
