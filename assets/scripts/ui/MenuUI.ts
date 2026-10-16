import {
    _decorator, Component, Node, Color, Label, Graphics, UITransform, Vec3,
    view, UIOpacity, Sprite, SpriteFrame, resources, ScrollView, Mask,
} from 'cc';
import {
    createLabelNode, createButtonNode, restyleButton, repaintButtons, applyDesignResolution,
    ButtonStyle, bindSafeClick, buttonLabel,
} from './UIFactory';
import { GAME_RULES, DEFAULT_RULES } from '../game/GameRules';
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

// ==================== 规则设置页布局 ====================
//
// 【改为全屏 + 滚动, 不再用居中的深色面板】
// 原来 PANEL_H=940 装在 MENU_CONTENT_H=1040 里, 上下各留 50 白边,
// 而面板内部能用的纵向只有 703px(标题下沿 351 → 返回按钮上沿 -352),
// 9 个"标题+说明"的选项(每行 76px)根本放不下, 于是把说明文字挤到一块。
//
// 去掉面板框后可视高度从 703px 涨到 941px, 9 行带说明(928px)**一屏就装得下**。
// 滚动条仍保留: 以后再加设置项超出时可直接滚, 不必再改版式。
//
// 2026-10-15: 应用户要求删除"规则设置"标题与上下两条黑色半透明渐变遮罩,
// 顶部一行现在只放左上角的返回/恢复默认按钮; 可读性只靠 MenuMask 的整页渐变。
// PANEL_H 已移除: 曾经定义面板高度 940(装在可见 1040 里), 现在改成全屏布局。
// PANEL_W 仍保留 —— 它只用来定位文字列与按钮列, 两者现在都要收在屏幕宽度内。
const PANEL_W = 1080;
const RULES_PAD = 44;
const RULES_TEXT_LEFT = -PANEL_W / 2 + RULES_PAD;
const RULES_TEXT_W = 420;
const RULES_BTN_RIGHT = PANEL_W / 2 - RULES_PAD;
const RULES_BTN_W = 170;
const RULES_BTN_H = 60;
const RULES_BTN_GAP = 16;
/** 行内: 标题与其说明小字之间的间距(必须小于 RULES_ROW_GAP, 否则层次反了) */
const RULES_CAPTION_DY = 10;
const RULES_HINT_DY = -22;
/**
 * 行间距(行心到行心): 行块(caption30+内8+hint20=58) + 28px 行间空隙。
 * 28px 是"视觉上分得开各项"的下限, 再小就会糊成一片(真机截图教训)。
 */
const RULES_ROW_GAP = 28;
/** 9 行选项(吃/续杠/吃胡/抢杠/一炮多响/听牌宣言 + 音效音量/背景音乐/音乐音量) */
const RULES_ROW_YS = [407, 321, 235, 149, 63, -23, -109, -195, -281];
const RULES_TIPS_Y = -368;
const RULES_TIPS_W = 1000;
/** 底部说明块: 2 行 × 字号 22 + 余量 */
const RULES_TIPS_H = 64;
/**
 * 顶部一行(原"规则设置"标题所在行)的中心 y。
 * 标题已删除, 这一行现在只放左上角的返回/恢复默认两个按钮;
 * 滚动视口顶 = RULES_TOP_Y - 42(按钮下沿再留一点呼吸位)。
 */
const RULES_TOP_Y = 474;
/** 返回按钮: 左上角 */
const RULES_BACK_X = -PANEL_W / 2 + RULES_PAD + 100;
const RULES_BACK_Y = RULES_TOP_Y;

export interface ChoiceOption { label: string; value: number; }

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
    /** 点击"开始游戏" */
    onStart: (() => void) | null = null;

    private _root: Node | null = null;
    private _homeNode: Node | null = null;
    private _rulesNode: Node | null = null;
    private _summaryLabel: Label | null = null;
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
        this.showHome();

        GAME_RULES.onChange(() => this._refreshRuleState());
        this._refreshRuleState();

        view.on('canvas-resize', this.adapt, this);
        this.adapt();
    }

    onDestroy(): void {
        view.off('canvas-resize', this.adapt, this);
    }

    /** 显示主页面 */
    showHome(): void {
        if (this._root) this._root.active = true;
        if (this._homeNode) this._homeNode.active = true;
        if (this._rulesNode) this._rulesNode.active = false;
        this.redrawBackdrop();
        repaintButtons(this._homeNode);
        this.adapt();
    }

    /** 显示规则设置页 */
    showRules(): void {
        if (this._root) this._root.active = true;
        if (this._homeNode) this._homeNode.active = false;
        if (this._rulesNode) this._rulesNode.active = true;
        this.redrawBackdrop();
        repaintButtons(this._rulesNode);
        this._refreshRuleState();
        this.adapt();
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
     *   麻将徽章(玉绿方块)  y = 260
     *   大标题 "麻将"        y = 140
     *   副标题              y = 50
     *   ────────(分割线)────
     *   主按钮 "开始游戏"    y = -60
     *   次按钮 "设置规则"    y = -168
     *   规则摘要            y = -266
     *   操作提示            y = -314
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

        const sub = createLabelNode('单人对局 · 三家 AI', 30, TEXT_SUB, 1200);
        sub.parent = page;
        sub.setPosition(0, 90, 0);

        // 主按钮: 琥珀金实心胶囊 + 深墨字
        const startBtn = createButtonNode('开始游戏', 420, 100, BTN_PRIMARY, MENU_BTN_STYLE);
        startBtn.parent = page;
        startBtn.setPosition(0, -60, 0);
        bindSafeClick(startBtn, () => this.onStart?.(), this);
        const startLabel = buttonLabel(startBtn);
        if (startLabel) {
            startLabel.color = TEXT_INK;
            startLabel.isBold = true;
            startLabel.fontSize = 36;
        }

        // 次按钮: 描边胶囊
        const rulesBtn = createButtonNode('设置规则', 420, 82, LINE_GHOST, MENU_GHOST_STYLE);
        rulesBtn.parent = page;
        rulesBtn.setPosition(0, -168, 0);
        bindSafeClick(rulesBtn, () => this.showRules(), this);

        // 规则摘要
        const summary = createLabelNode('', 24, TEXT_SUB, 1400);
        summary.parent = page;
        summary.setPosition(0, -266, 0);
        this._summaryLabel = summary.getComponent(Label);

        const tip = createLabelNode('按住手牌往上拖, 松手即可出牌', 22, TEXT_MUTED, 1400);
        tip.parent = page;
        tip.setPosition(0, -314, 0);
    }

    // ==================== 规则设置页 ====================

    private _buildRulesPage(): void {
        const page = new Node('MenuRules');
        page.parent = this._root;
        this._rulesNode = page;

        // 【不再画居中深色面板, 也没有标题和上下渐变遮罩】
        // 全屏直接用背景图; 可视高度 941px, 9 行"标题+说明"一屏就装得下。
        // 左上角只放返回/恢复默认两个按钮(原标题"规则设置"已按需求删除,
        // 上下两条黑色半透明渐变也已删除, 可读性只靠 MenuMask)。

        // 返回按钮: 左上角顶部一行
        const backBtn = createButtonNode('返回', 200, 62, LINE_GHOST, MENU_GHOST_STYLE);
        backBtn.parent = page;
        backBtn.setPosition(RULES_BACK_X, RULES_BACK_Y, 0);
        bindSafeClick(backBtn, () => this.showHome(), this);

        // 恢复默认也放左上角, 排在返回右侧(原来在底部, 现在底部要留给滚动内容)
        const resetBtn = createButtonNode('恢复默认', 220, 62, LINE_GHOST, MENU_GHOST_STYLE);
        resetBtn.parent = page;
        resetBtn.setPosition(RULES_BACK_X + 320, RULES_BACK_Y, 0);
        bindSafeClick(resetBtn, () => GAME_RULES.reset(), this);

        // 选项内容装进滚动容器。
        // 目前 9 行一屏就装得下(此时 ScrollView 会自动禁用拖动, 等同静态布局),
        // 保留它是为了以后再加设置项时不必重排版式。
        const scroll = this._createRulesScroll(page);
        const host = scroll ?? page;

        // 选项组 1-4
        this._buildChoiceGroup(host, {
            key: 'allowChi',
            caption: '吃牌',
            hint: '仅吃上家的出牌',
            options: ON_OFF,
            y: RULES_ROW_YS[0],
            selected: () => (GAME_RULES.rules.allowChi ? 1 : 0),
            onPick: (v) => GAME_RULES.setAllowChi(v === 1),
        });

        this._buildChoiceGroup(host, {
            key: 'allowAddKan',
            caption: '续杠',
            hint: '碰过的牌后来又摸到,可补成杠',
            options: ON_OFF,
            y: RULES_ROW_YS[1],
            selected: () => (GAME_RULES.rules.allowAddKan ? 1 : 0),
            onPick: (v) => GAME_RULES.setAllowAddKan(v === 1),
        });

        this._buildChoiceGroup(host, {
            key: 'allowChiHu',
            caption: '吃胡',
            hint: '可以胡别人打出的牌',
            options: ON_OFF,
            y: RULES_ROW_YS[2],
            selected: () => (GAME_RULES.rules.allowChiHu ? 1 : 0),
            onPick: (v) => GAME_RULES.setAllowChiHu(v === 1),
        });

        this._buildChoiceGroup(host, {
            key: 'allowRobKan',
            caption: '抢杠胡',
            hint: '别人补杠时可抢那张牌胡',
            options: ON_OFF,
            y: RULES_ROW_YS[3],
            selected: () => (GAME_RULES.rules.allowRobKan ? 1 : 0),
            onPick: (v) => GAME_RULES.setAllowRobKan(v === 1),
        });

        this._buildChoiceGroup(host, {
            key: 'allowMultiRon',
            caption: '一炮多响',
            hint: '多家同时听同一张牌时可一起胡',
            options: ON_OFF,
            y: RULES_ROW_YS[4],
            selected: () => (GAME_RULES.rules.allowMultiRon ? 1 : 0),
            onPick: (v) => GAME_RULES.setAllowMultiRon(v === 1),
        });

        this._buildChoiceGroup(host, {
            key: 'allowRiichi',
            caption: '听牌宣言',
            hint: '亮明在等牌(加 1 番), 之后不可吃碰杠',
            options: ON_OFF,
            y: RULES_ROW_YS[5],
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
            y: RULES_ROW_YS[6],
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
            y: RULES_ROW_YS[7],
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
            y: RULES_ROW_YS[8],
            selected: () => nearestVolumeLevel(GAME_RULES.rules.bgmVolume),
            onPick: (v) => {
                GAME_RULES.setBgmVolume(v);
                syncAudioSettings();
            },
        });

        const tips = createLabelNode(
            // 补充说明: 每行的小字讲"这一项是什么", 这里讲"跨项的通用规则"
            '计分: 每 1 番翻一倍, 8 番封顶; 清一色 / 对对胡 / 七对 / 十三幺 / 杠上开花 / 海底捞月等自动识别。\nAI 满能力档: 你的每次出牌与吃碰杠有 20 秒, 超时自动处理(出牌打掉刚摸的牌, 副露默认过)。音效与背景音乐改完立刻生效。',
            // 行数与 RULES_TIPS_H 绑定, 改行数必须同步改并重跑 rules-layout-test
            22, new Color(214, 202, 176, 255), RULES_TIPS_W, RULES_TIPS_H, true,
        );
        tips.parent = host;
        tips.setPosition(RULES_TEXT_LEFT + RULES_TIPS_W / 2, RULES_TIPS_Y, 0);
    }

    /**
     * 创建设置页的滚动容器
     *
     * 结构: RulesScrollView(带 Mask 的视口)
     *            └ Content(实际内容, 高度可大于视口 → 可拖动)
     *
     * 内容比视口短时 ScrollView 不会响应拖动, 所以"当前一屏放得下"与
     * "以后能滚动"这两件事不冲突 —— 不需要为了将来而现在就付出滚动的操作成本。
     *
     * 视口 = 顶部按钮行下沿 → 屏幕底部(标题已删除, 顶部只剩返回/恢复默认)。
     * @returns Content 节点(选项组与说明文字都挂在它下面)
     */
    private _createRulesScroll(page: Node): Node {
        const viewTop = RULES_TOP_Y - 42;         // 顶部按钮行下沿
        const viewBottom = -MENU_CONTENT_H / 2 + 8;
        const viewH = viewTop - viewBottom;
        const viewW = MENU_CONTENT_W - 80;
        const viewCenterY = (viewTop + viewBottom) / 2;

        const view = new Node('RulesScrollView');
        view.parent = page;
        view.addComponent(UITransform).setContentSize(viewW, viewH);
        view.setPosition(0, viewCenterY, 0);
        // Mask 裁剪: 拖动时内容不会溢出到顶部按钮上
        // GRAPHICS_RECT 是默认值(0), 显式写出来是为了表意
        const mask = view.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_RECT;

        const content = new Node('Content');
        content.parent = view;
        // 内容高度按"9 行 + 说明块"实际用到的范围给足, 超出视口才可拖动
        const contentH = viewH;
        content.addComponent(UITransform).setContentSize(viewW, contentH);
        /**
         * 【坐标系对齐】RULES_ROW_YS 等常量是按"全屏中心 y=0"设计的,
         * 而 ScrollView 的 content 原点在**视口中心**。
         * 这里把 Content 下移 -(视口中心 y), 使 content 原点与全屏中心重合 ——
         * 否则所有行会整体上移 40px, 首行顶到标题上。
         */
        content.setPosition(0, -viewCenterY, 0);

        const sv = view.addComponent(ScrollView);
        sv.content = content;
        sv.horizontal = false;
        sv.vertical = true;
        sv.inertia = true;
        sv.brake = 0.6;
        sv.elastic = false;      // 不用回弹, 避免内容"飘"出边界
        sv.cancelInnerEvents = true;
        return content;
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

        const caption = createLabelNode(cfg.caption, 30, new Color(232, 222, 198, 255), RULES_TEXT_W, 0, true);
        caption.parent = parent;
        caption.setPosition(textX, cfg.y + RULES_CAPTION_DY, 0);

        if (cfg.hint) {
            const hint = createLabelNode(cfg.hint, 20, new Color(196, 192, 178, 255), RULES_TEXT_W, 0, true);
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
            btn.parent = parent;
            btn.setPosition(firstCenter + i * (btnW + RULES_BTN_GAP), cfg.y, 0);
            bindSafeClick(btn, () => cfg.onPick(opt.value), this);
            buttons.push(btn);
        }

        this._optionButtons.set(cfg.key, buttons);
        this._optionValues.set(cfg.key, cfg.options.map(o => o.value));
        this._optionPickers.set(cfg.key, cfg.onPick);
    }

    /** 按当前规则刷新设置页选中态与主页面摘要 */
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

        if (this._summaryLabel) {
            const onOff = (v: boolean): string => (v ? '开' : '关');
            const volName = (v: number): string => {
                const hit = VOLUME_LEVELS.find(o => Math.abs(o.value - nearestVolumeLevel(v)) < 1e-6);
                return hit ? hit.label : '中';
            };
            this._summaryLabel.string =
                `当前规则: 吃${onOff(r.allowChi)} · 续杠${onOff(r.allowAddKan)}`
                + ` · 吃胡${onOff(r.allowChiHu)} · 抢杠${onOff(r.allowRobKan)}`
                + ` · 一炮多响${onOff(r.allowMultiRon)} · 听牌宣言${onOff(r.allowRiichi)}`
                + ' · AI 满能力'
                + `\n音频: 音效${volName(r.sfxVolume)} · 音乐${onOff(r.bgmEnabled)}`
                + (r.bgmEnabled ? `(${volName(r.bgmVolume)})` : '')
                + (GAME_RULES.isDefault ? '(默认)' : '');
        }
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
