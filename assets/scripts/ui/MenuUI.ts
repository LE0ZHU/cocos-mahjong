import {
    _decorator, Component, Node, Color, Label, Graphics, UITransform, Vec3,
    view, UIOpacity, Sprite, SpriteFrame, resources,
} from 'cc';
import {
    createLabelNode, createButtonNode, restyleButton, repaintButtons, applyDesignResolution,
    ButtonStyle, bindSafeClick,
} from './UIFactory';
import { GAME_RULES, DEFAULT_RULES, AI_SPEED_OPTIONS } from '../game/GameRules';

const { ccclass } = _decorator;

/** 主页面 / 设置页面的内容基准尺寸 */
const MENU_CONTENT_W = 1680;
const MENU_CONTENT_H = 800;

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

/** 取按钮节点里的文字 Label(createButtonNode 固定用名为 'Label' 的子节点) */
function buttonLabel(node: Node): Label | null {
    return node.getChildByName('Label')?.getComponent(Label) ?? null;
}

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
const OPACITY_ON = 255;
const OPACITY_OFF = 165;

// ==================== 规则设置页布局 ====================
const PANEL_W = 1080;
const PANEL_H = 720;
const RULES_PAD = 44;
const RULES_TEXT_LEFT = -PANEL_W / 2 + RULES_PAD;
const RULES_TEXT_W = 420;
const RULES_BTN_RIGHT = PANEL_W / 2 - RULES_PAD;
const RULES_BTN_W = 170;
const RULES_BTN_H = 60;
const RULES_BTN_GAP = 16;
const RULES_CAPTION_DY = 16;
const RULES_HINT_DY = -18;
const RULES_TITLE_Y = 244;
const RULES_ROW_YS = [150, 66, -18, -102];
const RULES_TIPS_Y = -176;
const RULES_TIPS_W = 1000;
const RULES_TIPS_H = 64;
const RULES_BTN_Y = -PANEL_H / 2 + 92;

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
     * 重画遮罩层与规则页玻璃卡片(Sprite 背景不需要重绘,Graphics 需要补画)
     */
    redrawBackdrop(): void {
        const halfH = Math.max(applyDesignResolution().height, MENU_CONTENT_H);
        // 遮罩层(渐变暗化)
        const mask = this._root?.getChildByName('MenuMask');
        const mg = mask?.getComponent(Graphics);
        if (mg) this._paintMask(mg, halfH);
        // 规则页玻璃卡片
        const rulesCard = this._rulesNode?.getChildByName('RulesCard');
        const rg = rulesCard?.getComponent(Graphics);
        if (rg) this._paintRulesCard(rg);
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

    /** 规则页玻璃卡片绘制 */
    private _paintRulesCard(g: Graphics): void {
        g.clear();
        const pw = PANEL_W;
        const ph = PANEL_H;
        const r = 40;
        // 半透明玻璃面(让背景图透一些出来)
        g.fillColor = new Color(12, 18, 16, 160);
        g.roundRect(-pw / 2, -ph / 2, pw, ph, r);
        g.fill();
        // 顶边高光
        g.fillColor = new Color(255, 255, 255, 14);
        g.roundRect(-pw / 2 + r + 24, ph / 2 - 2.5, pw - (r + 24) * 2, 2.5, 1);
        g.fill();
        // 外圈细描边
        g.strokeColor = new Color(255, 255, 255, 22);
        g.lineWidth = 2;
        g.roundRect(-pw / 2, -ph / 2, pw, ph, r);
        g.stroke();
    }

    private _buildRulesPage(): void {
        const page = new Node('MenuRules');
        page.parent = this._root;
        this._rulesNode = page;

        // 玻璃卡片容器
        const card = new Node('RulesCard');
        card.parent = page;
        card.addComponent(UITransform).setContentSize(PANEL_W, PANEL_H);
        this._paintRulesCard(card.addComponent(Graphics));

        const title = createLabelNode('规则设置', 60, TEXT_TITLE, 1200);
        title.parent = page;
        title.setPosition(0, RULES_TITLE_Y, 0);
        emphasizeLabel(title, 4);

        // 选项组 1-4
        this._buildChoiceGroup(page, {
            key: 'allowChi',
            caption: '吃牌',
            hint: '只能吃上家打出的牌',
            options: ON_OFF,
            y: RULES_ROW_YS[0],
            selected: () => (GAME_RULES.rules.allowChi ? 1 : 0),
            onPick: (v) => GAME_RULES.setAllowChi(v === 1),
        });

        this._buildChoiceGroup(page, {
            key: 'allowAddKan',
            caption: '续杠',
            hint: '碰过之后再摸到同一张,可补成杠',
            options: ON_OFF,
            y: RULES_ROW_YS[1],
            selected: () => (GAME_RULES.rules.allowAddKan ? 1 : 0),
            onPick: (v) => GAME_RULES.setAllowAddKan(v === 1),
        });

        this._buildChoiceGroup(page, {
            key: 'allowChiHu',
            caption: '吃胡',
            hint: '听牌时别人打出所听的牌,可选择胡',
            options: ON_OFF,
            y: RULES_ROW_YS[2],
            selected: () => (GAME_RULES.rules.allowChiHu ? 1 : 0),
            onPick: (v) => GAME_RULES.setAllowChiHu(v === 1),
        });

        this._buildChoiceGroup(page, {
            key: 'aiSpeed',
            caption: 'AI 思考速度',
            hint: 'AI 出牌的间隔时间',
            options: AI_SPEED_OPTIONS.map(o => ({ label: o.label, value: o.delay })),
            y: RULES_ROW_YS[3],
            selected: () => GAME_RULES.rules.aiDelay,
            onPick: (v) => GAME_RULES.setAiDelay(v),
        });

        const tips = createLabelNode(
            '胡牌: 自摸;开启吃胡后也可胡别人打出的牌。  副露: 吃(下家) / 碰 / 杠 / 续杠。\n规则在下一局生效, 开局或重新开始即可应用。',
            22, new Color(214, 202, 176, 255), RULES_TIPS_W, RULES_TIPS_H, true,
        );
        tips.parent = page;
        tips.setPosition(RULES_TEXT_LEFT + RULES_TIPS_W / 2, RULES_TIPS_Y, 0);

        const backBtn = createButtonNode('返回', 240, 68, LINE_GHOST, MENU_GHOST_STYLE);
        backBtn.parent = page;
        backBtn.setPosition(-140, RULES_BTN_Y, 0);
        bindSafeClick(backBtn, () => this.showHome(), this);

        const resetBtn = createButtonNode('恢复默认', 240, 68, LINE_GHOST, MENU_GHOST_STYLE);
        resetBtn.parent = page;
        resetBtn.setPosition(140, RULES_BTN_Y, 0);
        bindSafeClick(resetBtn, () => GAME_RULES.reset(), this);
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
        const totalW = cfg.options.length * RULES_BTN_W + (cfg.options.length - 1) * RULES_BTN_GAP;
        const firstCenter = RULES_BTN_RIGHT - totalW + RULES_BTN_W / 2;

        for (let i = 0; i < cfg.options.length; i++) {
            const opt = cfg.options[i];
            const btn = createButtonNode(opt.label, RULES_BTN_W, RULES_BTN_H, LINE_GHOST, MENU_GHOST_STYLE);
            btn.parent = parent;
            btn.setPosition(firstCenter + i * (RULES_BTN_W + RULES_BTN_GAP), cfg.y, 0);
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
        this._applyChoice('aiSpeed', r.aiDelay);

        if (this._summaryLabel) {
            const speed = AI_SPEED_OPTIONS.find(o => Math.abs(o.delay - r.aiDelay) < 1e-6);
            const onOff = (v: boolean): string => (v ? '允许' : '禁止');
            this._summaryLabel.string =
                `当前规则: 吃牌${onOff(r.allowChi)} · 续杠${onOff(r.allowAddKan)}`
                + ` · 吃胡${onOff(r.allowChiHu)} · AI ${speed ? speed.label : '自定义'}`
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
