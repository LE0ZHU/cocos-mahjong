/**
 * 麻将牌定义 - 花色、点数、显示名称等常量
 * 纯数据定义,不依赖引擎
 */

/** 牌花色 */
export enum TileSuit {
    WAN = 0,    // 万子
    TIAO = 1,   // 条子(索子)
    TONG = 2,   // 筒子(饼子)
    FENG = 3,   // 风牌: 东南西北
    JIAN = 4,   // 箭牌: 中发白
}

/** 数牌花色汉字(万子用繁体"萬",仿真实麻将牌) */
export const SUIT_CHARS: Record<number, string> = {
    [TileSuit.WAN]: '萬',
    [TileSuit.TIAO]: '條',
    [TileSuit.TONG]: '筒',
};

/** 风牌汉字 (rank 1~4 对应 东南西北) */
export const FENG_CHARS: string[] = ['东', '南', '西', '北'];

/** 箭牌汉字 (rank 1~3 对应 中发白) */
export const JIAN_CHARS: string[] = ['中', '发', '白'];

/** 起始手牌张数 */
export const HAND_SIZE = 13;

/** 数牌最大点数 */
export const MAX_RANK = 9;

/** 中文数字(用于万子牌面,仿真实麻将牌) */
export const CN_NUMERALS: string[] = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 花色排序权重(用于理牌) */
export const SUIT_SORT_WEIGHT: Record<number, number> = {
    [TileSuit.WAN]: 0,
    [TileSuit.TIAO]: 100,
    [TileSuit.TONG]: 200,
    [TileSuit.FENG]: 300,
    [TileSuit.JIAN]: 400,
};

/** 各花色背景色 (R, G, B) - 统一暖米黄象牙色,仿真实麻将牌 */
export const SUIT_BG_COLORS: Record<number, [number, number, number]> = {
    [TileSuit.WAN]:  [248, 238, 210],  // 暖象牙
    [TileSuit.TIAO]: [248, 238, 210],  // 暖象牙
    [TileSuit.TONG]: [248, 238, 210],  // 暖象牙
    [TileSuit.FENG]: [244, 232, 205],  // 略深象牙
    [TileSuit.JIAN]: [244, 232, 205],  // 略深象牙
};

/** 各花色文字色 (R, G, B) - 仿真实麻将牌配色 */
export const SUIT_TEXT_COLORS: Record<number, [number, number, number]> = {
    [TileSuit.WAN]:  [196, 36, 36],    // 万: 红
    [TileSuit.TIAO]: [36, 132, 56],    // 条: 绿
    [TileSuit.TONG]: [36, 76, 176],    // 筒: 蓝
    [TileSuit.FENG]: [40, 40, 40],     // 风: 黑
    [TileSuit.JIAN]: [40, 40, 40],     // 箭: 默认黑(中/发单独处理)
};

/** 箭牌按点数的文字色 (中=红, 发=绿, 白=灰) */
export const JIAN_TEXT_COLORS: [number, number, number][] = [
    [196, 36, 36],    // 中: 红
    [36, 132, 56],    // 发: 绿
    [130, 130, 130],  // 白: 灰
];
