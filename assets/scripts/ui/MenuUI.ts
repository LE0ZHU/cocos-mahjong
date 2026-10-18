import {
    _decorator, Component, Node, Color, Label, Graphics, UITransform, Vec3,
    view, UIOpacity, Sprite, SpriteFrame, resources, ScrollView, Mask, Tween, tween,
} from 'cc';
import {
    createLabelNode, createButtonNode, restyleButton, repaintButtons, applyDesignResolution,
    ButtonStyle, bindSafeClick, buttonLabel,
} from './UIFactory';
import { ensureOpacity } from './Anim';
import { fanColor } from './SettlementPanel';
import { FAN_DEFS, STREAK_FAN_MAX } from '../core/HuScore';
import { GAME_RULES } from '../game/GameRules';
import { careerText } from '../game/CareerStats';
import { CAREER } from '../game/CareerStore';
import { syncAudioSettings } from '../audio/Sound';

const { ccclass } = _decorator;

/** 主页面 / 设置页面的内容基准尺寸 */
const MENU_CONTENT_W = 1680;
const MENU_CONTENT_H = 1040;

// ==================== 配色方案 ====================
// 基于背景图的色调(暖棕木色 + 玉绿绒布 + 阳光金)重新搭配

/** 主按钮: 琥珀金(比之前的暖金更亮,在明亮背景上突出) */
const BTN_PRIMARY = new Color(230, 182, 68, 255);
const TEXT_INK = new Color(28, 21, 12, 255);

/** 次按钮描边色: 近白偏暖 */
const LINE_GHOST = new Color(240, 238, 228, 255);

/** 标题/正文文字色: 近白,在暗遮罩上读得清 */
const TEXT_TITLE = new Color(250, 246, 236, 255);
const TEXT_SUB = new Color(224, 218, 200, 255);
const TEXT_MUTED = new Color(180, 176, 164, 255);

const MENU_BTN_STYLE = ButtonStyle.Pill;
const MENU_GHOST_STYLE = ButtonStyle.PillGhost;

/** 给标题类文字加粗 + 可选字距 */
function emphasizeLabel(node: Node, spacingX = 0): void {
    const l = node.getComponent(Label);
    if (!l) return;
    l.isBold = true;
    l.spacingX = spacingX;
}

/** 通用"允许/禁止"选项 */
const ON_OFF: ChoiceOption[] = [
    { label: '允许', value: 1 },
    { label: '禁止', value: 0 },
];
/** 通用"开/关"选项(音频设置用, 措辞与玩法规则区分开) */
export const ON_OFF_AUDIO: ChoiceOption[] = [
    { label: '开', value: 1 },
    { label: '关', value: 0 },
];
/**
 * 音量档位
 *
 * 用固定档位而不是 0~100 连续值: 设置页的选项是按钮,
 * 连续值要么加滑杆(与现有版式不符), 要么用步进按钮(点一下只动一格, 很别扭)。
 * 4 档对玩家足够用, 且档位间距听感上差别明显。
 *
 * 导出给对局内的设置弹窗(SettingsPanel)复用 —— 音量档位只能有一套定义,
 * 两处各写一份必然出现"菜单里是 4 档、牌桌上是 5 档"这类漂移。
 */
export const VOLUME_LEVELS: ChoiceOption[] = [
    { label: '静音', value: 0 },
    { label: '小', value: 0.35 },
    { label: '中', value: 0.7 },
    { label: '大', value: 1 },
];

/**
 * 把 0~1 的音量落到最接近的档位值(用于高亮当前档位)
 *
 * 存档里的音量可能是任意值(旧版本或手改的 localStorage),
 * 而选项按钮只有 4 个 —— 必须吸附到最近档才能正确点亮。
 */
export function nearestVolumeLevel(v: number): number {
    let best = VOLUME_LEVELS[0].value;
    let bestDiff = Math.abs(v - best);
    for (const o of VOLUME_LEVELS) {
        const d = Math.abs(v - o.value);
        if (d < bestDiff) { bestDiff = d; best = o.value; }
    }
    return best;
}

const OPACITY_ON = 255;
const OPACITY_OFF = 165;

// ==================== 内容页(设置规则 / 玩法说明)共用版式 ====================
//
// 2026-10-16 晚: 用户反馈"文字和背景密密麻麻" → 两页一起改:
//  1) **字号整体加大**(标题 30→36, 说明 20→26, 说明页正文 22→28), 代价是内容比视口高
//     → 真正启用滚动(ScrollView + 右侧滚动指示条), 不再硬塞一屏;
//  2) **整页阅读底板**(PAGE_DIM_COLOR): 背景是麻将桌照片, 文字直接压上去读不清,
//     压暗后只留一点氛围。
//
// 【历史教训仍有效】居中深色面板不要加回来(浪费纵向空间, 硬化约束 12);
// 这里加的是**整页**底板, 不是原来那种"上下两条黑色渐变"。
//
// 【坐标系】滚动内容用**内容原点 = 内容顶边中心**(锚点 0.5/1), 页面里的 y 从 0 往下排
// (负数), ScrollView 的边界正好也是按"视口顶/底"算的 —— 不再需要把原点挪到屏幕中心。
/** 滚动视口宽度(两页共用; 内容也这么宽, 于是左右对齐关系与页面 x 一致) */
const PAGE_VIEW_W = 1520;
/** 顶部按钮行下沿 → 视口顶的呼吸位 */
const PAGE_VIEW_TOP_GAP = 11;
/** 内容页的阅读底板: 深玉色, 压暗背景照片 */
const PAGE_DIM_COLOR = new Color(8, 18, 14, 175);
/** 滚动条: 轨道宽 / 距视口右缘 / 距视口上下缘 / 滑块最小高度(太短了看不见) */
const SCROLL_BAR_W = 8;
const SCROLL_BAR_RIGHT = 16;
const SCROLL_BAR_PAD = 12;
const SCROLL_BAR_MIN_H = 48;
const SCROLL_BAR_TRACK = new Color(255, 255, 255, 30);
const SCROLL_BAR_THUMB = new Color(214, 176, 96, 205);

// ==================== 页面切换过渡 ====================
//
// 主页面 / 设置规则 / 玩法说明之间原本是"瞬切"(active 一换画面直接跳),
// 有背景照片与整页阅读底板时, 跳变读起来像闪屏。这里给三页做统一的
// **旧页淡出 → 新页淡入**(默认状态就是最终状态: 动画只补间透明度,
// 不动任何布局, 中断在哪一帧都不会留下半透明残留 —— 见 _beginShow)。
/** 旧页淡出时长(秒) */
const PAGE_FADE_OUT = 0.12;
/** 新页淡入时长(秒): 略长于淡出, 收尾更柔 */
const PAGE_FADE_IN = 0.16;

// ---- 设置规则页(菜单内) ----
// PANEL_W 只用来定位文字列与按钮列(内容整体仍是 1680 宽, 居中)。
const PANEL_W = 1080;
const RULES_PAD = 44;
const RULES_TEXT_LEFT = -PANEL_W / 2 + RULES_PAD;
/**
 * 文字列宽
 *
 * 上限是"按钮列最宽的那一行"(4 档音量: 4×129+3×16 = 564)的左缘 —— 两列必须同宽,
 * 否则音量行会把标题说明压掉。字号加大后说明文案也要跟着收短(校验脚本逐行断言宽度)。
 */
const RULES_TEXT_W = 420;
const RULES_BTN_RIGHT = PANEL_W / 2 - RULES_PAD;
const RULES_BTN_W = 170;
const RULES_BTN_H = 68;
const RULES_BTN_GAP = 16;
/** 行内: 标题与说明在行心上下, 行块高 = 标题行 40 + 说明行 30 */
const H_CAP_LINE = 40;
const H_HINT_LINE = 30;
const RULES_CAPTION_DY = 14;
const RULES_HINT_DY = -30;
/**
 * 行间距(行心到行心): 行块(79) + 29 空隙。
 * 铁律仍然是"行内间距 < 行间间距" —— 加大行距解决不了行内太挤(真机截图教训)。
 */
const RULES_ROW_PITCH = 108;
/**
 * 首行行心(内容局部坐标, 0 = 内容顶边)
 *
 * 不能太靠近 0: 标题的字比行块中心高出约 18px, 顶出内容顶边就会被 Mask 裁掉
 * (校验脚本对"首行完整可见"有断言)。9 行选项 = 吃/续杠/吃胡/抢杠/一炮多响/听牌宣言 + 三个音频。
 */
const RULES_ROW_TOP = -40;
const RULES_ROW_COUNT = 9;
const RULES_TIPS_W = 1000;
/** 底部说明块: 4 行 × 字号 26(行高 38) */
const RULES_TIPS_LINES = 4;
const RULES_TIPS_LINE_H = 38;
const RULES_TIPS_H = RULES_TIPS_LINES * RULES_TIPS_LINE_H;
/**
 * 底部补充说明的正文(4 行)
 *
 * 行数与 RULES_TIPS_LINES / RULES_TIPS_H 绑定, 改行数必须同步改并重跑 rules-layout-test;
 * 每行都要放得下 RULES_TIPS_W(校验脚本逐行断言, 超了就该拆行而不是让 SHRINK 压小)。
 */
const RULES_TIPS_TEXT = '计分: 底分 1 分, 每 1 番翻一倍, 8 番封顶(256 分); 结算面板里逐条列出番型。\n'
    + 'AI 满能力档: 出牌与吃碰杠有 20 秒; 超时自动处理(打掉刚摸的牌, 副露默认过)。\n'
    + '音效与背景音乐改完立刻生效; 番型与计分口径见主菜单「玩法说明」。\n'
    + '所有设置都自动保存在本机, 退出游戏后重新打开仍是这一套规则。';
/** 末行 → 说明块 / 内容底部留白 */
const RULES_TIPS_GAP = 30;
const RULES_CONTENT_BOTTOM = 26;
/** 字号: 标题 / 说明(按钮文字字号在 _buildChoiceGroup 里, 与按钮高一起定) */
const RULES_CAPTION_FONT = 36;
const RULES_HINT_FONT = 26;
const RULES_TIPS_FONT = 26;
/**
 * 顶部一行(原"规则设置"标题所在行)的中心 y —— 这一行**不滚动**,
 * 只放左上角的返回/恢复默认两个按钮。
 */
const RULES_TOP_Y = 474;
/** 返回按钮: 左上角 */
const RULES_BACK_X = -PANEL_W / 2 + RULES_PAD + 100;
const RULES_BACK_Y = RULES_TOP_Y;
/** 顶部按钮行(返回 / 恢复默认)的高度 —— 与选项按钮高(RULES_BTN_H)不同, 别混用 */
const RULES_TOP_BTN_H = 62;

export interface ChoiceOption { label: string; value: number; }

/**
 * 文本宽度估算: CJK/全角按字号, 数字/空格/中点按半角
 *
 * 与 HintPanel / SettlementPanel / Main 的同名函数一致 —— 芯片与表格的文字框宽度
 * 必须按文案算, 给小了 `Label.Overflow.SHRINK` 会把字压扁(AGENTS.md 硬约束 4)。
 */
function textWidth(text: string, font: number): number {
    let w = 0;
    for (const ch of text) {
        w += ch.codePointAt(0)! >= 0x2e80 ? font : font * 0.5;
    }
    return w;
}

// ==================== 玩法说明页: 版式与内容 ====================
//
// 【为什么要有这一页】新玩家的第一个问题永远是"怎么玩、怎么算分", 而主菜单原先
// 只有「开始游戏 / 设置规则」—— 番型表、计分口径、操作方式全靠猜。
// 这一页把它们一次讲清; **字号按"读"的标准给足**(正文 28 / 表格 26/30),
// 代价是内容比视口高, 于是滚动 + 右侧指示条(与设置规则页同一套)。
//
// 版式: 顶部一行是"返回 + 标题"(不滚动); 正文在滚动内容里自上而下顺排,
// 游标 y 恒为**上一段的底边**(硬约束 3: 写成 y + H/2 会让下一段正好压在上一段上)。

/** 内容区宽度(居中): 番型表两列并排要横向空间 */
const HELP_CONTENT_W = PAGE_VIEW_W;
/** 内容原点(顶边) → 首段标题上沿 / 末段底边 → 内容下沿 */
const HELP_PAD_TOP = 6;
const HELP_PAD_BOTTOM = 26;
/** 章节标题高 / 标题下分隔线与正文的间距 / 正文行高 / 章节之间 */
const HELP_CAP_H = 38;
const HELP_CAP_GAP = 12;
const HELP_LINE_H = 40;
const HELP_SEC_GAP = 30;
/** 番型表: 行高 / 两列的列间距 / 名称列宽 */
const HELP_FAN_ROW_H = 52;
const HELP_FAN_COL_GAP = 64;
const HELP_FAN_NAME_W = 160;
const HELP_FAN_COL_W = (HELP_CONTENT_W - HELP_FAN_COL_GAP) / 2;
/** 字号: 章节标题 / 正文 / 番型名 / 番数与说明 */
const HELP_CAP_FONT = 34;
const HELP_LINE_FONT = 28;
const HELP_FAN_NAME_FONT = 30;
const HELP_FAN_FONT = 26;
/** 说明页顶部「麻将 / 抽牌」切换标签: 尺寸 / 间距 / 距内容右缘 */
const HELP_TAB_W = 150;
const HELP_TAB_H = 60;
const HELP_TAB_GAP = 14;
const HELP_TAB_EDGE = 30;

/** 说明页文字配色(正文沿用设置页的米白; 番型名更亮, 与番数色阶呼应) */
const HELP_TEXT_LINE = new Color(226, 222, 206, 255);
const HELP_FAN_NAME = new Color(250, 246, 236, 255);
const HELP_FAN_DESC = new Color(206, 202, 186, 255);
/** 章节标题下的分隔线(低透明度暖金, 只为分段, 不抢视线) */
const HELP_CAP_LINE = new Color(214, 176, 96, 96);

/**
 * 玩法说明页的内容(纯数据) —— **按玩法分成两组**
 *
 * 说明页顶部有「麻将 / 抽牌」两个标签, 切换后滚动内容整页重建:
 * 麻将玩家不必在抽牌的说明里翻找, 反之亦然(两种玩法是两套规则, 混排只会都看不清)。
 *
 * 【为什么文案与版式分开】改文案不必碰版式; 复核脚本 `tools/ai-test/help-layout-test.ts`
 * 直接从源码解析这份数组, 于是"断言里看到的文字"与真机显示的文字永远一致。
 * 格式约定(脚本按此解析, 改动请保持): 每段 `title: '...'`, 正文每行独占一行且
 * 形如 `'...',`; 番型表那一段写 `fanTable: true` —— 表内容由 FAN_DEFS 生成, 不写死。
 */
export interface HelpSection {
    /** 章节标题 */
    title: string;
    /** 正文行 */
    lines: string[];
    /** 该段额外渲染"番型表"(两列, 数据来自 core/HuScore 的 FAN_DEFS) */
    fanTable?: boolean;
}

export const HELP_SECTIONS_MAHJONG: HelpSection[] = [
    {
        title: '麻将 · 操作',
        lines: [
            '点手牌选中, 再点一次打出; 或按住手牌往上拖到牌河, 松手即出牌(点别处取消选中)',
            '左上角齿轮: 声音设置 / 重新开始 / 返回主页面 —— 随时可调, 不用退回主菜单',
            '「听牌」亮明听牌(胡了加 1 番) · 「提示」给出与 AI 同源的建议打法',
        ],
    },
    {
        title: '麻将 · 怎么算胡',
        lines: [
            '4 组面子(顺子或刻子) + 1 对将牌, 凑满 14 张即和牌; 吃/碰/杠亮出的副露各算 1 组面子',
            '自摸 = 自己摸到和牌张; 吃胡 = 胡别人打出的牌(可在「设置规则」里关掉); 一炮多响时多家同时胡',
        ],
    },
    {
        title: '麻将 · 番型与番数',
        lines: [
            '牌型番只取最高的那一种; 花色番与状态番可以叠加(例: 平胡 + 门清 + 自摸 = 2 番)',
        ],
        fanTable: true,
    },
    {
        title: '麻将 · 计分',
        lines: [
            '底分 1 分, 每 1 番翻一倍, 8 番封顶(= 256 分)',
            '自摸: 三家各付一份(你拿 3 份); 点炮: 放炮的人付; 一炮多响时他付给每个赢家',
            '流局(牌墙摸空)不得分、连庄不中断; 连庄番只加给连续胡牌的人, 累计分每局都会存档, 只有返回主页面才清零',
        ],
    },
    {
        title: '麻将 · 牌桌上的常驻信息',
        lines: [
            '手牌右侧: 听牌后常驻「听 3/6萬 · 余 4 张」("余"是外面还剩几张), 不用点提示',
            '左上角: 四家累计比分, 连打多局时不用等结算; 右上角的牌墙小图是剩余张数',
            '三家 AI 有名字(上家老陈 / 左家小雨 / 右家阿虎), 碰杠时会冒一句台词; 胡牌那句在结算面板里',
            '主菜单底部与结算面板底部: 生涯战绩(总局数 / 胡牌次数 / 最高番 / 最长连庄), 跨会话保留',
        ],
    },
];

export const HELP_SECTIONS_DRAW: HelpSection[] = [
    {
        title: '抽牌 · 玩法',
        lines: [
            '主菜单点「抽牌」进入: 136 张牌全部明牌摆成方阵(长边 8 张、宽 17 张)',
            '你与电脑轮流抽: 每次点两张相同的牌, 且两张都要能"抽出来" —— 上下左右某个方向到边界一路无牌挡着',
            '开局摆牌 / 每次抽牌都有动画; 左上角随时可以重新开始或返回主页面',
        ],
    },
    {
        title: '抽牌 · 计分与牌桌',
        lines: [
            '字牌一律算 10 点, 数牌按点数; 一组只算一张(如两张九萬这一组算 9 点)',
            '牌抽完(或双方都抽不动了)比总分, 高者胜; 两家分数在牌桌顶上一眼可见',
            '抽到的一组牌分列牌桌两侧: 电脑在左、你在右, 按点数从大到小排开, 一对只摆一张, 谁领先一目了然',
        ],
    },
];

/** 番型表里的一行(名称 + 番数文案 + 说明); 由 FAN_DEFS + 连庄那一行生成 */
interface FanRow {
    name: string;
    fanText: string;
    fan: number;
    desc: string;
}

/**
 * 一个可滚动内容页的节点组
 *
 * 结构: view(带 Mask 的视口) → content(锚点 0.5/1, 顶边贴视口顶) + bar(滚动指示条)
 * 页面里的 y 一律用**内容局部坐标**: 0 = 内容顶边, 往下为负。
 */
interface ScrollPage {
    /** 滚动视口(带 Mask; 滚动条挂在它下面, 所以不随内容滚动) */
    view: Node;
    /** 内容节点: 子节点从顶边往下排 */
    content: Node;
    /** ScrollView 组件(滚动位置由它反推, 不自己算) */
    sv: ScrollView;
    /** 滚动指示条(轨道 + 滑块, 一个 Graphics 画完) */
    bar: Graphics;
    /** 上次画过的滚动状态(相同就不重画, 免得每帧重绘) */
    barKey: string;
}

/**
 * 组装番型表的行: 13 个固定番型(来自 core/HuScore 的 FAN_DEFS) + 连庄
 *
 * **不要在这里写死番数** —— 说明页与判定必须是同一份数据(硬约束 13 的同一原则)。
 */
function buildFanRows(): FanRow[] {
    const rows: FanRow[] = FAN_DEFS.map(d => ({
        name: d.name,
        fanText: `${d.fan} 番`,
        fan: d.fan,
        desc: d.desc,
    }));
    // 连庄的番数取决于"连续第几次", 表里给上限
    rows.push({
        name: '连庄',
        fanText: `最多 +${STREAK_FAN_MAX} 番`,
        fan: STREAK_FAN_MAX,
        desc: '连续胡牌第 N 次 +（N−1）番',
    });
    return rows;
}

/** 竖向渐变绘制 */
function paintVerticalGradient(g: Graphics, top: Color, bottom: Color, halfHeight: number): void {
    const bands = 72;
    const bh = (halfHeight * 2) / bands;
    for (let i = 0; i < bands; i++) {
        const t = i / (bands - 1);
        g.fillColor = new Color(
            Math.round(top.r + (bottom.r - top.r) * t),
            Math.round(top.g + (bottom.g - top.g) * t),
            Math.round(top.b + (bottom.b - top.b) * t),
            Math.round(top.a + (bottom.a - top.a) * t),
        );
        g.rect(-3000, halfHeight - (i + 1) * bh, 6000, bh + 0.5);
        g.fill();
    }
}

/**
 * 主页面与规则设置页面
 *
 * 视觉: 真实麻将桌背景图 + 竖向渐变遮罩 + 底部居中按钮布局
 * 与对局共用同一个场景(Main 把菜单节点与牌桌节点互斥显示)
 */
@ccclass('MenuUI')
export class MenuUI extends Component {
    /** 点击"开始游戏"(经典对局) */
    onStart: (() => void) | null = null;
    /** 点击"抽牌模式"(136 张明牌阵, 双方轮流抽对子比点数) */
    onDrawMode: (() => void) | null = null;

    private _root: Node | null = null;
    private _homeNode: Node | null = null;
    private _rulesNode: Node | null = null;
    /** 玩法说明页(番型表 / 计分口径 / 操作说明) */
    private _helpNode: Node | null = null;
    /**
     * 当前显示的内容页(三页之一)
     *
     * 切换过渡需要知道"从哪一页淡出"; 也用它区分"首次显示"(不动画)与
     * "重复进入同一页"(只补画, 不重播动画)。**不在 UI 里反转成一个三态枚举**:
     * 判据就是节点引用本身, 不会与 active 状态漂移。
     */
    private _currentPage: Node | null = null;
    /**
     * 页面过渡序号: 每次切页 +1
     *
     * 快速连点(如淡出没完又点返回)时, 旧过渡排的回调会被这个序号作废 ——
     * 否则旧回调会把新过渡**正在淡入的那一页**又藏起来(黑屏一帧)。
     * 每个过渡开始时同时 kill 两个页面上的补间, 状态完全由最新那次接管。
     */
    private _transitSeq = 0;
    /** 说明页章节标题下的分隔线(挂在滚动内容里, 跟着一起滚) */
    private _helpSeps: Graphics | null = null;
    private _helpDividerYs: number[] = [];
    /** 说明页当前显示的玩法(顶部标签切换, 滚动内容整页重建) */
    private _helpMode: 'mahjong' | 'draw' = 'mahjong';
    private _helpTabMahjong: Node | null = null;
    private _helpTabDraw: Node | null = null;
    /** 两页的阅读底板(整页压暗; 原生平台"显示时补画") */
    private _pageDims: Graphics[] = [];
    /** 两页的滚动视口(用于重画滚动条) */
    private _scrollPages: ScrollPage[] = [];
    private _rulesScroll: ScrollPage | null = null;
    private _helpScroll: ScrollPage | null = null;
    /** 主页面底部的生涯战绩行(跨会话累积, 由 showHome 每次刷新) */
    private _careerLabel: Label | null = null;
    private _optionButtons: Map<string, Node[]> = new Map();
    private _optionValues: Map<string, number[]> = new Map();
    private _optionPickers: Map<string, (v: number) => void> = new Map();
    /** 背景图加载完成标志 */
    private _bgLoaded = false;

    onLoad(): void {
        this._root = new Node('MenuRoot');
        this._root.parent = this.node;

        this._buildBackdrop();
        this._buildHome();
        this._buildRulesPage();
        this._buildHelpPage();
        this.showHome();

        GAME_RULES.onChange(() => this._refreshRuleState());
        this._refreshRuleState();

        view.on('canvas-resize', this.adapt, this);
        this.adapt();
    }

    onDestroy(): void {
        view.off('canvas-resize', this.adapt, this);
        // 停掉三页上可能还在跑的过渡补间: 目标(UIOpacity)会跟着节点一起销毁,
        // 留着的补间再去写属性会进已销毁组件
        for (const page of [this._homeNode, this._rulesNode, this._helpNode]) {
            const op = page && page.isValid ? page.getComponent(UIOpacity) : null;
            if (op) Tween.stopAllByTarget(op);
        }
    }

    /** 显示主页面 */
    showHome(): void {
        if (this._root) this._root.active = true;
        this._beginShow(this._homeNode);
        this.redrawBackdrop();
        repaintButtons(this._homeNode);
        this._refreshCareer();
        this.adapt();
    }

    /**
     * 刷新主页面的生涯战绩行
     *
     * 每次显示主页面都重读一次存档: 对局里刚打完的那一局要在这里就看得到,
     * 而菜单是唯一能停下来看战绩的地方(牌桌上是比分, 不是战绩)。
     */
    private _refreshCareer(): void {
        if (this._careerLabel) this._careerLabel.string = careerText(CAREER.career);
    }

    /** 显示规则设置页 */
    showRules(): void {
        if (this._root) this._root.active = true;
        this._beginShow(this._rulesNode);
        this.redrawBackdrop();
        // 原生(JSB): 隐藏过再显示的节点上, onLoad 期间画的 Graphics 会丢 ——
        // 按钮底框 / 阅读底板 / 滚动条都要在显示时补一遍
        this._paintPageDims();
        if (this._rulesScroll) this._rulesScroll.barKey = '#';
        repaintButtons(this._rulesNode);
        this._refreshRuleState();
        this.adapt();
    }

    /** 显示玩法说明页(番型表 / 计分口径 / 操作说明) */
    showHelp(): void {
        if (this._root) this._root.active = true;
        this._beginShow(this._helpNode);
        this.redrawBackdrop();
        // 原生(JSB)平台: onLoad 期间画的 Graphics / 隐藏过再显示的按钮底框都会丢,
        // 显示时补画一次(分隔线 / 阅读底板 / 滚动条 / 按钮都是"画"出来的)
        this._paintPageDims();
        this._paintHelpDividers();
        if (this._helpScroll) this._helpScroll.barKey = '#';
        repaintButtons(this._helpNode);
        this.adapt();
    }

    /**
     * 切到某一页(带淡出/淡入过渡), 三页共用
     *
     * 【状态机】`_currentPage` 在**开始切换到那一刻**就更新为目标页 ——
     * 于是"过渡中"不需要额外标志位, 重复调用也只是"已在目标页"这一支。
     *
     * 【动画只碰 UIOpacity】位置/尺寸/层级全由各自的构建函数定稿, 过渡不参与:
     * 被打断、被跳过、在原生平台被隐藏, 都不会留下"半透明/半位移"的残留状态
     * (调用方在 _beginShow 之后继续做的补画/刷新, 也总是作用在最终可见的页面上)。
     *
     * 【首次显示】`_currentPage` 为空(启动时 onLoad → showHome)不再动画:
     * 第一帧就该是主页面, 从黑屏淡入没有必要。
     */
    private _beginShow(to: Node | null): void {
        if (!to) return;
        const from = this._currentPage;
        const opTo = ensureOpacity(to);

        // 三页互斥: 与本次过渡无关的页(异常残留)一律收起, 保持"只显示一页"
        for (const page of [this._homeNode, this._rulesNode, this._helpNode]) {
            if (page && page !== from && page !== to) page.active = false;
        }

        // 已在目标页: 只保证可见(重复进入/从对局返回走这一支, 不重播动画)
        if (from === to) {
            to.active = true;
            opTo.opacity = 255;
            return;
        }

        this._currentPage = to;
        // 打断上一段过渡: 两个页面上的旧补间全部停掉, 状态交给下面重新驱动
        // (旧补间里 "淡出结束后隐藏旧页" 的回调也随之作废 —— 它可能指向这一次的 to)
        if (from) Tween.stopAllByTarget(ensureOpacity(from));
        Tween.stopAllByTarget(opTo);
        const seq = ++this._transitSeq;

        to.active = true;
        if (!from) {
            opTo.opacity = 255;   // 首次显示: 直接就是最终状态
            return;
        }

        opTo.opacity = 0;
        const opFrom = ensureOpacity(from);
        tween(opFrom)
            .to(PAGE_FADE_OUT, { opacity: 0 })
            .call(() => {
                // 被更新的过渡接管时不再动手(那一页可能正被淡入)
                if (seq === this._transitSeq) from.active = false;
            })
            .start();
        tween(opTo)
            .delay(PAGE_FADE_OUT)
            .to(PAGE_FADE_IN, { opacity: 255 }, { easing: 'quadOut' })
            .start();
    }

    /** 隐藏整个菜单(进入对局) */
    hide(): void {
        if (this._root) this._root.active = false;
    }

    /** 按屏幕缩放菜单内容 */
    adapt(): void {
        if (!this._root) return;
        const design = applyDesignResolution();
        const scale = Math.min(design.width / MENU_CONTENT_W, design.height / MENU_CONTENT_H);
        this._root.setScale(scale, scale, 1);
    }

    /**
     * 重画遮罩层(Sprite 背景不需要重绘,Graphics 需要补画)
     */
    redrawBackdrop(): void {
        const halfH = Math.max(applyDesignResolution().height, MENU_CONTENT_H);
        // 遮罩层(整页渐变暗化, 主页与设置页共用)
        const mask = this._root?.getChildByName('MenuMask');
        const mg = mask?.getComponent(Graphics);
        if (mg) this._paintMask(mg, halfH);
        // 内容页的阅读底板与说明页分隔线也在这一路补画: Main 首帧后会调 redrawBackdrop,
        // 原生平台那时才画得上屏(见 _paintPageDims / _paintHelpDividers)
        this._paintPageDims();
        this._paintHelpDividers();
    }

    // ==================== 背景层(图片 + 遮罩) ====================

    /**
     * 创建整页背景:
     *  Layer 1: 玉绿渐变底色(Graphics 兜底,图片加载前/失败时显示)
     *  Layer 2: Sprite 加载真实麻将桌图片
     *  Layer 3: 竖向渐变遮罩(压暗背景让文字可读,顶部深底部浅)
     */
    private _buildBackdrop(): void {
        const design = applyDesignResolution();
        const halfH = Math.max(design.height, MENU_CONTENT_H);

        // 0. 兜底底色层: 玉绿渐变 + 近黑底部,与原来的菜单底色一致
        //    图片加载前用户看到的就是这个;图片加载成功后 Sprite 会盖住它
        const fallback = new Node('MenuFallback');
        fallback.parent = this._root;
        fallback.addComponent(UITransform).setContentSize(design.width, design.height);
        const fg = fallback.addComponent(Graphics);
        paintVerticalGradient(fg, new Color(24, 62, 48, 255), new Color(7, 12, 11, 255), halfH);

        // 1. 背景 Sprite 层(加载后盖住 fallback)
        const bg = new Node('MenuSprite');
        bg.parent = this._root;
        const bgTransform = bg.addComponent(UITransform);
        bgTransform.setContentSize(design.width, design.height);
        const sprite = bg.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.type = Sprite.Type.SIMPLE;

        // 异步加载背景图
        resources.load('menu_bg/spriteFrame', SpriteFrame, (err, sf) => {
            if (err || !sf) {
                console.warn('[MenuUI] 背景图加载失败:', err?.message);
                return;
            }
            sprite.spriteFrame = sf;
            this._bgLoaded = true;
        });

        // 2. 遮罩层: 竖向渐变暗化(上深下浅,alpha 插值已修复)
        const mask = new Node('MenuMask');
        mask.parent = this._root;
        mask.addComponent(UITransform).setContentSize(design.width, design.height);
        this._paintMask(mask.addComponent(Graphics), halfH);
    }

    /** 遮罩渐变绘制: 顶部深(压暗窗户强光),底部浅(让底部按钮区的背景图更清晰) */
    private _paintMask(g: Graphics, halfH: number): void {
        g.clear();
        // 顶部 alpha 150(足够压暗强光但不完全遮),底部 alpha 30(几乎透明)
        const top = new Color(0, 0, 0, 150);
        const bottom = new Color(0, 0, 0, 30);
        paintVerticalGradient(g, top, bottom, halfH);
    }

    // ==================== 主页面 ====================

    /**
     * 主页面布局:
     * 背景图中心是麻将桌桌面,底部是地板和桌腿。
     * 标题和按钮集中在画面下半部分(遮罩最亮的区域)
     *
     * 自上而下:
     *   大标题 "麻 将"        y = 200
     *   副标题                y = 90
     *   主模式 "麻将"          y = -60(实心胶囊)
     *   副模式 "抽牌"          y = -172(实心胶囊, 与主模式同款)
     *   次按钮 "设置规则 | 玩法说明"  y = -278(并排, 各 330 宽)
     *   规则摘要(两行)        y = -370
     *   操作提示              y = -420
     */
    private _buildHome(): void {
        const page = new Node('MenuHome');
        page.parent = this._root;
        this._homeNode = page;

        // 大标题 "麻将"
        const title = createLabelNode('麻 将', 128, TEXT_TITLE, 1400);
        title.parent = page;
        title.setPosition(0, 200, 0);
        emphasizeLabel(title, 20);

        const sub = createLabelNode('单机对战 · 麻将 / 抽牌', 30, TEXT_SUB, 1200);
        sub.parent = page;
        sub.setPosition(0, 90, 0);

        // 模式入口(上下两行): "麻将"(主模式, 三家 AI 经典对局) 在上,
        // "抽牌"(明牌阵抽对子) 在下。两个按钮**同款实心琥珀胶囊**(与原来的
        // "开始游戏"一模一样), 主/次只靠上下顺序区分 —— 不再用"实心/描边"两套样式。
        const modeW = 420;
        const modeH = 100;

        const startBtn = createButtonNode('麻将', modeW, modeH, BTN_PRIMARY, MENU_BTN_STYLE);
        startBtn.parent = page;
        startBtn.setPosition(0, -60, 0);
        bindSafeClick(startBtn, () => this.onStart?.(), this);
        const startLabel = buttonLabel(startBtn);
        if (startLabel) {
            startLabel.color = TEXT_INK;
            startLabel.isBold = true;
            startLabel.fontSize = 36;
        }

        // 抽牌: 136 张牌全部明牌成阵, 双方轮流抽"两张相同的牌"比总点数
        const drawBtn = createButtonNode('抽牌', modeW, modeH, BTN_PRIMARY, MENU_BTN_STYLE);
        drawBtn.parent = page;
        drawBtn.setPosition(0, -172, 0);
        bindSafeClick(drawBtn, () => this.onDrawMode?.(), this);
        const drawLabel = buttonLabel(drawBtn);
        if (drawLabel) {
            drawLabel.color = TEXT_INK;
            drawLabel.isBold = true;
            drawLabel.fontSize = 36;
        }

        // 次按钮行: 两个描边胶囊并排 —— 「设置规则」与「玩法说明」同属"开局前的准备",
        // 各占一半宽度、共用一行(新玩家第一眼就能看到说明入口)。
        const secBtnW = 330;
        const secBtnGap = 30;
        const secBtnX = (secBtnW + secBtnGap) / 2;

        const rulesBtn = createButtonNode('设置规则', secBtnW, 82, LINE_GHOST, MENU_GHOST_STYLE);
        rulesBtn.parent = page;
        rulesBtn.setPosition(-secBtnX, -278, 0);
        bindSafeClick(rulesBtn, () => this.showRules(), this);

        // 玩法说明: 番型表 / 计分口径 / 操作说明(新玩家上手全靠它)
        const helpBtn = createButtonNode('玩法说明', secBtnW, 82, LINE_GHOST, MENU_GHOST_STYLE);
        helpBtn.parent = page;
        helpBtn.setPosition(secBtnX, -278, 0);
        bindSafeClick(helpBtn, () => this.showHelp(), this);

        // 模式简介: 原来这里是"当前规则摘要"(吃/续杠/吃胡…), 那是**麻将专属**的开关清单,
        // 现在主菜单有两个模式, 把整行换成"两种玩法各是什么"更好选 —— 规则开关的详情
        // 已经在「设置规则」页里逐项列出, 不必在这里再抄一遍。
        // 文本域高度必须显式给够 —— 两行塞进单行高度里会被 SHRINK 压小一圈(硬约束 4)
        const summary = createLabelNode('', 24, TEXT_SUB, 1400, 24 * 3);
        summary.parent = page;
        summary.setPosition(0, -370, 0);
        const sumLabel = summary.getComponent(Label);
        if (sumLabel) {
            sumLabel.string = '麻将 · 三家 AI 对局 · 吃碰杠 + 番型计分\n'
                + '抽牌 · 136 张明牌阵 · 双方轮流抽对子比点数';
        }

        // 操作提示只留一句"去哪儿看规则" —— 原来那句"按住手牌往上拖"是**麻将专属**手势,
        // 现在主菜单上还有抽牌, 再挂着它就成了"对抽牌模式的错误说明"。
        const tip = createLabelNode('麻将的规则与操作见「玩法说明」', 22, TEXT_MUTED, 1400);
        tip.parent = page;
        tip.setPosition(0, -420, 0);

        // 生涯战绩: 跨会话累积(总局数 / 胡牌次数 / 最高番 / 最长连庄), 存在本地。
        // 放在操作提示下面那一行: 它是"回头看"的信息, 不该挤占按钮那一带。
        const career = createLabelNode('', 24, TEXT_MUTED, 1400);
        career.parent = page;
        career.setPosition(0, -470, 0);
        this._careerLabel = career.getComponent(Label);
    }

    // ==================== 规则设置页 ====================

    private _buildRulesPage(): void {
        const page = new Node('MenuRules');
        page.parent = this._root;
        this._rulesNode = page;

        // 【2026-10-16 晚改版】用户反馈文字与背景密密麻麻 → 字号整体加大,
        // 内容因此比视口高, 于是真正启用滚动(右侧有指示条), 并加一层整页阅读底板。
        // 中心深色面板仍然没有(那会浪费纵向空间, 见硬约束 12), 页面结构是:
        //   阅读底板 → 顶部按钮行(不滚动) → 滚动视口(9 行选项 + 底部说明)
        this._addPageDim(page);

        // 返回按钮: 左上角顶部一行
        const backBtn = createButtonNode('返回', 200, RULES_TOP_BTN_H, LINE_GHOST, MENU_GHOST_STYLE);
        backBtn.parent = page;
        backBtn.setPosition(RULES_BACK_X, RULES_BACK_Y, 0);
        bindSafeClick(backBtn, () => this.showHome(), this);

        // 恢复默认也放左上角, 排在返回右侧(底部要留给滚动内容)
        const resetBtn = createButtonNode('恢复默认', 220, RULES_TOP_BTN_H, LINE_GHOST, MENU_GHOST_STYLE);
        resetBtn.parent = page;
        resetBtn.setPosition(RULES_BACK_X + 320, RULES_BACK_Y, 0);
        bindSafeClick(resetBtn, () => GAME_RULES.reset(), this);

        const sp = this._createScrollPage('RulesScrollView', page);
        this._rulesScroll = sp;
        const host = sp.content;
        /** 第 i 行的行心(内容局部坐标: 0 = 内容顶边) */
        const rowY = (i: number): number => RULES_ROW_TOP - i * RULES_ROW_PITCH;

        // 选项组 1-4
        this._buildChoiceGroup(host, {
            key: 'allowChi',
            caption: '吃牌',
            hint: '仅吃上家的出牌',
            options: ON_OFF,
            y: rowY(0),
            selected: () => (GAME_RULES.rules.allowChi ? 1 : 0),
            onPick: (v) => GAME_RULES.setAllowChi(v === 1),
        });

        this._buildChoiceGroup(host, {
            key: 'allowAddKan',
            caption: '续杠',
            hint: '碰过之后再摸到可补成杠',
            options: ON_OFF,
            y: rowY(1),
            selected: () => (GAME_RULES.rules.allowAddKan ? 1 : 0),
            onPick: (v) => GAME_RULES.setAllowAddKan(v === 1),
        });

        this._buildChoiceGroup(host, {
            key: 'allowChiHu',
            caption: '吃胡',
            hint: '可以胡别人打出的牌',
            options: ON_OFF,
            y: rowY(2),
            selected: () => (GAME_RULES.rules.allowChiHu ? 1 : 0),
            onPick: (v) => GAME_RULES.setAllowChiHu(v === 1),
        });

        this._buildChoiceGroup(host, {
            key: 'allowRobKan',
            caption: '抢杠胡',
            hint: '别人补杠时可抢那张牌胡',
            options: ON_OFF,
            y: rowY(3),
            selected: () => (GAME_RULES.rules.allowRobKan ? 1 : 0),
            onPick: (v) => GAME_RULES.setAllowRobKan(v === 1),
        });

        this._buildChoiceGroup(host, {
            key: 'allowMultiRon',
            caption: '一炮多响',
            hint: '多家同时听同一张牌时可一起胡',
            options: ON_OFF,
            y: rowY(4),
            selected: () => (GAME_RULES.rules.allowMultiRon ? 1 : 0),
            onPick: (v) => GAME_RULES.setAllowMultiRon(v === 1),
        });

        this._buildChoiceGroup(host, {
            key: 'allowRiichi',
            caption: '听牌宣言',
            hint: '亮明听牌 +1 番, 之后不可吃碰杠',
            options: ON_OFF,
            y: rowY(5),
            selected: () => (GAME_RULES.rules.allowRiichi ? 1 : 0),
            onPick: (v) => GAME_RULES.setAllowRiichi(v === 1),
        });

        // 原本这里有"AI 思考速度"三档(快/常规/慢), 现已移除:
        // 速度档同时决定 AI 强度, 让玩家用"速度"去换"难度"并不合理,
        // 因此直接固定为最大能力档(expert), 只保留一个固定的出牌节奏延时。
        // 节奏本身仍可感知: AI 回合之间有 ~0.9s 停顿, 不会瞬间打完。

        // ---- 音频设置 ----
        // 每次改动都立刻调 syncAudioSettings(): AudioSource.volume 在 play() 时就固定了,
        // 只改 GAME_RULES 不会让"正在播的 BGM"变化, 必须显式同步。
        this._buildChoiceGroup(host, {
            key: 'sfxVolume',
            caption: '音效音量',
            hint: '按钮点击与出牌声',
            options: VOLUME_LEVELS,
            y: rowY(6),
            selected: () => nearestVolumeLevel(GAME_RULES.rules.sfxVolume),
            onPick: (v) => {
                GAME_RULES.setSfxVolume(v);
                syncAudioSettings();
            },
        });

        this._buildChoiceGroup(host, {
            key: 'bgmEnabled',
            caption: '背景音乐',
            hint: '关闭后完全静音',
            options: ON_OFF_AUDIO,
            y: rowY(7),
            selected: () => (GAME_RULES.rules.bgmEnabled ? 1 : 0),
            onPick: (v) => {
                GAME_RULES.setBgmEnabled(v === 1);
                syncAudioSettings();
            },
        });

        this._buildChoiceGroup(host, {
            key: 'bgmVolume',
            caption: '音乐音量',
            hint: '背景音乐的响度',
            options: VOLUME_LEVELS,
            y: rowY(8),
            selected: () => nearestVolumeLevel(GAME_RULES.rules.bgmVolume),
            onPick: (v) => {
                GAME_RULES.setBgmVolume(v);
                syncAudioSettings();
            },
        });

        // 底部补充说明(3 行): 每行的小字讲"这一项是什么", 这里讲"跨项的通用规则"
        const lastRowBottom = rowY(RULES_ROW_COUNT - 1) + RULES_HINT_DY - H_HINT_LINE / 2;
        const tipsTop = lastRowBottom - RULES_TIPS_GAP;
        const tips = createLabelNode(
            RULES_TIPS_TEXT,
            RULES_TIPS_FONT, new Color(216, 206, 182, 255), RULES_TIPS_W, RULES_TIPS_H, true,
        );
        tips.parent = host;
        tips.setPosition(RULES_TEXT_LEFT + RULES_TIPS_W / 2, tipsTop - RULES_TIPS_H / 2, 0);

        // 内容高度 = 末段底边 + 底部留白; 由 ScrollView 负责滚动(比视口高才可拖)
        this._commitScrollContent(sp, -(tipsTop - RULES_TIPS_H) + RULES_CONTENT_BOTTOM);
    }

    // ==================== 玩法说明页 ====================

    /**
     * 玩法说明页: 操作 / 怎么算胡 / 番型表 / 计分 / 常驻信息 —— 按玩法分两组
     *
     * 【2026-10-16 晚改版】用户反馈"文字和背景密密麻麻" → 字号按"读"的标准给足
     * (正文 28 / 番型表 26~30), 内容因此比视口高, 于是真正启用滚动 + 右侧指示条,
     * 并加一层整页阅读底板(与设置规则页同一套)。结构:
     *   阅读底板 → 顶部一行(返回 + 标题 + 玩法标签, 不滚动) → 滚动视口(正文 + 番型表)
     *
     * 【2026-10-18 改版】麻将与抽牌是两套规则, 混在一页里谁都要翻找 —— 顶部加
     * 「麻将 / 抽牌」两个标签(选中实心、未选描边), 切换时滚动内容整页重建。
     * 本方法只建**骨架**(不随玩法变的部分); 正文/番型表由 `_fillHelpContent()`
     * 按当前玩法填进滚动内容。
     */
    private _buildHelpPage(): void {
        const page = new Node('MenuHelp');
        page.parent = this._root;
        this._helpNode = page;

        this._addPageDim(page);

        // 顶部一行: 左上角返回(与设置页同一位置) + 居中标题 + 右侧玩法标签。
        // 设置页刻意没有标题(它是一堆开关), 而这一页是"要读的一篇内容", 标题用来定位。
        const backBtn = createButtonNode('返回', 200, RULES_TOP_BTN_H, LINE_GHOST, MENU_GHOST_STYLE);
        backBtn.parent = page;
        backBtn.setPosition(RULES_BACK_X, RULES_BACK_Y, 0);
        bindSafeClick(backBtn, () => this.showHome(), this);

        const title = createLabelNode('玩法说明', 42, TEXT_TITLE, 600);
        title.parent = page;
        title.setPosition(0, RULES_TOP_Y, 0);
        emphasizeLabel(title, 6);

        // 玩法标签: 选中实心琥珀胶囊、未选描边胶囊(与主菜单模式按钮同一套语言)。
        // ⚠️ 创建时两个都用占位样式, 紧接着必须按当前模式落定选中态 ——
        // 之前两个都给 BTN_PRIMARY, 首次进入"麻将/抽牌"同时高亮(选中态没人画)。
        const tabY = RULES_TOP_Y;
        const tab1X = MENU_CONTENT_W / 2 - HELP_TAB_EDGE - HELP_TAB_W / 2;
        const tab2X = tab1X - HELP_TAB_W - HELP_TAB_GAP;
        this._helpTabDraw = createButtonNode('抽牌', HELP_TAB_W, HELP_TAB_H, LINE_GHOST, MENU_GHOST_STYLE);
        this._helpTabDraw.parent = page;
        this._helpTabDraw.setPosition(tab1X, tabY, 0);
        bindSafeClick(this._helpTabDraw, () => this._setHelpMode('draw'), this);
        this._helpTabMahjong = createButtonNode('麻将', HELP_TAB_W, HELP_TAB_H, LINE_GHOST, MENU_GHOST_STYLE);
        this._helpTabMahjong.parent = page;
        this._helpTabMahjong.setPosition(tab2X, tabY, 0);
        bindSafeClick(this._helpTabMahjong, () => this._setHelpMode('mahjong'), this);
        this._styleHelpTabs();

        const sp = this._createScrollPage('HelpScrollView', page);
        this._helpScroll = sp;

        this._fillHelpContent();
    }

    /** 按当前玩法落定两个标签的选中态(首次构建与切换共用, 幂等) */
    private _styleHelpTabs(): void {
        const on = (btn: Node | null, selected: boolean): void => {
            if (!btn) return;
            restyleButton(btn, selected ? BTN_PRIMARY : LINE_GHOST,
                selected ? MENU_BTN_STYLE : MENU_GHOST_STYLE);
            const l = buttonLabel(btn);
            if (l) l.color = selected ? TEXT_INK : TEXT_TITLE;
        };
        on(this._helpTabMahjong, this._helpMode === 'mahjong');
        on(this._helpTabDraw, this._helpMode === 'draw');
    }

    /**
     * 按当前玩法(`_helpMode`)重建滚动内容: 清掉旧内容 → 顺排正文/番型表 →
     * 落定内容高度 → 补画分隔线。切换标签与首次构建都走这里(幂等)。
     */
    private _fillHelpContent(): void {
        const sp = this._helpScroll;
        if (!sp) return;
        const host = sp.content;
        for (const child of host.children.slice()) child.destroy();

        // 章节标题下的分隔线: 一个 Graphics 承担全部段落, 位置跟着游标走;
        // 挂在滚动内容里(跟着一起滚)。原生平台 onLoad 期间画的图形不上屏 →
        // 显示时由 _paintHelpDividers 补画(与 repaintButtons 同一套理由)
        const seps = new Node('HelpDividers');
        seps.parent = host;
        seps.addComponent(UITransform).setContentSize(1, 1);
        this._helpSeps = seps.addComponent(Graphics);
        this._helpDividerYs = [];

        const sections = this._helpMode === 'draw' ? HELP_SECTIONS_DRAW : HELP_SECTIONS_MAHJONG;

        // 正文自上而下顺排: 游标 y 恒为"上一段的底边", 每段先取中心再连同高度下移
        // (硬约束 3: 写成 y + H/2 会让下一段正好压在上一段上)
        let y = -HELP_PAD_TOP;   // 内容局部坐标: 0 = 内容顶边
        for (const sec of sections) {
            const capY = y - HELP_CAP_H / 2;
            const capBottom = y - HELP_CAP_H;
            y = capBottom - HELP_CAP_GAP;
            this._addHelpCaption(host, sec.title, capY);
            this._helpDividerYs.push(capBottom);

            for (const line of sec.lines) {
                this._addHelpLine(host, line, y - HELP_LINE_H / 2);
                y -= HELP_LINE_H;
            }
            if (sec.fanTable) y = this._buildFanTable(host, y);
            y -= HELP_SEC_GAP;
        }
        // 内容高度 = 末段底边 + 底部留白(比视口高才可拖, 视口由 ScrollView 管)
        this._commitScrollContent(sp, -(y + HELP_SEC_GAP) + HELP_PAD_BOTTOM);
        this._paintHelpDividers();
        sp.sv.scrollToTop(0);   // 换玩法回到顶部, 别停在上一玩法滚到的位置
    }

    /**
     * 切换玩法标签: 换选中态样式(选中实心/未选描边) + 重建滚动内容
     */
    private _setHelpMode(mode: 'mahjong' | 'draw'): void {
        if (this._helpMode === mode) return;
        this._helpMode = mode;
        this._styleHelpTabs();
        this._fillHelpContent();
    }

    /** 补画说明页章节标题下的分隔线(幂等: 先 clear 再画, 原生平台多次调用也安全) */
    private _paintHelpDividers(): void {
        const g = this._helpSeps;
        if (!g) return;
        g.clear();
        g.strokeColor = HELP_CAP_LINE;
        g.lineWidth = 1;
        for (const lineY of this._helpDividerYs) {
            g.moveTo(-HELP_CONTENT_W / 2, lineY);
            g.lineTo(HELP_CONTENT_W / 2, lineY);
            g.stroke();
        }
    }

    /** 章节标题(左对齐在内容区左缘) */
    private _addHelpCaption(parent: Node, text: string, y: number): void {
        const node = createLabelNode(text, HELP_CAP_FONT, new Color(238, 214, 150, 255),
            HELP_CONTENT_W, HELP_CAP_H, true);
        node.parent = parent;
        node.setPosition(0, y, 0);
    }

    /**
     * 正文一行(左对齐)
     *
     * 文本域**按文案宽度给**(硬约束 4): 给窄了 SHRINK 会把字压扁。
     * 这一行超过内容区宽度时由校验脚本报红 —— 说明页的行必须一句话读完,
     * 太长就该拆行, 而不是让玩家看到一排缩小到看不清的字。
     */
    private _addHelpLine(parent: Node, text: string, y: number): void {
        const need = textWidth(text, HELP_LINE_FONT) + 8;
        const node = createLabelNode(text, HELP_LINE_FONT, HELP_TEXT_LINE, need, HELP_LINE_H, true);
        node.parent = parent;
        node.setPosition(-HELP_CONTENT_W / 2 + need / 2, y, 0);
    }

    /**
     * 番型表: 两列排布(左列 牌型/花色番, 右列 状态番/连庄), 每行"名称 + 番数 + 说明"
     *
     * 数据来自 `core/HuScore` 的 `FAN_DEFS`(判定用的同一份) —— 这里只排版, 不写死番数。
     * @param topY 表格上沿(第一行的顶边); 返回表格底边 y
     */
    private _buildFanTable(parent: Node, topY: number): number {
        const rows = buildFanRows();
        const perCol = Math.ceil(rows.length / 2);
        for (let i = 0; i < rows.length; i++) {
            const col = Math.floor(i / perCol);
            const row = i % perCol;
            const left = -HELP_CONTENT_W / 2 + col * (HELP_FAN_COL_W + HELP_FAN_COL_GAP);
            const cy = topY - row * HELP_FAN_ROW_H - HELP_FAN_ROW_H / 2;
            this._addFanRow(parent, rows[i], left, cy);
        }
        return topY - perCol * HELP_FAN_ROW_H;
    }

    /** 番型表的一行: 名称 → 番数(配色取自结算面板的色阶) → 说明 */
    private _addFanRow(parent: Node, row: FanRow, left: number, cy: number): void {
        const nameNode = createLabelNode(row.name, HELP_FAN_NAME_FONT, HELP_FAN_NAME,
            HELP_FAN_NAME_W, HELP_FAN_ROW_H, true);
        nameNode.parent = parent;
        nameNode.setPosition(left + HELP_FAN_NAME_W / 2, cy, 0);

        const fanW = textWidth(row.fanText, HELP_FAN_FONT) + 8;
        const fanNode = createLabelNode(row.fanText, HELP_FAN_FONT, fanColor(row.fan),
            fanW, HELP_FAN_ROW_H, true);
        fanNode.parent = parent;
        fanNode.setPosition(left + HELP_FAN_NAME_W + fanW / 2, cy, 0);

        // 说明列宽度 = 整列宽 - 名称 - 番数; 每条说明都要放得下(校验脚本逐行断言)
        const descW = HELP_FAN_COL_W - HELP_FAN_NAME_W - fanW;
        const descNode = createLabelNode(row.desc, HELP_FAN_FONT, HELP_FAN_DESC,
            descW, HELP_FAN_ROW_H, true);
        descNode.parent = parent;
        descNode.setPosition(left + HELP_FAN_NAME_W + fanW + descW / 2, cy, 0);
    }

    /**
     * 建一个可滚动内容页(设置规则页 / 玩法说明页共用)
     *
     * 结构: view(带 Mask 的视口) → content(实际内容, 比视口高就能拖) + bar(滚动指示条)
     *
     * 【坐标系】内容锚点取 (0.5, 1)、位置取视口顶边 —— 于是内容局部 y = 0 就是内容顶边,
     * 页面里的元素从 0 往下排(负数)。这与 Cocos ScrollView 的边界模型一致
     * (它按"内容顶边 vs 视口顶边"判越界), 初始即在最上面, 不需要额外补偿 ——
     * 早期那版"把 content 原点挪到屏幕中心"的写法是为静态单屏服务的, 现在滚动就别用了。
     *
     * @param contentH 先给个占位高度, 排版完再 `_commitScrollContent` 落定
     */
    private _createScrollPage(name: string, page: Node): ScrollPage {
        const viewTop = RULES_TOP_Y - RULES_TOP_BTN_H / 2 - PAGE_VIEW_TOP_GAP;
        const viewBottom = -MENU_CONTENT_H / 2 + 8;
        const viewH = viewTop - viewBottom;
        const viewCenterY = (viewTop + viewBottom) / 2;

        const view = new Node(name);
        view.parent = page;
        view.addComponent(UITransform).setContentSize(PAGE_VIEW_W, viewH);
        view.setPosition(0, viewCenterY, 0);
        // Mask 裁剪: 拖动时内容不会溢出到顶部按钮行上
        // GRAPHICS_RECT 是默认值(0), 显式写出来是为了表意
        const mask = view.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_RECT;

        const content = new Node('Content');
        content.parent = view;
        const ct = content.addComponent(UITransform);
        ct.setContentSize(PAGE_VIEW_W, 10);
        ct.setAnchorPoint(0.5, 1);          // 顶边对齐: 内容局部 y = 0 就是内容顶边
        content.setPosition(0, viewH / 2, 0);

        const sv = view.addComponent(ScrollView);
        sv.content = content;
        sv.horizontal = false;
        sv.vertical = true;
        sv.inertia = true;
        sv.brake = 0.6;
        sv.elastic = false;      // 不用回弹, 避免内容"飘"出边界
        sv.cancelInnerEvents = true;

        // 滚动指示条挂在视口下(不随内容滚动), 每次 update 按滚动位置重画
        const barNode = new Node('ScrollBar');
        barNode.parent = view;
        barNode.addComponent(UITransform).setContentSize(SCROLL_BAR_W, viewH);
        const bar = barNode.addComponent(Graphics);

        const sp: ScrollPage = { view, content, sv, bar, barKey: '#' };
        this._scrollPages.push(sp);
        return sp;
    }

    /** 内容排版完成后落定高度(内容尺寸变化会触发 ScrollView 重算边界) */
    private _commitScrollContent(sp: ScrollPage, contentH: number): void {
        sp.content.getComponent(UITransform)?.setContentSize(PAGE_VIEW_W, contentH);
        sp.barKey = '#';   // 强制重画滚动条(新页面还没画过)
    }

    /** 当前显示的内容页刷新滚动条(每帧调用; 没滚动就不重画) */
    update(): void {
        if (!this._root || !this._root.active) return;
        for (const sp of this._scrollPages) {
            if (sp.view.activeInHierarchy) this._paintScrollBar(sp);
        }
    }

    /**
     * 重画滚动指示条(内容没超出视口就整条不画 —— 没有可滚的东西不该出现滑块)
     *
     * 进度直接由 `sv.getScrollOffset()` 反推(0 = 顶, -max = 底), 不自己算边界,
     * 免得和 ScrollView 各算一套。
     */
    private _paintScrollBar(sp: ScrollPage): void {
        const g = sp.bar;
        const viewH = sp.view.getComponent(UITransform)?.height ?? 0;
        const contentH = sp.content.getComponent(UITransform)?.height ?? 0;
        const max = sp.sv.getMaxScrollOffset().y;
        const off = Math.max(0, Math.min(max, -sp.sv.getScrollOffset().y));
        const key = `${Math.round(max)}|${Math.round(off)}|${Math.round(viewH)}`;
        if (key === sp.barKey) return;
        sp.barKey = key;
        g.clear();
        if (max <= 1 || viewH <= 0 || contentH <= 0) return;

        const top = viewH / 2 - SCROLL_BAR_PAD;
        const bottom = -viewH / 2 + SCROLL_BAR_PAD;
        const trackH = top - bottom;
        const x = PAGE_VIEW_W / 2 - SCROLL_BAR_RIGHT;
        const r = SCROLL_BAR_W / 2;

        g.fillColor = SCROLL_BAR_TRACK;
        g.roundRect(x - r, bottom, SCROLL_BAR_W, trackH, r);
        g.fill();

        // 滑块高度按"可见部分占比"给, 再按滚动进度下移(到底时滑块贴住轨道底)
        const thumbH = Math.max(SCROLL_BAR_MIN_H, trackH * Math.min(1, viewH / contentH));
        const prog = max > 0 ? off / max : 0;
        const thumbTop = top - prog * (trackH - thumbH);
        g.fillColor = SCROLL_BAR_THUMB;
        g.roundRect(x - r, thumbTop - thumbH, SCROLL_BAR_W, thumbH, r);
        g.fill();
    }

    /** 内容页的阅读底板: 整页压暗, 只留一点背景氛围(文字压在人像/窗户上读不清) */
    private _addPageDim(page: Node): void {
        const dim = new Node('PageDim');
        dim.parent = page;
        dim.addComponent(UITransform).setContentSize(1, 1);
        const g = dim.addComponent(Graphics);
        this._pageDims.push(g);
        this._paintPageDim(g);
    }

    /** 重画全部阅读底板(幂等; 原生平台 onLoad 期间画的不会上屏, 显示时补画) */
    private _paintPageDims(): void {
        for (const g of this._pageDims) this._paintPageDim(g);
    }

    private _paintPageDim(g: Graphics): void {
        g.clear();
        g.fillColor = PAGE_DIM_COLOR;
        // 画得比内容区大得多: 屏幕比例极端时可视区会超出 1680×1040
        g.rect(-3200, -3200, 6400, 6400);
        g.fill();
    }

    private _buildChoiceGroup(
        parent: Node,
        cfg: {
            key: string;
            caption: string;
            hint?: string;
            options: ChoiceOption[];
            y: number;
            selected: () => number;
            onPick: (value: number) => void;
        },
    ): void {
        const textX = RULES_TEXT_LEFT + RULES_TEXT_W / 2;

        // 字号与文本域高度都显式给足(硬约束 4: 文本域小了会被 SHRINK 压扁)
        const caption = createLabelNode(cfg.caption, RULES_CAPTION_FONT,
            new Color(236, 226, 202, 255), RULES_TEXT_W, H_CAP_LINE, true);
        caption.parent = parent;
        caption.setPosition(textX, cfg.y + RULES_CAPTION_DY, 0);

        if (cfg.hint) {
            const hint = createLabelNode(cfg.hint, RULES_HINT_FONT,
                new Color(204, 200, 184, 255), RULES_TEXT_W, H_HINT_LINE, true);
            hint.parent = parent;
            hint.setPosition(textX, cfg.y + RULES_HINT_DY, 0);
        }

        const buttons: Node[] = [];
        // 按钮列的可用宽度: 从文字列右缘到面板右内边距, 留 8px 呼吸位。
        // 4 个选项(音量档)时 170×4+16×3 会压到文字列上(实测需要 ≤129px),
        // 所以按选项数自适应收缩 —— 2 选项的玩法行仍然是 170px, 版式不变。
        const textRight = RULES_TEXT_LEFT + RULES_TEXT_W;
        const availW = RULES_BTN_RIGHT - textRight - 8;
        const fitW = (availW - (cfg.options.length - 1) * RULES_BTN_GAP) / cfg.options.length;
        const btnW = Math.min(RULES_BTN_W, fitW);
        const totalW = cfg.options.length * btnW + (cfg.options.length - 1) * RULES_BTN_GAP;
        const firstCenter = RULES_BTN_RIGHT - totalW + btnW / 2;

        for (let i = 0; i < cfg.options.length; i++) {
            const opt = cfg.options[i];
            const btn = createButtonNode(opt.label, btnW, RULES_BTN_H, LINE_GHOST, MENU_GHOST_STYLE);
            // 按钮高 68: 文字也要跟着大一号, 否则按钮显得空
            const bl = buttonLabel(btn);
            if (bl) bl.fontSize = 30;
            btn.parent = parent;
            btn.setPosition(firstCenter + i * (btnW + RULES_BTN_GAP), cfg.y, 0);
            bindSafeClick(btn, () => cfg.onPick(opt.value), this);
            buttons.push(btn);
        }

        this._optionButtons.set(cfg.key, buttons);
        this._optionValues.set(cfg.key, cfg.options.map(o => o.value));
        this._optionPickers.set(cfg.key, cfg.onPick);
    }

    /**
     * 按当前规则刷新设置页的选择态
     *
     * 主菜单那行摘要是"两种玩法各是什么"(静态文案), 不再随规则变化 ——
     * 规则/音量的当前档位只在设置页里点亮。
     */
    private _refreshRuleState(): void {
        const r = GAME_RULES.rules;
        this._applyChoice('allowChi', r.allowChi ? 1 : 0);
        this._applyChoice('allowAddKan', r.allowAddKan ? 1 : 0);
        this._applyChoice('allowChiHu', r.allowChiHu ? 1 : 0);
        this._applyChoice('allowRobKan', r.allowRobKan ? 1 : 0);
        this._applyChoice('allowMultiRon', r.allowMultiRon ? 1 : 0);
        this._applyChoice('allowRiichi', r.allowRiichi ? 1 : 0);
        this._applyChoice('sfxVolume', nearestVolumeLevel(r.sfxVolume));
        this._applyChoice('bgmEnabled', r.bgmEnabled ? 1 : 0);
        this._applyChoice('bgmVolume', nearestVolumeLevel(r.bgmVolume));
    }

    /** 把某组选项中与当前值一致的那一项点亮 */
    private _applyChoice(key: string, current: number): void {
        const buttons = this._optionButtons.get(key);
        const values = this._optionValues.get(key);
        if (!buttons || !values) return;
        for (let i = 0; i < buttons.length; i++) {
            const selected = Math.abs(values[i] - current) < 1e-6;
            restyleButton(
                buttons[i],
                selected ? BTN_PRIMARY : LINE_GHOST,
                selected ? MENU_BTN_STYLE : MENU_GHOST_STYLE,
            );
            const label = buttonLabel(buttons[i]);
            if (label) label.color = selected ? TEXT_INK : TEXT_TITLE;
            const op = buttons[i].getComponent(UIOpacity) ?? buttons[i].addComponent(UIOpacity);
            op.opacity = selected ? OPACITY_ON : OPACITY_OFF;
            buttons[i].setScale(selected ? new Vec3(1.06, 1.06, 1) : new Vec3(1, 1, 1));
        }
    }
}
