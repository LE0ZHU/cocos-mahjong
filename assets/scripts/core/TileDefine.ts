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

/**
 * 牌型总数(34 种): 万1-9 / 条1-9 / 筒1-9 / 风1-4 / 箭1-3
 *
 * "紧凑下标"是把 34 种牌型映射到 0~33 的连续整数, AI 推理(向听数、危险度)
 * 全靠它做定长数组索引, 比 "花色-点数" 字符串键快得多。
 */
export const TILE_TYPE_COUNT = 34;

/**
 * 牌型的紧凑下标
 * 万1-9=0-8, 条1-9=9-17, 筒1-9=18-26, 风1-4=27-30, 箭1-3=31-33
 */
export function tileIndexOf(suit: TileSuit, rank: number): number {
    switch (suit) {
        case TileSuit.WAN: return rank - 1;
        case TileSuit.TIAO: return 8 + rank;
        case TileSuit.TONG: return 17 + rank;
        case TileSuit.FENG: return 26 + rank;
        default: return 30 + rank;  // JIAN
    }
}

/**
 * 全部 34 种牌型(每种只给花色+点数, 不含具体是哪一张),
 * 听牌枚举 / 危险度打表 / 牌效统计都按它遍历。
 */
export const ALL_TILE_TYPES: { suit: TileSuit; rank: number }[] = (() => {
    const list: { suit: TileSuit; rank: number }[] = [];
    for (const suit of [TileSuit.WAN, TileSuit.TIAO, TileSuit.TONG]) {
        for (let r = 1; r <= MAX_RANK; r++) list.push({ suit, rank: r });
    }
    for (let r = 1; r <= 4; r++) list.push({ suit: TileSuit.FENG, rank: r });
    for (let r = 1; r <= 3; r++) list.push({ suit: TileSuit.JIAN, rank: r });
    return list;
})();

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

/** 各花色背景色 (R, G, B)
 *  统一为纯白: 牌面图片(resources/tiles 下的 jpg, 75×100=3:4)底色就是纯白,
 *  牌身与图片同色后, 图片四周那一圈牌身不再显出"米白边框", 整张牌看起来没有边框 */
export const SUIT_BG_COLORS: Record<number, [number, number, number]> = {
    [TileSuit.WAN]:  [255, 255, 255],
    [TileSuit.TIAO]: [255, 255, 255],
    [TileSuit.TONG]: [255, 255, 255],
    [TileSuit.FENG]: [255, 255, 255],
    [TileSuit.JIAN]: [255, 255, 255],
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
