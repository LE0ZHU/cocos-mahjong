import { sys } from 'cc';
import {
    CareerData, CareerStats, EMPTY_CAREER, GameOutcome, SessionSnapshot,
    applyOutcome, decodeCareerData, encodeCareerData,
} from './CareerStats';

/**
 * 战绩持久化: 把 `CareerStats` 的纯逻辑接到引擎的本地存储上
 *
 * 【为什么单独一个文件】`game/CareerStats.ts` 保持零 `cc` 依赖, 才能脱离引擎跑断言;
 * 而"存到哪儿、存不下怎么办"必须碰引擎的 `sys`, 于是收敛在这一个文件里
 * (与 `GameRules.ts` 是同一条分层约定: 规则/统计是纯的, 落盘这一层才 import cc)。
 *
 * 【为什么不在构造时读盘】原生(JSB)平台上 `sys.localStorage` 是 `sys.init()` 里
 * **异步**挂上去的(初始化前它是个空对象, `getItem` 根本不存在)。模块一 import 就
 * 去读, 读到的必然是"还没准备好"。所以这里改成**懒读 + 读到为止**: 每次访问先
 * 试一次, 成功才算 loaded; 没成功就下次再试(那期间按空战绩处理, 不影响开局)。
 */
const STORAGE_KEY = 'majiang.career.v1';

/** 存储对象的类型收窄(原生平台未就绪时它是空对象, 方法不存在) */
interface MiniStorage {
    getItem?: (key: string) => string | null;
    setItem?: (key: string, value: string) => void;
}

class CareerStore {
    private _career: CareerStats = { ...EMPTY_CAREER };
    private _session: SessionSnapshot | null = null;
    /** 是否已成功读过一次存档(没成功 → 下次访问继续试) */
    private _loaded = false;

    /** 生涯统计(只读;改动一律走 recordGame / reset) */
    get career(): CareerStats {
        this._ensureLoaded();
        return this._career;
    }

    /** 未结束的会话快照;没有(或还没读到)时为 null */
    get session(): SessionSnapshot | null {
        this._ensureLoaded();
        return this._session;
    }

    /**
     * 一局结束: 更新生涯统计, 并把最新的累计分 / 连庄一起落盘
     *
     * 为什么两件事一起做: 玩家看不到"存档"这个动作, 他只知道"打完一局"。
     * 分数一变就存, 于是**任何时刻被杀掉**都最多丢"正在打的这一局的未结算部分",
     * 而不是整串会话。
     */
    recordGame(outcome: GameOutcome, scores: number[], streaks: number[]): void {
        this._ensureLoaded();
        this._career = applyOutcome(this._career, outcome);
        this._session = { scores: scores.slice(), streaks: streaks.slice() };
        this._save();
    }

    /**
     * 正常结束会话(返回主页面): 只删快照, 生涯统计留着
     *
     * 玩家自己退出 = 这一串对局打完了, 下一次开局该从 0 开始;
     * 而生涯统计是"打过多少局"的历史, 不该跟着一起没。
     */
    clearSession(): void {
        this._ensureLoaded();
        this._session = null;
        this._save();
    }

    /** 清空全部战绩(生涯 + 会话),用于日后的"清空战绩"入口 */
    reset(): void {
        this._career = { ...EMPTY_CAREER };
        this._session = null;
        // 存储没就绪时不标记已读: 否则下一次保存会把"清空的空值"当成有效数据写进去
        if (this._ready()) this._loaded = true;
        this._save();
    }

    /**
     * 存储是否已就绪(原生平台 `sys.localStorage` 是异步挂上去的)
     *
     * 【为什么必须区分"就绪"与"有数据"】没就绪时 `getItem` 根本不存在, 与"存过但
     * 读出来是 null"是两回事。混为一谈的后果很隐蔽: 存储还没就绪 → 读到 null →
     * 当成"没有存档" → 一局结束后用内存里的空战绩**覆盖真存档**, 历史成绩就丢了。
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

    private _ensureLoaded(): void {
        if (this._loaded) return;
        const s = this._ready();
        if (!s) return;   // 还没就绪: 保持未读, 下次访问再试(期间按空战绩处理)
        this._loaded = true;
        let raw: string | null = null;
        try {
            raw = s.getItem(STORAGE_KEY) ?? null;
        } catch (e) {
            return;   // 存储被禁用 / 配额异常: 战绩丢了不影响打牌
        }
        const data: CareerData | null = decodeCareerData(raw);
        // 没存过 / 存档损坏 → 用空值, 但**已经算读过**(之后保存不会冲掉别人的数据)
        if (!data) return;
        this._career = data.career;
        this._session = data.session;
    }

    private _save(): void {
        const s = this._ready();
        // 没就绪就不写 —— 写了就等于用内存里的空值覆盖真存档(见 _ready 的注释)
        if (!s) return;
        try {
            s.setItem(STORAGE_KEY, encodeCareerData({
                career: this._career,
                session: this._session,
            }));
        } catch (e) {
            console.warn('[战绩] 保存到本地失败(本次战绩不会留存)', e);
        }
    }
}

/** 全局唯一的战绩存档 */
export const CAREER = new CareerStore();
