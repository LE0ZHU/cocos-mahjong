/**
 * 跨会话战绩(生涯统计 + 会话比分快照) —— 纯数据与纯逻辑,不依赖引擎
 *
 * 【为什么要有它】累计分与连庄以前只活在内存里: 退出应用、或切后台被系统回收,
 * 就全部归零 —— 打了一半的会话一点痕迹都不留; 而"打过多少局、胡过几次"这类
 * **生涯**数据本来就该跨会话累积, 以前根本没记。
 *
 * 两层数据, 生命周期不同:
 *  - 生涯统计(`CareerStats`): 只增不减, 长期保留(总局数 / 胡牌次数 / 最高番 / 最高连庄)
 *  - 会话快照(`SessionSnapshot`): 当前这一串对局的累计分与连庄, **每局结算后落盘**。
 *    为的是"被杀掉再回来还能接着打"; 主动返回主页面时由 GameManager 清掉
 *    (那时候是玩家自己结束的会话, 不该留着)。
 *
 * 本文件不 import cc —— 统计与编解码都是纯函数, 可以直接用 node 跑断言
 * (真正碰引擎 `sys` 的持久化在 `game/CareerStore.ts`, 那里才 import cc)。
 */

/** 生涯统计(玩家口径: 只记"你"的成绩) */
export interface CareerStats {
    /** 打完的总局数(流局也算一局) */
    games: number;
    /** 玩家胡牌次数(一炮多响里玩家参与也算) */
    hu: number;
    /** 玩家胡过的最大番数 */
    bestFan: number;
    /** 玩家最长连庄(连续胡牌次数) */
    bestStreak: number;
}

/** 空战绩(新装游戏 / 清空后) */
export const EMPTY_CAREER: CareerStats = { games: 0, hu: 0, bestFan: 0, bestStreak: 0 };

/** 一局结束后喂给生涯统计的现场 */
export interface GameOutcome {
    /** 玩家这局有没有胡 */
    playerHu: boolean;
    /** 玩家这局的番数(没胡传 0) */
    fan: number;
    /** 玩家这局结束后的连庄次数(没胡自然是 0) */
    streak: number;
}

/** 会话比分快照: 四家累计分与连庄 */
export interface SessionSnapshot {
    scores: number[];
    streaks: number[];
}

/** 存档内容(生涯 + 会话一起存, 一个 key) */
export interface CareerData {
    career: CareerStats;
    /** 没有进行中的会话时为 null */
    session: SessionSnapshot | null;
}

/** 座位数(四家) */
export const SEAT_COUNT = 4;

/** 存档格式版本号(改结构时 +1, 老存档读不出来就按空处理) */
const DATA_VERSION = 1;

/**
 * 用一局结果更新生涯统计
 *
 * 【为什么是纯函数】结算那一步正在牌局结束的关键路径上, 就地改对象一旦抛异常
 * 就会把结算打断; 返回新对象则"算错最多是数字错, 不会炸流程"。
 *
 * 口径:
 *  - 总局数**含流局**: 玩家看到的"打了几局"就是结算了几次
 *  - 最高番只在**玩家真的胡了**时才更新(没胡的一局 fan 传 0, 不该把纪录刷成 0)
 *  - 最高连庄取"更新后的连庄次数", 没胡时那是 0, 取 max 不会拉低
 */
export function applyOutcome(career: CareerStats, outcome: GameOutcome): CareerStats {
    return {
        games: career.games + 1,
        hu: career.hu + (outcome.playerHu ? 1 : 0),
        bestFan: outcome.playerHu ? Math.max(career.bestFan, outcome.fan) : career.bestFan,
        bestStreak: Math.max(career.bestStreak, outcome.streak),
    };
}

/** 生涯战绩的一句话摘要(主菜单 / 结算面板共用, 免得两处写出两种说法) */
export function careerText(career: CareerStats): string {
    return `生涯 ${career.games} 局 · 胡 ${career.hu} 次 · 最高 ${career.bestFan} 番 · 最长连庄 ${career.bestStreak}`;
}

/** 空会话(四家 0 分 0 连庄) */
export function emptySession(): SessionSnapshot {
    return { scores: [0, 0, 0, 0], streaks: [0, 0, 0, 0] };
}

/** 取有限数字,非数字一律回落(存档可能被手改过,不能让 NaN 渗进比分条) */
function num(v: unknown, fallback = 0): number {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/** 把任意来源的对象洗成合法的生涯统计(缺字段补 0, 负数/小数一律取整并夹到非负) */
export function sanitizeCareer(raw: unknown): CareerStats {
    if (!raw || typeof raw !== 'object') return { ...EMPTY_CAREER };
    const o = raw as { [k: string]: unknown };
    return {
        games: Math.max(0, Math.floor(num(o.games))),
        hu: Math.max(0, Math.floor(num(o.hu))),
        bestFan: Math.max(0, Math.floor(num(o.bestFan))),
        bestStreak: Math.max(0, Math.floor(num(o.bestStreak))),
    };
}

/**
 * 把任意来源的对象洗成合法的比分快照
 *
 * 张数不对(少了/多了)一律补齐或截断到四家 —— 少一个元素会让 `scores[3]` 变成
 * undefined, 之后 `+undefined` 就直接把比分条刷成 NaN。
 */
export function sanitizeSession(raw: unknown): SessionSnapshot | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as { [k: string]: unknown };
    if (!Array.isArray(o.scores) || !Array.isArray(o.streaks)) return null;
    const scores: number[] = [];
    const streaks: number[] = [];
    for (let i = 0; i < SEAT_COUNT; i++) {
        scores.push(Math.floor(num(o.scores[i])));
        streaks.push(Math.max(0, Math.floor(num(o.streaks[i]))));
    }
    return { scores, streaks };
}

/** 存档 → 数据;损坏 / 空 / 不是对象一律给 null(调用方按"没有存档"处理) */
export function decodeCareerData(raw: string | null): CareerData | null {
    if (!raw) return null;
    try {
        const obj = JSON.parse(raw) as unknown;
        if (!obj || typeof obj !== 'object') return null;
        const o = obj as { [k: string]: unknown };
        return {
            career: sanitizeCareer(o.career),
            session: sanitizeSession(o.session),
        };
    } catch (e) {
        return null;
    }
}

/** 数据 → 存档字符串 */
export function encodeCareerData(data: CareerData): string {
    return JSON.stringify({
        v: DATA_VERSION,
        career: data.career,
        session: data.session,
    });
}
