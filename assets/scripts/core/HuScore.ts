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
 * 番型表:
 *  牌型番: 十三幺 6 / 七对 2 / 对对胡 2 / 平胡 0
 *  花色番: 清一色 4 / 混一色 2
 *  状态番: 自摸 1 / 门清 1 / 立直 1 / 杠上开花 1 / 抢杠胡 1 / 海底捞月 1
 *  连庄番: 连续第 N 次胡牌加 (N-1) 番, 最多加 3 番
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
}

/** 底分: 0 番(平胡)就是 1 分 */
const BASE_POINTS = 1;
/** 封顶番数, 超过按封顶算 */
const MAX_FAN = 8;

/** 各番型的番数 */
const FAN_SHISAN_ORPHANS = 6;
const FAN_SEVEN_PAIRS = 2;
const FAN_ALL_TRIPLETS = 2;
const FAN_PING = 0;
const FAN_FLUSH = 4;
const FAN_HALF_FLUSH = 2;
const FAN_SELF_DRAW = 1;
const FAN_MENQING = 1;
const FAN_RIICHI = 1;
const FAN_AFTER_KAN = 1;
const FAN_ROB_KAN = 1;
const FAN_LAST_TILE = 1;
/** 连庄最多加几番 */
const MAX_STREAK_FAN = 3;

/** 庄家/连庄相关名字沿用外部传入的 SEAT_NAMES, 这里不关心 */
export function computeHu(ctx: HuContext): HuResult {
    const fans: FanItem[] = [];
    const pattern = HuChecker.analyze(ctx.hand, ctx.melds);
    let patternName = '平胡';

    if (pattern) {
        if (pattern.kind === 'thirteenOrphans') {
            fans.push({ name: '十三幺', fan: FAN_SHISAN_ORPHANS });
            patternName = '十三幺';
        } else if (pattern.kind === 'sevenPairs') {
            fans.push({ name: '七对', fan: FAN_SEVEN_PAIRS });
            patternName = '七对';
        } else if (pattern.allTriplets) {
            fans.push({ name: '对对胡', fan: FAN_ALL_TRIPLETS });
            patternName = '对对胡';
        } else {
            fans.push({ name: '平胡', fan: FAN_PING });
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
        fans.push({ name: '清一色', fan: FAN_FLUSH });
    } else if (numberSuits.size === 1 && hasHonor) {
        fans.push({ name: '混一色', fan: FAN_HALF_FLUSH });
    } else if (numberSuits.size === 0 && hasHonor) {
        // 全部字牌: 字一色, 按混一色计
        fans.push({ name: '字一色', fan: FAN_HALF_FLUSH });
    }

    if (ctx.melds.length === 0) fans.push({ name: '门清', fan: FAN_MENQING });
    if (ctx.isSelfDraw) fans.push({ name: '自摸', fan: FAN_SELF_DRAW });
    if (ctx.declaredTenpai) fans.push({ name: '立直', fan: FAN_RIICHI });
    if (ctx.isAfterKan) fans.push({ name: '杠上开花', fan: FAN_AFTER_KAN });
    if (ctx.isRobKan) fans.push({ name: '抢杠胡', fan: FAN_ROB_KAN });
    if (ctx.isLastTile) fans.push({ name: '海底捞月', fan: FAN_LAST_TILE });

    const streakFan = ctx.streak >= 2 ? Math.min(ctx.streak - 1, MAX_STREAK_FAN) : 0;
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
