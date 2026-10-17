/**
 * AI 拟人化: 名字 + 台词 —— 只影响表现, **不影响牌力**
 *
 * 【为什么要有它】三家对手以前只是"上家 / 左家 / 右家"三个方位词, 打十局也记不住
 * 谁是谁; 碰/杠/胡更是全程静默, 对局像在跟机器打。给他们名字与几句口头禅之后,
 * "上家老陈又碰我一张"这种**对人的记忆**才建立得起来。
 *
 * 【硬约束: 名字必须是 2 个汉字】牌桌上凡是显示座位名的地方(比分条四枚芯片、
 * "xx·听"标记、结算面板的名牌)都是按"上家/左家/右家"这两个字的宽度排的。
 * 换成两个字的人名宽度分毫不差; 一旦用三个字, 比分条四枚芯片就会超宽被整体
 * 缩放压小 —— `tools/ai-test/career-persona-test.ts` 对此有断言。
 *
 * 【不改什么】AI 的强度恒为满能力档(AGENTS.md 硬约束 11), 台词与名字都不参与
 * 任何决策计算 —— 这里只提供"说哪一句", 不提供"怎么打"。
 */

/** 台词类型 */
export type SpeechKind =
    /** 碰 */
    | 'pon'
    /** 杠(明杠 / 续杠都算) */
    | 'kan'
    /** 自摸 */
    | 'tsumo'
    /** 胡别人打出的牌(含抢杠) */
    | 'ron'
    /** 自己点炮(付分的那家) */
    | 'deal';

/** 台词类型的全集(测试遍历用) */
export const SPEECH_KINDS: SpeechKind[] = ['pon', 'kan', 'tsumo', 'ron', 'deal'];

/** 一家 AI 的设定 */
export interface AIPersona {
    /** 名字(2 个汉字) */
    name: string;
    /** 性格一句话: 写台词时的依据, 也方便日后加新台词时保持人设 */
    tag: string;
    /** 碰 */
    pon: string[];
    /** 杠 */
    kan: string[];
    /** 自摸 */
    tsumo: string[];
    /** 胡别人的牌 */
    ron: string[];
    /** 点了别人的炮 */
    deal: string[];
}

/**
 * 三家 AI 的设定(索引 = 座位 0/1/2/3; 座位 0 是玩家自己, 放 null)
 *
 * 三个人设刻意拉开: 一个话少、一个话多、一个直爽 —— 同一句"碰"三家说法不同,
 * 玩家不用看名字也分得清是谁在说话。
 */
export const AI_PERSONAS: (AIPersona | null)[] = [
    null,
    {
        name: '老陈',
        tag: '沉稳, 话不多, 赢了也不张扬',
        pon: ['碰。', '碰一个。', '这个我要了。'],
        kan: ['开杠。', '杠一个。'],
        tsumo: ['自摸。承让。', '自摸, 运气不错。'],
        ron: ['胡了, 承让。', '胡。不好意思。'],
        deal: ['…大意了。', '这把是我的错。'],
    },
    {
        name: '小雨',
        tag: '活泼, 表情全写在话里',
        pon: ['碰! 这个我要～', '碰碰碰!', '我要我要!'],
        kan: ['杠! 发财啦～', '开杠～'],
        tsumo: ['自摸啦～', '哇, 自摸!'],
        ron: ['胡啦! 谢谢款待～', '嘿嘿, 胡了!'],
        deal: ['哎呀, 我的锅!', '啊啊啊我点炮了!'],
    },
    {
        name: '阿虎',
        tag: '直爽, 一句话说完',
        pon: ['碰!', '这个归我。'],
        kan: ['杠!', '开杠!'],
        tsumo: ['自摸! 爽快。', '自摸, 痛快!'],
        ron: ['胡了!', '拿下!'],
        deal: ['算你狠。', '这把栽了。'],
    },
];

/** 单句台词的长度上限(超过会撑破气泡/名牌, 加台词时记得数一数) */
export const SPEECH_MAX_LEN = 10;

/** 某家的名字;座位 0(玩家自己)与越界都返回空串 */
export function aiName(seat: number): string {
    const p = AI_PERSONAS[seat];
    return p ? p.name : '';
}

/**
 * 抽一句台词
 *
 * @param seat 座位(1-3)
 * @param kind 场合
 * @param rnd [0,1) 的随机数
 *
 * 【为什么把随机数当参数传进来】随机源留在调用方(GameManager 传 `Math.random()`),
 * 本文件就是纯函数 —— 测试可以给定 rnd 断言"抽到第几条", 不用去 mock 全局随机。
 */
export function speechLine(seat: number, kind: SpeechKind, rnd: number): string {
    const p = AI_PERSONAS[seat];
    if (!p) return '';
    const pool = p[kind];
    if (!pool || pool.length === 0) return '';
    let r = rnd;
    if (!isFinite(r)) r = 0;
    r = Math.min(0.999999, Math.max(0, r));
    return pool[Math.floor(r * pool.length)] ?? '';
}
