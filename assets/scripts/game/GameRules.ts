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
 * 全局规则单例(非 Component,菜单与对局共享同一份数据)
 */
class GameRulesStore {
    private _rules: GameRules = { ...DEFAULT_RULES };
    private _listeners: ((rules: Readonly<GameRules>) => void)[] = [];

    constructor() {
        this._load();
    }

    /** 当前规则(只读;改动请走 setXxx) */
    get rules(): Readonly<GameRules> {
        return this._rules;
    }

    setAllowChi(v: boolean): void {
        this._rules.allowChi = !!v;
        this._changed();
    }

    setAllowAddKan(v: boolean): void {
        this._rules.allowAddKan = !!v;
        this._changed();
    }

    setAllowChiHu(v: boolean): void {
        this._rules.allowChiHu = !!v;
        this._changed();
    }

    setAllowRobKan(v: boolean): void {
        this._rules.allowRobKan = !!v;
        this._changed();
    }

    setAllowMultiRon(v: boolean): void {
        this._rules.allowMultiRon = !!v;
        this._changed();
    }

    setAllowRiichi(v: boolean): void {
        this._rules.allowRiichi = !!v;
        this._changed();
    }

    // ---- 音频设置 ----

    /** 音效音量(0~1);置 0 等价于静音所有音效 */
    setSfxVolume(v: number): void {
        this._rules.sfxVolume = Math.max(0, Math.min(1, v));
        this._changed();
    }

    /** 背景音乐开关 */
    setBgmEnabled(v: boolean): void {
        this._rules.bgmEnabled = !!v;
        this._changed();
    }

    /** 背景音乐音量(0~1) */
    setBgmVolume(v: number): void {
        this._rules.bgmVolume = Math.max(0, Math.min(1, v));
        this._changed();
    }

    /** 恢复默认规则 */
    reset(): void {
        this._rules = { ...DEFAULT_RULES };
        this._changed();
    }

    /** 注册规则变化回调(设置页用它刷新选中态) */
    onChange(cb: (rules: Readonly<GameRules>) => void): void {
        this._listeners.push(cb);
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
        for (const cb of this._listeners) cb(this._rules);
    }

    /** 从本地存储读取(失败则用默认值;原生平台无 localStorage 时静默跳过) */
    private _load(): void {
        // aiDelay 是固定值, 不从存储恢复: 旧版本存过"快/慢"档,
        // 若照搬会把节奏改回去。难度已恒为 expert, 节奏一律用 AI_DELAY。
        this._rules.aiDelay = AI_DELAY;
        if (sys.isNative) return;
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
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
            console.warn('[规则] 读取本地设置失败,使用默认规则', e);
        }
    }

    private _save(): void {
        if (sys.isNative) return;
        try {
            sys.localStorage.setItem(STORAGE_KEY, JSON.stringify(this._rules));
        } catch (e) {
            console.warn('[规则] 保存本地设置失败', e);
        }
    }
}

/** 全局唯一的规则实例 */
export const GAME_RULES = new GameRulesStore();
