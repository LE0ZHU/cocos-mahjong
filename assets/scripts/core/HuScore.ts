import { Tile } from './Tile';
import { TileSuit } from './TileDefine';
import { Meld } from './Meld';
import { HuChecker } from './HuChecker';

/**
 * 番型判定与计分 - 纯函数,不依赖引擎
 *
 * 计分规则(简化的国标思路):
 *  - 底分 1 分, 每 1 番翻一倍 → N 番 = 2^N 分
 *  - 默认 8 番封顶(= 256 分)
 *
 * 番型表见文末的 `FAN_DEFS`(**唯一真源**: 判定与玩法说明页都读它, 别在这里再抄一份)。
 * 连庄番: 连续第 N 次胡牌加 (N−1) 番, 最多 `STREAK_FAN_MAX` 番。
 */

/** 单条番型(展示用) */
export interface FanItem {
    /** 番型名, 如 "清一色" */
    name: string;
    /** 番数 */
    fan: number;
}

/** 一次胡牌的完整结算结果 */
export interface HuResult {
    /** 命中的番型列表(按判定顺序排列) */
    fans: FanItem[];
    /** 总番数 */
    totalFan: number;
    /** 本次得分 */
    points: number;
    /** 是否超过封顶番数 */
    capped: boolean;
    /** 主导牌型名(十三幺/七对/对对胡/平胡) */
    patternName: string;
}

/** 胡牌现场信息(判定番型所需的全部上下文) */
export interface HuContext {
    /** 胡牌时的完整手牌(含和牌张) */
    hand: Tile[];
    /** 副露 */
    melds: Meld[];
    /** 是否自摸 */
    isSelfDraw: boolean;
    /** 是否杠后补摸胡(杠上开花) */
    isAfterKan: boolean;
    /** 是否摸到牌墙最后一张(海底捞月) */
    isLastTile: boolean;
    /** 是否抢杠胡 */
    isRobKan: boolean;
    /** 本次胡牌是本家的第几次连续胡牌(1 = 首次) */
    streak: number;
    /** 是否已宣告听牌(立直) */
    declaredTenpai: boolean;
}

/** 赢家在结算面板里的一行 */
export interface WinnerResult {
    seat: number;
    name: string;
    hu: HuResult;
    /** 本次得失分 */
    delta: number;
    /** 和的那张牌 */
    winTile: Tile | null;
    isSelfDraw: boolean;
    /**
     * 点炮者座位(胡牌特效"光点从付分方飞来"要用); 自摸 = -1
     *
     * ⚠️ 不能从 seats 的 delta 反推: 一炮多响时付分方只付一次,
     * 而且流局全员 delta 为 0 —— 让 GameManager 在结算时直接带上。
     */
    fromSeat: number;
}

/** 某一家在结算面板里的一行(四家都要有) */
export interface SeatResult {
    seat: number;
    name: string;
    hand: Tile[];
    melds: Meld[];
    /** 本次得失分 */
    delta: number;
    /** 累计分(含历史各局) */
    total: number;
    isWinner: boolean;
    declaredTenpai: boolean;
}

/** 整局结算数据 */
export interface SettlementData {
    /** hu=有人胡牌, draw=流局 */
    kind: 'hu' | 'draw';
    title: string;
    subtitle: string;
    winners: WinnerResult[];
    seats: SeatResult[];
    /**
     * 本局 AI 说的话(胡牌 / 点炮), 由结算面板显示
     *
     * 【为什么不走 `onAISpeech` 那条路】牌桌上的台词是个小气泡, 而结算面板一弹出
     * 就用整屏遮罩盖住牌桌 —— 胡牌那一刻冒气泡等于"闪一下就没了"。所以胡牌与
     * 点炮的台词随结算数据一起给出(碰/杠不改流程, 仍走气泡)。
     */
    speech?: string;
}

/** 底分: 0 番(平胡)就是 1 分 */
const BASE_POINTS = 1;
/** 封顶番数, 超过按封顶算 */
const MAX_FAN = 8;

/**
 * 番型一览: 名称 / 番数 / 一句话说明
 *
 * 【唯一真源】判定与"玩法说明页"共用这一份:
 *  - `computeHu` 里的番数一律通过 `pushFan(名称)` 取自本表, 不再有第二份常量
 *  - 菜单「玩法说明」页直接渲染本表(MenuUI.HELP 里的番型表)
 * 两边各写一份的后果是"说明写 4 番、判定按 3 番算" —— 玩家按说明打反而吃亏,
 * 与"提示必须与 AI 同源"(AGENTS.md 硬约束 13)是同一类要求。
 */
export interface FanDef {
    /** 番型名, 如 "清一色" */
    name: string;
    /** 番数 */
    fan: number;
    /** 触发条件的一句话说明(玩法说明页展示) */
    desc: string;
}

export const FAN_DEFS: FanDef[] = [
    // 牌型番(只取最高的那一种)
    { name: '平胡', fan: 0, desc: '普通顺子/刻子牌型, 不加番(底分 1 分)' },
    { name: '对对胡', fan: 2, desc: '4 组刻子/杠 + 1 对将' },
    { name: '七对', fan: 2, desc: '7 个对子(不能吃碰杠)' },
    { name: '十三幺', fan: 6, desc: '13 种幺九牌各一张, 再有一张成对' },
    // 花色番
    { name: '清一色', fan: 4, desc: '全部同一花色数牌' },
    { name: '混一色', fan: 2, desc: '一种数牌 + 字牌' },
    { name: '字一色', fan: 2, desc: '全是字牌(按混一色计分)' },
    // 状态番(可叠加)
    { name: '门清', fan: 1, desc: '全场没有吃/碰/明杠' },
    { name: '自摸', fan: 1, desc: '自己摸到和牌的那张' },
    { name: '立直', fan: 1, desc: '点「听牌」亮明听牌' },
    { name: '杠上开花', fan: 1, desc: '杠后补摸的那张自摸' },
    { name: '抢杠胡', fan: 1, desc: '抢别人补杠的那张牌胡' },
    { name: '海底捞月', fan: 1, desc: '摸到牌墙最后一张自摸' },
];

/** 连庄加番上限: 连续胡牌第 N 次 +（N−1）番, 最多加这么多 */
export const STREAK_FAN_MAX = 3;

/** 名称 → 番数(从 FAN_DEFS 建表, 免得每次判定都线性查) */
const FAN_BY_NAME: Map<string, number> = (() => {
    const m = new Map<string, number>();
    for (const d of FAN_DEFS) m.set(d.name, d.fan);
    return m;
})();

/**
 * 命中一个固定番型: 名称与番数都取自 FAN_DEFS
 *
 * 找不到名字时按 0 番处理(不抛异常: 这里在胡牌结算路径上, 半路炸掉比少一番更糟);
 * `tools/ai-test/help-layout-test.ts` 会断言 computeHu 里出现的每个名字都在表里。
 */
function pushFan(list: FanItem[], name: string): void {
    const v = FAN_BY_NAME.get(name);
    list.push({ name, fan: v === undefined ? 0 : v });
}

/** 庄家/连庄相关名字沿用外部传入的 SEAT_NAMES, 这里不关心 */
export function computeHu(ctx: HuContext): HuResult {
    const fans: FanItem[] = [];
    const pattern = HuChecker.analyze(ctx.hand, ctx.melds);
    let patternName = '平胡';

    if (pattern) {
        // 牌型番只取最高的那一种(十三幺 > 七对 > 对对胡 > 平胡)
        if (pattern.kind === 'thirteenOrphans') {
            pushFan(fans, '十三幺');
            patternName = '十三幺';
        } else if (pattern.kind === 'sevenPairs') {
            pushFan(fans, '七对');
            patternName = '七对';
        } else if (pattern.allTriplets) {
            pushFan(fans, '对对胡');
            patternName = '对对胡';
        } else {
            pushFan(fans, '平胡');
        }
    }

    // 花色番: 统计手牌 + 全部副露用到的花色
    const numberSuits = new Set<TileSuit>();
    let hasHonor = false;
    for (const t of ctx.hand) {
        if (t.suit === TileSuit.WAN || t.suit === TileSuit.TIAO || t.suit === TileSuit.TONG) {
            numberSuits.add(t.suit);
        } else {
            hasHonor = true;
        }
    }
    for (const m of ctx.melds) {
        for (const t of m.tiles) {
            if (t.suit === TileSuit.WAN || t.suit === TileSuit.TIAO || t.suit === TileSuit.TONG) {
                numberSuits.add(t.suit);
            } else {
                hasHonor = true;
            }
        }
    }
    if (numberSuits.size === 1 && !hasHonor) {
        pushFan(fans, '清一色');
    } else if (numberSuits.size === 1 && hasHonor) {
        pushFan(fans, '混一色');
    } else if (numberSuits.size === 0 && hasHonor) {
        // 全部字牌: 字一色, 按混一色计
        pushFan(fans, '字一色');
    }

    if (ctx.melds.length === 0) pushFan(fans, '门清');
    if (ctx.isSelfDraw) pushFan(fans, '自摸');
    if (ctx.declaredTenpai) pushFan(fans, '立直');
    if (ctx.isAfterKan) pushFan(fans, '杠上开花');
    if (ctx.isRobKan) pushFan(fans, '抢杠胡');
    if (ctx.isLastTile) pushFan(fans, '海底捞月');

    // 连庄番的番数依赖"第几次连庄", 不能进 FAN_DEFS(那张表是固定番值)
    const streakFan = ctx.streak >= 2 ? Math.min(ctx.streak - 1, STREAK_FAN_MAX) : 0;
    if (streakFan > 0) {
        fans.push({ name: `连庄×${ctx.streak - 1}`, fan: streakFan });
    }

    const totalFan = fans.reduce((s, f) => s + f.fan, 0);
    const effectiveFan = Math.min(totalFan, MAX_FAN);
    const points = BASE_POINTS * Math.pow(2, effectiveFan);

    return {
        fans,
        totalFan,
        points,
        capped: totalFan > MAX_FAN,
        patternName,
    };
}

/** 封顶番数(UI 提示用) */
export const FAN_CAP = MAX_FAN;
