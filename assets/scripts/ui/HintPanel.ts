import { _decorator, Component, Node, Color, Graphics, Label, UITransform } from 'cc';
import { createLabelNode, createButtonNode, bindSafeClick, repaintButtons } from './UIFactory';
import { Hint, HintOption, HintTone } from '../game/HintAdvisor';

const { ccclass } = _decorator;

/**
 * AI 提示面板 - 玩家点"提示"后浮在牌桌上方的一张建议卡片
 *
 * 【为什么用"卡片"而不是一行文字】
 * 提示要给出**首选 + 理由 + 次选**, 一行文字塞不下, 而且"为什么这么打"比结论更重要。
 * 沿用结算面板(SettlementPanel)的语言: 深墨绿底 + 暖金描边 + 米白字,
 * 于是提示面板与结算面板看上去是同一套软件风格, 不像临时加上去的。
 *
 * 【为什么必须自适应缩放】
 * 手机横屏时可见高度极小(21:9 只有 360px 半高), 转盘与吃/碰按钮行之间那条空带
 * 常常只剩 30~150px —— 而提示内容天然是"纵向一段文字"。写死高度必然在某些比例下
 * 压到手牌或转盘上。所以与结算面板同一套做法: 按可用高度整体缩放, 缩到最小还不够
 * 就砍掉次选(次选是"锦上添花", 首选与理由才是"必须有")。
 *
 * 【不是模态】面板没有遮罩, 玩家可以一边看建议一边继续操作牌桌;
 * 局面一变(出牌/选副露/结束)由 GameManager 清掉。
 */

// ==================== 卡片版式 ====================
/** 卡片内边距 */
const PAD_X = 28;
const PAD_Y = 16;

/** 首选操作(最大字号) */
const H_MAIN = 46;
const GAP_MAIN = 4;

/** 首选的理由 */
const H_REASON = 30;

/** 首选理由与次选区之间的分隔留白(带一条细线) */
const GAP_DIVIDER = 14;

/** 每条次选 */
const H_ALT = 26;
const GAP_ALT = 6;

/** 右上角关闭按钮 */
const CLOSE_BTN_W = 38;
const CLOSE_BTN_H = 38;

/** 整体缩放下限: 再小字就看不清了, 达不到就砍次选而不是继续缩 */
const MIN_SCALE = 0.62;

// ==================== 配色(与结算面板同源) ====================
const CARD_BG = new Color(16, 32, 27, 242);
const CARD_BORDER = new Color(214, 176, 96, 225);
const TEXT_SUB = new Color(200, 216, 198, 255);
const TEXT_MUTED = new Color(170, 184, 170, 255);
const DIVIDER_LINE = new Color(214, 176, 96, 105);
const CLOSE_COLOR = new Color(240, 236, 220, 255);

/** 语气 → 主色(见 HintAdvisor.HintTone) */
const TONE_COLORS: Record<HintTone, Color> = {
    good: new Color(150, 220, 168, 255),
    info: new Color(244, 240, 220, 255),
    warn: new Color(244, 192, 100, 255),
    bad: new Color(236, 134, 90, 255),
};

/**
 * 文本宽度估算: CJK/全角按字号, 数字/空格/中点按半角
 * 与 SettlementPanel 的同名函数一致 —— 给 Label 的文本域宽度必须够,
 * 否则 `Label.Overflow.SHRINK` 会把字压扁。
 */
function textWidth(text: string, font: number): number {
    let w = 0;
    for (const ch of text) {
        w += ch.codePointAt(0)! >= 0x2e80 ? font : font * 0.5;
    }
    return w;
}

/** 首选字号 / 理由字号 / 次选字号 */
const MAIN_FONT = 40;
const REASON_FONT = 26;
const ALT_FONT = 24;

@ccclass('HintPanel')
export class HintPanel extends Component {
    /** 点击关闭 */
    onClose: (() => void) | null = null;

    private _card: Node | null = null;
    private _hint: Hint | null = null;
    /** 当前生效的次选条数(可能被 fit 砍掉) */
    private _altCount = 0;
    /** 整体缩放(1 = 不缩) */
    private _scale = 1;
    /** 本次重建是否需要重排位置(高度变了) */
    private _needsPlace = false;

    onLoad(): void {
        this._card = new Node('Card');
        this._card.parent = this.node;
        this._card.addComponent(UITransform).setContentSize(10, 10);
        this._card.addComponent(Graphics);
        this.node.active = false;
    }

    /**
     * 按可用高度自适应: 缩放整体卡片, 缩到下限还不够就砍掉次选
     *
     * @param maxH 可用的纵向空间(内容坐标); 传 0 或负数表示不限(按原尺寸)
     * @returns true 表示高度发生了变化, 调用方需要重新定位
     */
    fit(maxH: number): boolean {
        const hint = this._hint;
        if (!hint || !hint.best) return false;
        const prevH = this.cardHeight;
        const prevAlts = this._altCount;

        // 先假设次选全留, 算所需高度; 缩放不够再一条条砍
        let alts = hint.alts.length;
        let scale = 1;
        for (;;) {
            const h = this._measureHeight(alts);
            if (maxH <= 0 || h <= maxH) { scale = 1; break; }
            scale = maxH / h;
            if (scale >= MIN_SCALE) break;
            // 缩到下限仍放不下: 砍一条次选再试
            if (alts > 0) { alts--; continue; }
            scale = MIN_SCALE;   // 连首选+理由都放不下就只能这样, 外层保证还有空间
            break;
        }
        this._scale = Math.max(MIN_SCALE, Math.min(1, scale));
        this._altCount = alts;
        if (this._altCount !== prevAlts || Math.abs(this._scale - 1) > 1e-6) this._rebuild();

        const changed = Math.abs(this.cardHeight - prevH) > 0.5;
        if (changed) this._needsPlace = true;
        return changed;
    }

    /** 显示一份提示(每次调用按最新内容重建) */
    show(hint: Hint): void {
        this._hint = hint;
        this._scale = 1;
        this._altCount = hint.alts.length;
        this._rebuild();
        this.node.active = true;
        this._needsPlace = true;
        // 原生(JSB): onLoad 期间画的 Graphics 不会上屏, 显示时补画一次
        this.scheduleOnce(() => repaintButtons(this._card), 0);
    }

    /** 隐藏面板 */
    hide(): void {
        this._hint = null;
        this.node.active = false;
        this._scale = 1;
        this._altCount = 0;
    }

    get isOpen(): boolean { return this.node.active; }

    /** 卡片当前**缩放后**的实际高度(外部定位用) */
    get cardHeight(): number {
        return this._measureHeight(this._altCount) * this._scale;
    }

    /** fit 之后高度变了, 调用方需要重新定位 */
    get needsPlace(): boolean {
        const v = this._needsPlace;
        this._needsPlace = false;
        return v;
    }

    // ==================== 排版 ====================

    /** 指定次选条数下, 未缩放的卡片高度 */
    private _measureHeight(altCount: number): number {
        const altsH = altCount > 0
            ? GAP_DIVIDER + altCount * H_ALT + (altCount - 1) * GAP_ALT
            : 0;
        return H_MAIN + GAP_MAIN + H_REASON + altsH + PAD_Y * 2;
    }

    private _rebuild(): void {
        const card = this._card;
        const hint = this._hint;
        if (!card || !hint || !hint.best) return;
        for (const child of [...card.children]) child.destroy();
        this._buildContent(card, hint);
    }

    private _buildContent(card: Node, hint: Hint): void {
        const best = hint.best!;
        const alts: HintOption[] = hint.alts.slice(0, this._altCount);

        // ---- 每段文字(宽度计算与高度计算共用同一份, 避免两处对不上) ----
        const mainText = best.label;
        const reasonText = best.reason;
        const altTexts = alts.map(a => `次选　${a.label}　${a.reason}`);

        const mainW = textWidth(mainText, MAIN_FONT) + 8;
        const reasonW = textWidth(reasonText, REASON_FONT) + 8;
        const altWs = altTexts.map(t => textWidth(t, ALT_FONT) + 8);

        // 关闭按钮占右上角 → 内容宽度要让出它的位置
        const contentW = Math.max(mainW, reasonW, ...altWs, CLOSE_BTN_W + 16);
        const cardW = contentW + PAD_X * 2;
        const cardH = this._measureHeight(this._altCount);

        card.getComponent(UITransform)?.setContentSize(cardW, cardH);
        card.setScale(this._scale, this._scale, 1);
        this._paintCard(card.getComponent(Graphics)!, cardW, cardH);

        // ---- 纵向排版: 游标 y 恒为上一段的底边, 每段先取中心再下移 ----
        let y = cardH / 2 - PAD_Y;
        const mainY = y - H_MAIN / 2;
        y -= H_MAIN + GAP_MAIN;
        const reasonY = y - H_REASON / 2;
        y -= H_REASON;
        const dividerY = y - GAP_DIVIDER / 2;
        y -= GAP_DIVIDER;
        let altTop = y;

        const tone = TONE_COLORS[hint.tone] ?? TONE_COLORS.info;
        this._label(card, mainText, MAIN_FONT, tone, mainW, mainY, -contentW / 2 + mainW / 2);
        this._label(card, reasonText, REASON_FONT, TEXT_SUB, reasonW, reasonY, -contentW / 2 + reasonW / 2);

        if (alts.length > 0) {
            const g = card.getComponent(Graphics)!;
            g.strokeColor = DIVIDER_LINE;
            g.lineWidth = 1;
            g.moveTo(-contentW / 2, dividerY);
            g.lineTo(contentW / 2, dividerY);
            g.stroke();
        }

        for (let i = 0; i < alts.length; i++) {
            const w = altWs[i];
            this._label(card, altTexts[i], ALT_FONT, TEXT_MUTED, w,
                altTop - H_ALT / 2, -contentW / 2 + w / 2);
            altTop -= H_ALT + GAP_ALT;
        }

        const close = createButtonNode('×', CLOSE_BTN_W, CLOSE_BTN_H, CLOSE_COLOR);
        close.parent = card;
        close.setPosition(cardW / 2 - CLOSE_BTN_W / 2 - 12, cardH / 2 - CLOSE_BTN_H / 2 - 10, 0);
        const label = close.getChildByName('Label')?.getComponent(Label);
        if (label) {
            label.fontSize = 28;
            label.color = new Color(180, 200, 186, 255);
        }
        bindSafeClick(close, () => this.onClose?.(), this);
    }

    private _label(
        parent: Node,
        text: string,
        font: number,
        color: Color,
        w: number,
        y: number,
        x: number,
    ): void {
        const node = createLabelNode(text, font, color, w, font + 12);
        node.parent = parent;
        node.setPosition(x, y, 0);
    }

    private _paintCard(g: Graphics, w: number, h: number): void {
        g.clear();
        const r = 24;
        // 落地投影
        g.fillColor = new Color(0, 0, 0, 120);
        g.roundRect(-w / 2 + 6, -h / 2 - 7, w, h, r);
        g.fill();
        // 面板底
        g.fillColor = CARD_BG;
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.fill();
        // 内侧柔光边
        g.strokeColor = new Color(255, 255, 255, 18);
        g.lineWidth = 6;
        g.roundRect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20, r - 6);
        g.stroke();
        // 外框
        g.strokeColor = CARD_BORDER;
        g.lineWidth = 3;
        g.roundRect(-w / 2, -h / 2, w, h, r);
        g.stroke();
    }
}
