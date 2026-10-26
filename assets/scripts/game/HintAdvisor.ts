import { AIContext, AIBrain, DiscardEval, MeldEval } from './AIBrain';
import { MeldCandidate } from '../core/MeldDetector';
import { Tile } from '../core/Tile';
import { Shanten } from '../core/Shanten';
import { SUIT_CHARS, TileSuit } from '../core/TileDefine';

/**
 * AI 提示(玩家求助) —— 纯逻辑, 不依赖引擎
 *
 * 【核心约定】提示**不是**另写一套启发式, 而是直接读 `AIBrain.rankDiscards/rankMelds`
 * 的评估结果(AIBrain 与提示共用同一次评分)。否则会出现"提示说打这张、AI 却打那张"，
 * 玩家按提示打反而吃亏 —— 那是比没有提示更糟的体验。
 *
 * 因此本文件只负责三件事:
 *  1. 把评估明细翻译成玩家看得懂的中文(为什么打它 / 为什么不该副露)
 *  2. 标出**次优**选项(玩家常问"那第二选择呢"), 让提示能横向比较
 *  3. 严格用公开信息组上下文(由 GameManager 负责, 见其 `_buildAdviceContext`)
 */

/** 提示的种类 */
export type HintKind =
    /** 该打哪张牌 */
    | 'discard'
    /** 该不该吃/碰/杠 */
    | 'meld'
    /** 该不该胡 */
    | 'ron';

/** 一个提示选项(首选与次选共用) */
export interface HintOption {
    /** 手牌下标;副露时是"过" = -1 */
    index: number;
    /** 主文案, 如 "打出 三萬" */
    label: string;
    /** 理由, 如 "听牌 · 8 张进张" */
    reason: string;
    /** 是否为推荐项(次选项为 false) */
    primary: boolean;
    /** 危险度 0~100(副露项为 0) */
    danger: number;
}

/** 一次完整提示 */
export interface Hint {
    kind: HintKind;
    /** 首选;没有可用提示时为 null */
    best: HintOption | null;
    /** 次优(最多 HINT_ALT_COUNT 个), 已按优劣排序 */
    alts: HintOption[];
    /** 顶部队落色: good=绿 / warn=琥珀 / bad=红(危险牌) / info=中性 */
    tone: HintTone;
}

/** 提示语气(决定 UI 配色) */
export type HintTone = 'good' | 'info' | 'warn' | 'bad';

/** 次选项最多给几个(太多玩家反而选择困难) */
const HINT_ALT_COUNT = 2;

/** 危险度分档: >= 该值算"危险牌", 提示要显式提醒 */
const DANGER_WARN = 45;
const DANGER_BAD = 65;

/**
 * 危险度 → 档位(0=不标 / 1=留意 / 2=危险)
 *
 * 【为什么单独导出】手牌上的危险角标(`TileView.setDanger`)与提示文案的措辞
 * 必须同一条线: 角标亮红、提示却写"偏危险"会让人怀疑哪个是真的。
 * 阈值只此一处, 两个 UI 都调它。
 */
export function dangerLevel(danger: number): 0 | 1 | 2 {
    if (danger >= DANGER_BAD) return 2;
    if (danger >= DANGER_WARN) return 1;
    return 0;
}

export class HintAdvisor {
    /**
     * 出牌提示: 该打哪张
     *
     * @param ctx 玩家视角的上下文(只能用公开信息 + 自己手牌)
     * @returns 首选 + 次优;手牌为空时 best 为 null
     */
    static discard(ctx: AIContext): Hint {
        const ranked = AIBrain.rankDiscards(ctx);
        if (ranked.length === 0) return { kind: 'discard', best: null, alts: [], tone: 'info' };

        const best = ranked[0];
        const options: HintOption[] = ranked.slice(0, HINT_ALT_COUNT + 1).map((e, i) => ({
            index: e.index,
            label: `打出 ${e.tile.displayText}`,
            reason: HintAdvisor._discardReason(e),
            primary: i === 0,
            danger: e.danger,
        }));
        // 手上有两张一样的牌时, 次选很可能与首选重复同一张牌面, 没有参考价值 → 去掉
        const alts = options.slice(1)
            .filter(o => o.label !== options[0].label)
            .slice(0, HINT_ALT_COUNT);

        return {
            kind: 'discard',
            best: options[0],
            alts,
            tone: HintAdvisor._tone(best.danger),
        };
    }

    /**
     * 副露提示: 该不该吃/碰/杠(以及杠后补摸的"续杠")
     *
     * @param candidates 检测器给出的全部候选(顺序即 UI 按钮顺序)
     * @param sourceTile 触发副露的那张牌
     */
    static meld(ctx: AIContext, candidates: MeldCandidate[], sourceTile: Tile): Hint {
        const ranked = AIBrain.rankMelds(ctx, candidates, sourceTile);
        if (ranked.length === 0) return { kind: 'meld', best: null, alts: [], tone: 'info' };

        // AI 的选择: 最高分且为正 → 副露, 否则"过"。与 AIBrain.chooseMeld 同一判据。
        const chosen = ranked.find(e => e.score > 0) ?? null;
        const passOption: HintOption = {
            index: -1,
            label: '过(继续摸牌)',
            reason: HintAdvisor._passReason(ranked, chosen !== null),
            primary: chosen === null,
            danger: 0,
        };
        const options: HintOption[] = ranked.map(e => ({
            index: e.index,
            label: HintAdvisor._meldLabel(e, sourceTile),
            reason: HintAdvisor._meldReason(e),
            primary: chosen !== null && e.index === chosen.index,
            danger: 0,
        }));

        const best = chosen === null
            ? passOption
            : options.filter(o => o.index === chosen.index)[0];
        // 次优 = 除首选外的其余选项里最靠前的(通常是"次优的副露"或"过")
        const alts = options.filter(o => !o.primary).slice(0, HINT_ALT_COUNT);

        return {
            kind: 'meld',
            best,
            alts,
            tone: chosen === null ? 'info' : 'good',
        };
    }

    /**
     * 吃胡提示: 能胡就胡
     *
     * 与副露分开是因为语义不同: 副露是"取舍"(要不要亮牌), 胡牌在本项目里
     * 没有"放过"的价值判断(分数只增不减), 所以提示只需把结果说清楚。
     */
    static ron(tile: Tile): Hint {
        return {
            kind: 'ron',
            best: {
                index: -1,
                label: `胡 ${tile.displayText}`,
                reason: '已经听这张, 直接胡牌拿分',
                primary: true,
                danger: 0,
            },
            alts: [{
                index: -1,
                label: '过(不要这张)',
                reason: '放过只能保门清, 但本局分已经算不到了',
                primary: false,
                danger: 0,
            }],
            tone: 'good',
        };
    }

    // ==================== 听牌详情文案(信息栏常驻) ====================

    /**
     * 听牌详情一行文案: "3/6萬 1/4條 · 余 5 张"(不含"听"字前缀, 由调用方拼)
     *
     * 【为什么用"实际剩余张数"而不是有效进张种类数】见硬约束 13d:
     * 玩家问"还有几张能等"时想听的永远是张数。单钓只剩 2 张时种类数是 1,
     * 说"1 张进张"会让玩家按错误的数判断 —— 这里与 `DiscardEval.ukeireTiles`
     * 是同一个口径, 由 GameManager 统一算好传进来。
     *
     * @param waiting 听牌张(HuChecker 口径, 每型一张)
     * @param remain 剩余可胡张数 = Σ(4 − 可见张数)
     */
    static tenpaiText(waiting: Tile[], remain: number): string {
        return `${HintAdvisor.waitingText(waiting)} · 余 ${remain} 张`;
    }

    /**
     * 听牌张的紧凑文字: "3/6萬 1/4條 东/中"
     *
     * 数牌按花色分组(万→条→筒, 与理牌顺序一致), 组内点数用阿拉伯数字 + 斜杠 ——
     * 常驻信息栏很窄(手牌右侧那条), 全用汉字("三萬六萬")会占两倍宽度;
     * 字牌没有点数可合并, 逐张列。
     */
    static waitingText(waiting: Tile[]): string {
        const groups: string[] = [];
        for (const suit of [TileSuit.WAN, TileSuit.TIAO, TileSuit.TONG]) {
            const ranks: number[] = [];
            for (const t of waiting) if (t.suit === suit) ranks.push(t.rank);
            if (ranks.length === 0) continue;
            ranks.sort((a, b) => a - b);
            groups.push(`${ranks.join('/')}${SUIT_CHARS[suit]}`);
        }
        const honors: string[] = [];
        for (const t of waiting) if (!t.isNumberTile) honors.push(t.displayText);
        if (honors.length > 0) groups.push(honors.join('/'));
        return groups.join(' ');
    }

    // ==================== 文案组织 ====================

    /** 出牌理由: 先说牌效(向听/进张), 再说打点方向, 最后说防守 */
    private static _discardReason(e: DiscardEval): string {
        const parts: string[] = [];
        // 进张一律讲**实际剩余张数**: 玩家问"还有几张能摸"时想听的就是这个数。
        // (评分内部的和牌率另按张数算, 见 AIBrain._winRate。)
        const n = e.ukeireTiles;
        if (e.shanten === Shanten.WIN) {
            parts.push('打这张就能胡');
        } else if (e.shanten === Shanten.TENPAI) {
            parts.push(n > 0 ? `听牌 · ${n} 张进张` : '听牌');
        } else {
            parts.push(`${e.shanten} 向听 · ${n} 张进张`);
        }
        // 打点方向: 只报"已经在做"的牌型; 门清/立直这类状态玩家自己看得见, 不占位置
        if (e.valueTag) parts.push(e.valueTag);
        if (e.danger >= DANGER_BAD) parts.push('危险牌, 有人可能点炮');
        else if (e.danger >= DANGER_WARN) parts.push('偏危险, 留意别家听牌');
        else if (e.danger <= 5) parts.push('安全牌');
        return parts.join(' · ');
    }

    /** 副露按钮文案, 与 GameManager 弹出的按钮保持同一套措辞 */
    private static _meldLabel(e: MeldEval, sourceTile: Tile): string {
        const name = e.candidate.type === 'chi' ? '吃' : e.candidate.type === 'pon' ? '碰' : '杠';
        return `${name} ${sourceTile.displayText}`;
    }

    /** 副露理由: 说清"会让手牌变慢还是变快", 以及门清代价 */
    private static _meldReason(e: MeldEval): string {
        const parts: string[] = [];
        if (e.delta > 0) parts.push(`手牌慢 ${e.delta} 档`);
        else if (e.delta < 0) parts.push(`手牌快 ${-e.delta} 档`);
        else parts.push('不影响手牌速度');
        if (e.candidate.type === 'kan') parts.push('还能多摸一张');
        if (e.menzenCost > 0) parts.push('会失去门清 +1 番');
        return parts.join(' · ');
    }

    /** "过"的理由: 指出被放弃的那个候选差在哪 */
    private static _passReason(ranked: MeldEval[], isMelding: boolean): string {
        if (isMelding) return '留着比亮牌更划算';
        const top = ranked[0];
        if (!top) return '没有值得副露的选项';
        const name = top.candidate.type === 'chi' ? '吃' : top.candidate.type === 'pon' ? '碰' : '杠';
        if (top.delta > 0) return `${name}会让手牌慢 ${top.delta} 档`;
        if (top.menzenCost > 0) return '副露要牺牲门清 +1 番';
        return `${name}的收益不够, 先留着`;
    }

    /** 危险度 → 语气色 */
    private static _tone(danger: number): HintTone {
        if (danger >= DANGER_BAD) return 'bad';
        if (danger >= DANGER_WARN) return 'warn';
        if (danger <= 5) return 'good';
        return 'info';
    }
}
