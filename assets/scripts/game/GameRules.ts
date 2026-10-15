import { sys } from 'cc';

/**
 * 游戏规则配置 - 纯数据,不依赖引擎节点
 *
 * 主页面 / 设置页面通过 GAME_RULES.setXxx() 修改,GameManager 在开局与回合调度时读取,
 * 因此改规则后重新开局即生效(牌局进行中不中途改规则)。
 */

/** AI 思考速度档位: 快 / 常规 / 慢 */
export const AI_SPEED_OPTIONS: { label: string; delay: number }[] = [
    { label: '快', delay: 0.22 },
    { label: '常规', delay: 0.5 },
    { label: '慢', delay: 0.9 },
];

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
    /** AI 思考间隔(秒),由速度档位换算 */
    aiDelay: number;
}

/** 默认规则: 允许吃牌、允许续杠、允许吃胡、慢 AI 速度 */
export const DEFAULT_RULES: GameRules = {
    allowChi: true,
    allowAddKan: true,
    allowChiHu: true,
    aiDelay: 0.9,
};

const STORAGE_KEY = 'majiang.rules.v2';

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

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

    setAiDelay(v: number): void {
        this._rules.aiDelay = clamp(v, 0.1, 2);
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
            && Math.abs(r.aiDelay - DEFAULT_RULES.aiDelay) < 1e-6;
    }

    private _changed(): void {
        this._save();
        for (const cb of this._listeners) cb(this._rules);
    }

    /** 从本地存储读取(失败则用默认值;原生平台无 localStorage 时静默跳过) */
    private _load(): void {
        if (sys.isNative) return;
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const data = JSON.parse(raw) as Partial<GameRules>;
            if (typeof data.allowChi === 'boolean') this._rules.allowChi = data.allowChi;
            if (typeof data.allowAddKan === 'boolean') this._rules.allowAddKan = data.allowAddKan;
            if (typeof data.allowChiHu === 'boolean') this._rules.allowChiHu = data.allowChiHu;
            if (typeof data.aiDelay === 'number') this._rules.aiDelay = clamp(data.aiDelay, 0.1, 2);
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
