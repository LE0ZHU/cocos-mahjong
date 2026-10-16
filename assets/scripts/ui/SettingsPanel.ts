import {
    _decorator, Component, Node, Color, Graphics, UITransform, UIOpacity, Vec3, EventTouch,
} from 'cc';
import {
    ButtonStyle, bindSafeClick, buttonLabel, createButtonNode, createLabelNode,
    repaintButtons, restyleButton,
} from './UIFactory';
import { GAME_RULES } from '../game/GameRules';
import { syncAudioSettings } from '../audio/Sound';
import { ChoiceOption, ON_OFF_AUDIO, VOLUME_LEVELS, nearestVolumeLevel } from './MenuUI';

const { ccclass } = _decorator;

/**
 * 对局内设置弹窗
 *
 * 【为什么要有它】原先牌桌左上角直接摆着"重新开始 / 返回主页面"两个按钮,
 * 占着牌桌最显眼的位置, 却都不是高频操作; 而音量想改还得先退出对局回主菜单。
 * 现在收成一个齿轮按钮 + 一张弹窗: 声音设置与两个对局操作都在里面。
 *
 * 【为什么是模态】弹窗打开时必须挡住牌桌 —— 否则玩家点"重新开始"时
 * 手指可能同时点到手牌出牌。遮罩本身拦截触摸, Main 那里还额外拦一道
 * (见 Main._onSettingsBlocked, 双保险; 引擎的事件派发顺序不能想当然)。
 *
 * 【为什么必须自适应缩放】与提示面板同一套理由: 手机横屏的可见高度很小
 * (21:9 半高只有 360), 写死高度必然在某些比例下把按钮挤出屏幕 ——
 * 而这张卡片里的"重新开始 / 返回主页面"是玩家唯一的出口, 挤出去就等于卡死。
 *
 * 【打开时冻结决策倒计时】玩家在设置里调音量时看不到牌桌, 不该被 20 秒判超时
 * (那等于系统瞒着玩家替他做决定)。由 Main 在开关弹窗时调 GameManager 的
 * pause/resumeDecideTimer。
 */

// ==================== 卡片版式 ====================
/** 卡片宽度: 4 档音量按钮 + 文字列都能从容放下 */
const CARD_W = 640;
const PAD_X = 34;
const PAD_Y = 28;

/** 标题"设置" */
const H_TITLE = 50;
const GAP_TITLE = 18;
/** 分组标题"声音" */
const H_GROUP = 30;
const GAP_GROUP = 14;
/** 每一项的标题(音效音量 / 背景音乐 / 音乐音量) */
const H_CAPTION = 32;
const GAP_CAPTION = 6;
/** 选项按钮行 */
const H_ROW = 58;
/** 项与项之间 */
const GAP_ROW = 20;
/** 分隔线(选项区与操作按钮区之间) */
const H_DIVIDER = 1;
const GAP_DIVIDER = 22;
/** 底部两个操作按钮 */
const H_BTN = 62;
const OPT_GAP = 12;
const BTN_GAP = 24;

/** 缩放下限: 再小按钮就难点到了 */
const MIN_SCALE = 0.66;
/** 遮罩尺寸(比屏幕大得多, 盖住整张牌桌) */
const MASK_SIZE = 12000;

// ==================== 配色(与提示/结算面板同源) ====================
const CARD_BG = new Color(16, 32, 27, 245);
const CARD_BORDER = new Color(214, 176, 96, 225);
const TEXT_TITLE = new Color(250, 246, 236, 255);
const TEXT_CAPTION = new Color(226, 220, 202, 255);
const TEXT_GROUP = new Color(206, 184, 132, 255);
const DIVIDER_LINE = new Color(214, 176, 96, 105);
/** 选中态: 暖金实心 + 深墨字(与主菜单主按钮同一组色) */
const BTN_SELECTED = new Color(230, 182, 68, 255);
const TEXT_INK = new Color(28, 21, 12, 255);
/** 未选中态: 极淡玻璃底 + 细描边 */
const BTN_GHOST = new Color(240, 238, 228, 255);
const OPACITY_ON = 255;
const OPACITY_OFF = 158;
/** 返回主页面用暗红色: 这是"退出当前对局", 与"重新开始"的进取语义区分开 */
const BTN_BACK = new Color(198, 108, 96, 255);

/** 一个选项组的内容 */
interface OptionSpec {
    caption: string;
    options: ChoiceOption[];
    /** 当前选中值(每次重建时读取, 所以永不显示过期状态) */
    current: () => number;
    onPick: (v: number) => void;
}

@ccclass('SettingsPanel')
export class SettingsPanel extends Component {
    /** 点击"重新开始" */
    onRestart: (() => void) | null = null;
    /** 点击"返回主页面" */
    onBack: (() => void) | null = null;
    /** 面板关闭(点 × / 由外部收起) */
    onClose: (() => void) | null = null;

    private _card: Node | null = null;
    private _dim: Node | null = null;
    private _isOpen = false;
    /** 可见区半高(内容坐标), 由 Main 在 _applyLayout 里告知 */
    private _halfH = 0;
    private _scale = 1;

    onLoad(): void {
        // 遮罩: 视觉上压暗牌桌, 同时吃掉落在上面的触摸(防止点到手牌)
        const dim = new Node('Dim');
        dim.parent = this.node;
        dim.addComponent(UITransform).setContentSize(MASK_SIZE, MASK_SIZE);
        const dg = dim.addComponent(Graphics);
        dg.fillColor = new Color(0, 0, 0, 172);
        dg.rect(-MASK_SIZE / 2, -MASK_SIZE / 2, MASK_SIZE, MASK_SIZE);
        dg.fill();
        dim.on(Node.EventType.TOUCH_START, this._swallow, this);
        dim.on(Node.EventType.TOUCH_MOVE, this._swallow, this);
        dim.on(Node.EventType.TOUCH_END, this._swallow, this);
        this._dim = dim;

        const card = new Node('Card');
        card.parent = this.node;
        card.addComponent(UITransform).setContentSize(CARD_W, 10);
        card.addComponent(Graphics);
        // 卡片自身也吃事件: 弹窗上的空白处被点到时不该穿到牌桌
        card.on(Node.EventType.TOUCH_START, this._swallow, this);
        card.on(Node.EventType.TOUCH_END, this._swallow, this);
        this._card = card;

        this.node.active = false;
    }

    /** 拦截触摸, 不让它继续派发到下层牌桌 */
    private _swallow(e: EventTouch): void {
        e.propagationStopped = true;
    }

    get isOpen(): boolean { return this._isOpen; }

    /** 打开弹窗(每次按当前设置重建, 状态永远是最新的) */
    show(): void {
        this._isOpen = true;
        this.node.active = true;
        this._rebuild();
        // 原生平台: 隐藏过的按钮底框只剩文字, 显示时补画一次
        this.scheduleOnce(() => repaintButtons(this._card), 0);
    }

    /** 关闭弹窗 */
    hide(): void {
        this._isOpen = false;
        this.node.active = false;
    }

    /**
     * 告知可见区半高并重排(由 Main._applyLayout 调用)
     * 面板正开着时尺寸变了要立刻按新比例重建, 否则转屏后按钮会被挤出屏幕。
     */
    fit(halfH: number): void {
        const changed = Math.abs(halfH - this._halfH) > 0.5;
        this._halfH = halfH;
        if (changed && this._isOpen) this._rebuild();
    }

    // ==================== 排版 ====================

    /** 内容区需要的未缩放高度(选项组 + 标题 + 按钮行) */
    private static _contentH(groupCount: number): number {
        return PAD_Y * 2
            + H_TITLE + GAP_TITLE
            + H_GROUP + GAP_GROUP
            + groupCount * (H_CAPTION + GAP_CAPTION + H_ROW)
            + (groupCount - 1) * GAP_ROW
            + GAP_DIVIDER + H_DIVIDER + GAP_DIVIDER
            + H_BTN;
    }

    /** 按可见高度算缩放: 放不下就整体缩(不砍内容 —— 里面的按钮是出口, 一个都不能少) */
    private _computeScale(): number {
        const contentH = SettingsPanel._contentH(3);
        const availH = this._halfH > 0 ? this._halfH * 2 - 24 : 0;
        if (availH <= 0 || contentH <= availH) return 1;
        return Math.max(MIN_SCALE, Math.min(1, availH / contentH));
    }

    private _rebuild(): void {
        const card = this._card;
        if (!card) return;
        for (const child of [...card.children]) child.destroy();

        this._scale = this._computeScale();
        const h = SettingsPanel._contentH(3);
        const contentW = CARD_W - PAD_X * 2;

        card.getComponent(UITransform)?.setContentSize(CARD_W, h);
        card.setScale(this._scale, this._scale, 1);
        this._paintCard(card.getComponent(Graphics)!, CARD_W, h);

        // ---- 纵向排版: 游标 y 恒为"上一段的底边", 每段先取中心再连同高度下移 ----
        let y = h / 2 - PAD_Y;

        const titleY = y - H_TITLE / 2;
        y -= H_TITLE + GAP_TITLE;

        const groupY = y - H_GROUP / 2;
        y -= H_GROUP + GAP_GROUP;

        this._label(card, '设置', 44, TEXT_TITLE, contentW, titleY, 0, false);
        this._label(card, '声音', 26, TEXT_GROUP, contentW, groupY, 0, true);

        const groups: OptionSpec[] = [
            {
                caption: '音效音量',
                options: VOLUME_LEVELS,
                current: () => nearestVolumeLevel(GAME_RULES.rules.sfxVolume),
                onPick: (v) => { GAME_RULES.setSfxVolume(v); syncAudioSettings(); },
            },
            {
                caption: '背景音乐',
                options: ON_OFF_AUDIO,
                current: () => (GAME_RULES.rules.bgmEnabled ? 1 : 0),
                onPick: (v) => { GAME_RULES.setBgmEnabled(v === 1); syncAudioSettings(); },
            },
            {
                caption: '音乐音量',
                options: VOLUME_LEVELS,
                current: () => nearestVolumeLevel(GAME_RULES.rules.bgmVolume),
                onPick: (v) => { GAME_RULES.setBgmVolume(v); syncAudioSettings(); },
            },
        ];

        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            const capY = y - H_CAPTION / 2;
            y -= H_CAPTION + GAP_CAPTION;
            const rowY = y - H_ROW / 2;
            y -= H_ROW + (i < groups.length - 1 ? GAP_ROW : 0);

            const capW = contentW - 12;
            this._label(card, g.caption, 28, TEXT_CAPTION, capW, capY, -contentW / 2 + capW / 2, true);
            this._buildOptionRow(card, g, rowY, contentW);
        }

        // ---- 分隔线 ----
        y -= GAP_DIVIDER;
        const dividerY = y - H_DIVIDER / 2;
        y -= H_DIVIDER + GAP_DIVIDER;
        const dg = card.getComponent(Graphics)!;
        dg.strokeColor = DIVIDER_LINE;
        dg.lineWidth = 1;
        dg.moveTo(-contentW / 2, dividerY);
        dg.lineTo(contentW / 2, dividerY);
        dg.stroke();

        // ---- 底部两个操作按钮 ----
        const btnY = y - H_BTN / 2;
        this._buildActionButtons(card, btnY, contentW);

        // ---- 右上角关闭 ----
        const close = createButtonNode('×', 44, 44, BTN_GHOST);
        close.parent = card;
        close.setPosition(CARD_W / 2 - 44 / 2 - 12, h / 2 - 44 / 2 - 10, 0);
        const cl = buttonLabel(close);
        if (cl) {
            cl.fontSize = 30;
            cl.color = new Color(184, 204, 188, 255);
        }
        bindSafeClick(close, () => this.onClose?.(), this);
    }

    /** 一行选项按钮: 等分内容宽度, 选中 = 金色实心 + 放大 1.06 */
    private _buildOptionRow(card: Node, spec: OptionSpec, y: number, contentW: number): void {
        const n = spec.options.length;
        const btnW = (contentW - (n - 1) * OPT_GAP) / n;
        const totalW = n * btnW + (n - 1) * OPT_GAP;
        const firstX = -totalW / 2 + btnW / 2;
        const cur = spec.current();

        for (let i = 0; i < n; i++) {
            const opt = spec.options[i];
            const selected = Math.abs(opt.value - cur) < 1e-6;
            const btn = createButtonNode(
                opt.label, btnW, H_ROW,
                selected ? BTN_SELECTED : BTN_GHOST,
                selected ? ButtonStyle.Pill : ButtonStyle.PillGhost,
            );
            btn.parent = card;
            btn.setPosition(firstX + i * (btnW + OPT_GAP), y, 0);
            const label = buttonLabel(btn);
            if (label) label.color = selected ? TEXT_INK : TEXT_TITLE;
            const op = btn.getComponent(UIOpacity) ?? btn.addComponent(UIOpacity);
            op.opacity = selected ? OPACITY_ON : OPACITY_OFF;
            if (selected) btn.setScale(new Vec3(1.06, 1.06, 1));

            // 选完立刻重建: 选中态在重建里按最新规则点亮, 不需要另写一套状态同步
            bindSafeClick(btn, () => {
                spec.onPick(opt.value);
                this._rebuild();
            }, this);
        }
    }

    /** 底部两个对局操作按钮 */
    private _buildActionButtons(card: Node, y: number, contentW: number): void {
        const btnW = Math.min(250, (contentW - BTN_GAP) / 2);
        const totalW = btnW * 2 + BTN_GAP;
        const firstX = -totalW / 2 + btnW / 2;

        const restart = createButtonNode('重新开始', btnW, H_BTN, BTN_SELECTED, ButtonStyle.Pill);
        restart.parent = card;
        restart.setPosition(firstX, y, 0);
        const rl = buttonLabel(restart);
        if (rl) rl.color = TEXT_INK;
        bindSafeClick(restart, () => this.onRestart?.(), this);

        const back = createButtonNode('返回主页面', btnW, H_BTN, BTN_BACK, ButtonStyle.Pill);
        back.parent = card;
        back.setPosition(firstX + btnW + BTN_GAP, y, 0);
        const bl = buttonLabel(back);
        if (bl) bl.color = TEXT_TITLE;
        bindSafeClick(back, () => this.onBack?.(), this);
    }

    private _label(
        parent: Node, text: string, font: number, color: Color,
        w: number, y: number, x: number, alignLeft: boolean,
    ): void {
        // 文本域宽度 = 视觉宽度 + 8: 给 Label 留一点余量,
        // 不然 SHRINK 会把标题压成两行小字(硬约束 4)
        const node = createLabelNode(text, font, color, w + 8, font + 12, alignLeft);
        node.parent = parent;
        node.setPosition(x, y, 0);
    }

    private _paintCard(g: Graphics, w: number, h: number): void {
        g.clear();
        const r = 26;
        g.fillColor = new Color(0, 0, 0, 120);
        g.roundRect(-w / 2 + 6, -h / 2 - 7, w, h, r);
        g.fill();
        g.fillColor = CARD_BG;
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.fill();
        g.strokeColor = new Color(255, 255, 255, 18);
        g.lineWidth = 6;
        g.roundRect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20, r - 6);
        g.stroke();
        g.strokeColor = CARD_BORDER;
        g.lineWidth = 3;
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.stroke();
    }
}
