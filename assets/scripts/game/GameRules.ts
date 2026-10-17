import { sys } from 'cc';
import { AIDifficulty } from './AIBrain';

/**
 * 游戏规则配置 - 纯数据,不依赖引擎节点
 *
 * 主页面 / 设置页面通过 GAME_RULES.setXxx() 修改,GameManager 在开局与回合调度时读取,
 * 因此改规则后重新开局即生效(牌局进行中不中途改规则)。
 */

/**
 * AI 出牌节奏延时(秒)
 *
 * 曾经这里是"快/常规/慢"三档, 用户可选。现在**已固定**为单一值:
 * 速度档同时决定 AI 强度(reckless/balanced/expert), 让玩家用"速度"换"难度"
 * 并不合理 —— 慢思考不代表弱, 快思考也不代表强。
 * 因此设置页不再暴露这一项, AI 恒定使用最大能力档(expert)。
 *
 * 保留这个延时的唯一目的: 让玩家看清每一步在发生什么(AI 瞬间出牌会很突兀),
 * 它**不参与**任何计算量控制。
 */
export const AI_DELAY = 0.9;

/** 由思考延时换算 AI 难度 —— 恒为最大能力档 */
export function difficultyOfDelay(_delay: number): AIDifficulty {
    return 'expert';
}

/** 起手牌数(固定 13 张,不可配置;胡牌即 14 张) */
export const HAND_SIZE = 13;

/** 可选规则集合 */
export interface GameRules {
    /** 是否允许吃牌(碰/杠不受影响) */
    allowChi: boolean;
    /** 是否允许续杠: 碰过的牌后来又摸到,可以补成杠 */
    allowAddKan: boolean;
    /** 是否允许吃胡(点炮): 听牌时别人打出所听的牌,可以选择胡 */
    allowChiHu: boolean;
    /** 是否允许抢杠胡: 别人补杠时可以抢那张牌胡 */
    allowRobKan: boolean;
    /** 是否允许一炮多响: 多家同时听同一张牌时可以一起胡 */
    allowMultiRon: boolean;
    /** 是否允许听牌宣言(立直): 亮明听牌后加 1 番, 但本局不能再吃/碰/杠 */
    allowRiichi: boolean;
    /**
     * AI 出牌节奏延时(秒) —— 固定值, 不可设置。
     * 只影响"两次 AI 行动之间停顿多久", 不影响 AI 的计算量与强度。
     */
    aiDelay: number;

    // ---- 音频设置(与玩法无关, 但同样持久化) ----
    /** 音效音量 0~1(按钮点击、出牌声) */
    sfxVolume: number;
    /** 背景音乐开关 */
    bgmEnabled: boolean;
    /** 背景音乐音量 0~1(独立于音效, 默认低于音效以免盖过出牌声) */
    bgmVolume: number;
}

/** 默认规则: 允许吃牌、续杠、吃胡、抢杠、一炮多响、听牌宣言;AI 满能力;音效满音量+BGM 半音量 */
export const DEFAULT_RULES: GameRules = {
    allowChi: true,
    allowAddKan: true,
    allowChiHu: true,
    allowRobKan: true,
    allowMultiRon: true,
    allowRiichi: true,
    aiDelay: AI_DELAY,
    sfxVolume: 1,
    bgmEnabled: true,
    bgmVolume: 0.5,
};

const STORAGE_KEY = 'majiang.rules.v2';

/**
 * 存储对象的类型收窄(原生平台未就绪时它是空对象, 方法不存在)
 *
 * 与 `game/CareerStore.ts` 同一个坑: 原生(JSB)平台上 `sys.localStorage` 是
 * `sys.init()` 里**异步**挂上去的, 初始化前它是个空对象、`getItem` 根本不存在。
 * 模块一 import 就去读, 读到的必然是"还没准备好"。
 *
 * 【这里曾经犯过的错】早期为了避开这个坑, `_load` / `_save` 里直接
 * `if (sys.isNative) return;` —— 等于**原生平台压根不存规则**: 玩家在真机上
 * 改完规则, 杀进程再进来又回到默认值。正确做法不是"放弃原生", 而是
 * **探到就绪再读写**。
 */
interface MiniStorage {
    getItem?: (key: string) => string | null;
    setItem?: (key: string, value: string) => void;
}

/**
 * 全局规则单例(非 Component,菜单与对局共享同一份数据)
 *
 * 【持久化策略】每次 setXxx 立刻落盘(与战绩同一口径: 玩家看不到"保存"这个动作,
 * 改一下就该永远记住), 于是**任何时刻被杀进程**都不会丢已做的设置。
 * 读盘是**懒读 + 读到为止**: 存储没就绪时按默认值走, 下次访问再试,
 * 一旦读到就 `_notify()` 让已经按默认值渲染好的 UI(设置页选中态 / 主页摘要 /
 * 音量)自己纠回来。
 */
class GameRulesStore {
    private _rules: GameRules = { ...DEFAULT_RULES };
    private _listeners: ((rules: Readonly<GameRules>) => void)[] = [];
    /** 是否已成功读过一次存档(没成功 → 下次访问继续试) */
    private _loaded = false;
    /** 首次读盘完成后的回调(音频要用它把音量补同步到播放器上) */
    private _loadedCbs: (() => void)[] = [];

    constructor() {
        this._ensureLoaded();
    }

    /** 当前规则(只读;改动请走 setXxx) */
    get rules(): Readonly<GameRules> {
        this._ensureLoaded();
        return this._rules;
    }

    // ---- 玩法开关 ----
    // 每个 setter 前都先 _ensureLoaded(): 必须先读存档再改, 否则"读到之前改的那一项"
    // 会在之后读盘时被存档覆盖掉(顺序反了就是"改了没生效")。

    setAllowChi(v: boolean): void {
        this._ensureLoaded();
        this._rules.allowChi = !!v;
        this._changed();
    }

    setAllowAddKan(v: boolean): void {
        this._ensureLoaded();
        this._rules.allowAddKan = !!v;
        this._changed();
    }

    setAllowChiHu(v: boolean): void {
        this._ensureLoaded();
        this._rules.allowChiHu = !!v;
        this._changed();
    }

    setAllowRobKan(v: boolean): void {
        this._ensureLoaded();
        this._rules.allowRobKan = !!v;
        this._changed();
    }

    setAllowMultiRon(v: boolean): void {
        this._ensureLoaded();
        this._rules.allowMultiRon = !!v;
        this._changed();
    }

    setAllowRiichi(v: boolean): void {
        this._ensureLoaded();
        this._rules.allowRiichi = !!v;
        this._changed();
    }

    // ---- 音频设置 ----

    /** 音效音量(0~1);置 0 等价于静音所有音效 */
    setSfxVolume(v: number): void {
        this._ensureLoaded();
        this._rules.sfxVolume = Math.max(0, Math.min(1, v));
        this._changed();
    }

    /** 背景音乐开关 */
    setBgmEnabled(v: boolean): void {
        this._ensureLoaded();
        this._rules.bgmEnabled = !!v;
        this._changed();
    }

    /** 背景音乐音量(0~1) */
    setBgmVolume(v: number): void {
        this._ensureLoaded();
        this._rules.bgmVolume = Math.max(0, Math.min(1, v));
        this._changed();
    }

    /** 恢复默认规则 */
    reset(): void {
        this._ensureLoaded();
        this._rules = { ...DEFAULT_RULES };
        this._changed();
    }

    /** 注册规则变化回调(设置页用它刷新选中态) */
    onChange(cb: (rules: Readonly<GameRules>) => void): void {
        this._listeners.push(cb);
    }

    /**
     * 注册"首次读盘完成"回调;注册时已经读过则立即执行
     *
     * 【为什么需要它】`Main.start()` / `playBgm()` 可能在存储就绪**之前**就读过
     * `rules`(那时拿到的是默认音量), 之后读到存档时播放器不会自己变 ——
     * 由这个回调把音量补同步一次。
     */
    onLoaded(cb: () => void): void {
        if (this._loaded) {
            cb();
            return;
        }
        this._loadedCbs.push(cb);
    }

    /**
     * 主动尝试读一次存档(调用方:`Main.start()`)
     *
     * 返回是否已读到。没读到不是错误 —— 说明存储还没就绪, 下次访问会再试。
     */
    ensureLoaded(): boolean {
        this._ensureLoaded();
        return this._loaded;
    }

    /** 当前规则是否为默认值 */
    get isDefault(): boolean {
        const r = this._rules;
        return r.allowChi === DEFAULT_RULES.allowChi
            && r.allowAddKan === DEFAULT_RULES.allowAddKan
            && r.allowChiHu === DEFAULT_RULES.allowChiHu
            && r.allowRobKan === DEFAULT_RULES.allowRobKan
            && r.allowMultiRon === DEFAULT_RULES.allowMultiRon
            && r.allowRiichi === DEFAULT_RULES.allowRiichi
            && Math.abs(r.aiDelay - DEFAULT_RULES.aiDelay) < 1e-6
            && Math.abs(r.sfxVolume - DEFAULT_RULES.sfxVolume) < 1e-6
            && r.bgmEnabled === DEFAULT_RULES.bgmEnabled
            && Math.abs(r.bgmVolume - DEFAULT_RULES.bgmVolume) < 1e-6;
    }

    private _changed(): void {
        this._save();
        this._notify();
    }

    /** 通知所有监听者(改动与"读盘纠回"共用同一条通道) */
    private _notify(): void {
        for (const cb of this._listeners) cb(this._rules);
    }

    /**
     * 存储是否已就绪(原生平台 `sys.localStorage` 是异步挂上去的)
     *
     * 【为什么必须区分"就绪"与"有数据"】没就绪时 `getItem` 根本不存在, 与"存过但
     * 读出来是 null"是两回事。混为一谈的后果很隐蔽: 存储还没就绪 → 读到 null →
     * 当成"没有存档" → 玩家一改设置就用内存里的默认值**覆盖真存档**。
     * 所以"没就绪"时一律**只读不写**。
     */
    private _ready(): MiniStorage | null {
        try {
            const s = sys.localStorage as unknown as MiniStorage | null;
            if (!s || typeof s.getItem !== 'function' || typeof s.setItem !== 'function') return null;
            return s;
        } catch (e) {
            return null;
        }
    }

    /**
     * 懒读存档: 读到为止(每次都试, 成功一次就 `_loaded`)
     *
     * 读到后若与内存里的值不同, 用 `_notify()` 让 UI 自己纠回来 ——
     * 启动时 UI 可能在读盘之前就已经按默认值渲染好了选中态与摘要。
     */
    private _ensureLoaded(): void {
        if (this._loaded) return;
        const s = this._ready();
        if (!s) return;   // 还没就绪: 保持未读, 下次访问再试(期间按默认规则走)
        this._loaded = true;
        const before = JSON.stringify(this._rules);
        // aiDelay 是固定值, 不从存储恢复: 旧版本存过"快/慢"档,
        // 若照搬会把节奏改回去。难度已恒为 expert, 节奏一律用 AI_DELAY。
        this._rules.aiDelay = AI_DELAY;

        let raw: string | null = null;
        try {
            raw = s.getItem(STORAGE_KEY) ?? null;
        } catch (e) {
            console.warn('[规则] 读取本地设置失败,使用默认规则', e);
        }
        if (raw) {
            try {
                const data = JSON.parse(raw) as Partial<GameRules>;
                if (typeof data.allowChi === 'boolean') this._rules.allowChi = data.allowChi;
                if (typeof data.allowAddKan === 'boolean') this._rules.allowAddKan = data.allowAddKan;
                if (typeof data.allowChiHu === 'boolean') this._rules.allowChiHu = data.allowChiHu;
                if (typeof data.allowRobKan === 'boolean') this._rules.allowRobKan = data.allowRobKan;
                if (typeof data.allowMultiRon === 'boolean') this._rules.allowMultiRon = data.allowMultiRon;
                if (typeof data.allowRiichi === 'boolean') this._rules.allowRiichi = data.allowRiichi;
                if (typeof data.sfxVolume === 'number') this._rules.sfxVolume = Math.max(0, Math.min(1, data.sfxVolume));
                if (typeof data.bgmEnabled === 'boolean') this._rules.bgmEnabled = data.bgmEnabled;
                if (typeof data.bgmVolume === 'number') this._rules.bgmVolume = Math.max(0, Math.min(1, data.bgmVolume));
            } catch (e) {
                // 数据损坏/被禁用: 保持默认值即可,不阻断游戏
                console.warn('[规则] 本地设置已损坏,使用默认规则', e);
            }
        }

        // 读到的东西和 UI 已经显示的不一样 → 让 UI 自己刷新
        if (JSON.stringify(this._rules) !== before) this._notify();
        // 首次读盘完成(音频要把音量补同步到播放器上)
        const cbs = this._loadedCbs;
        this._loadedCbs = [];
        for (const cb of cbs) cb();
    }

    private _save(): void {
        // 没就绪就不写 —— 写了就等于用内存里的默认值覆盖真存档(见 _ready 的注释)
        const s = this._ready();
        if (!s) return;
        try {
            s.setItem(STORAGE_KEY, JSON.stringify(this._rules));
        } catch (e) {
            console.warn('[规则] 保存本地设置失败(本次设置不会留存)', e);
        }
    }
}

/** 全局唯一的规则实例 */
export const GAME_RULES = new GameRulesStore();
