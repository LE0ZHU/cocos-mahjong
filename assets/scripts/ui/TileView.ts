import { _decorator, Component, Label, Node, Color, Graphics, Sprite, UITransform, EventTouch, Tween, Vec3, v3 } from 'cc';
import { Tile } from '../core/Tile';
import { TileSuit, SUIT_TEXT_COLORS, JIAN_TEXT_COLORS, CN_NUMERALS, SUIT_CHARS } from '../core/TileDefine';
import { drawTilePattern } from './UIFactory';
import { getTileSpriteFrame } from './TileImage';
import { ensureOpacity, glideTo } from './Anim';

const { ccclass } = _decorator;

/** 选中态文字色(深红,与各花色文字色形成区分) */
const SELECTED_COLOR = new Color(205, 30, 30, 255);
/** 万子数字色(黑) */
const WAN_NUM_COLOR = new Color(40, 40, 40, 255);
/** 万子"萬"字色(红) */
const WAN_CHAR_COLOR = new Color(196, 36, 36, 255);
/** 选中/按下时牌上抬的高度(容器局部坐标) */
const SELECTED_LIFT = 30;
/**
 * 被 AI 提示"建议打出"时牌上抬的高度
 *
 * 比选中略低: 提示是"建议", 玩家完全可能改主意; 选中是"我就要打这张了"。
 * 两者同高会让人分不清哪个是系统说的、哪个是自己点的。
 */
const HINTED_LIFT = 22;

// ---- 拖牌手势参数 ----
/** 手指移动超过这个距离(UI 像素)才算拖牌,低于它按"点一下"处理 */
const DRAG_START_DIST = 10;
/** 牌被拖到手牌行上方这个高度(容器局部坐标)即视为"甩出去",松手就出牌 */
const DRAG_OUT_Y = 46;
/** 拖动时放大倍率 / 甩出手牌区后的放大倍率 */
const DRAG_SCALE = 1.08;
const DRAG_OUT_SCALE = 1.14;
/** 拖回手牌区松手后的回弹时间 */
const SNAP_BACK_TIME = 0.18;

/**
 * 单张牌的视图组件
 * 挂在通过 UIFactory.createTileNode 创建的节点上
 *
 * 职责:
 *  - 按花色切换显示方式:
 *      筒子/条子 → Pattern 层绘制图案(圆圈/竹条)
 *      万子      → 双Label显示(上数字黑 + 下"萬"红,系统字体)
 *      字牌      → Label 单字大号显示
 *  - 手牌的三种操作手势(只有挂过 setOnClick 的手牌参与):
 *      点一下未选中的牌 → 选中(上移突出)
 *      再点同一张       → 出牌
 *      按住往上拖/甩    → 牌跟着手指走;离开手牌区松手即出牌,拖回手牌区松手则回弹不出牌
 *  - 选中高亮(牌上移 + 文字/图案变红)
 */
@ccclass('TileView')
export class TileView extends Component {
    private _tile: Tile | null = null;
    private _index: number = -1;
    private _selected = false;
    private _label: Label | null = null;       // 字牌文字
    private _labelWan: Label | null = null;    // 万子"萬"字
    private _pattern: Graphics | null = null;  // 矢量图案层(筒子/条子)
    private _face: Sprite | null = null;       // 真实牌面图片
    private _bg: Node | null = null;           // 程序化牌身(仅图片缺失时兜底显示)
    private _imageMode = false;                // 是否使用图片牌面
    private _mark: Node | null = null;         // 刚摸到的牌高亮标注
    private _hintMark: Node | null = null;     // AI 建议打出的牌高亮标注
    private _hinted = false;                   // 是否处于"AI 建议打出"状态(影响静止位置)
    private _dangerMark: Node | null = null;   // 危险牌角标(打出去可能点炮)
    /** 当前危险档位(0=无 / 1=留意 / 2=危险); 隐藏过再显示时要按它补画 */
    private _dangerLevel = 0;
    private _onClick: ((index: number) => void) | null = null;
    /** 拖牌出牌回调: 返回 true 表示确实打出去了(手牌会被整体重建) */
    private _onDiscard: ((index: number) => boolean) | null = null;
    /** 显示子节点引用是否已缓存 */
    private _refsReady = false;

    // ---- 手势状态 ----
    /** 手牌槽位(容器局部坐标,由 Main 在创建手牌时写入),拖牌回弹的落点 */
    private _slotPos: Vec3 | null = null;
    /** 本次触摸是否已被按下 */
    private _pressed = false;
    /** 是否已经超过阈值进入拖牌状态 */
    private _dragging = false;
    /** 拖牌时是否已经甩出手牌区(松手即出牌) */
    private _dragReady = false;
    /** 按下时的 UI 坐标、"手指-牌"偏移,以及按下时的 y(判断往上拖了多远) */
    private _touchBegin = new Vec3();
    private _grabOffset = new Vec3();
    private _pressY = 0;
    /** 甩牌提示光晕 */
    private _dragGlow: Node | null = null;

    onLoad(): void {
        this._ensureRefs();
        const T = Node.EventType;
        this.node.on(T.TOUCH_START, this._onTouchStart, this);
        this.node.on(T.TOUCH_MOVE, this._onTouchMove, this);
        this.node.on(T.TOUCH_END, this._onTouchEnd, this);
        this.node.on(T.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    /**
     * 节点激活时补应用一次显示。
     * setData 可能在节点入场景树之前被调用(亮牌时先建牌、后挂到容器上),
     * 那一刻 onLoad 尚未执行、_face 还是空,会被误判成"没有图片"而回退为矢量绘制;
     * 激活后重新应用,保证始终使用 tiles(即 majiang_paimian)里的真实牌面图片。
     */
    onEnable(): void {
        this._ensureRefs();
        if (this._tile) this._applyDisplay();
        // 原生平台上"隐藏过再显示"的 Graphics 顶点是回不来的(不只 onLoad) ——
        // 手牌整体重建 + 结算面板重建都会走到这里, 必须按记录的水平补画一次
        this._paintDanger();
    }

    /**
     * 缓存牌身各显示子节点。
     * 只依赖节点自身的子节点树,与"是否已激活"无关,因此早于 onLoad 调用也安全。
     */
    private _ensureRefs(): void {
        if (this._refsReady) return;
        this._refsReady = true;
        this._label = this.node.getChildByName('Label')?.getComponent(Label) ?? null;
        this._labelWan = this.node.getChildByName('LabelWan')?.getComponent(Label) ?? null;
        this._pattern = this.node.getChildByName('Pattern')?.getComponent(Graphics) ?? null;
        this._face = this.node.getChildByName('Face')?.getComponent(Sprite) ?? null;
        this._bg = this.node.getChildByName('Bg') ?? null;
    }

    onDestroy(): void {
        const T = Node.EventType;
        this.node.off(T.TOUCH_START, this._onTouchStart, this);
        this.node.off(T.TOUCH_MOVE, this._onTouchMove, this);
        this.node.off(T.TOUCH_END, this._onTouchEnd, this);
        this.node.off(T.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    /** 设置牌数据和索引 */
    setData(tile: Tile, index: number): void {
        this._tile = tile;
        this._index = index;
        this._applyDisplay();
    }

    /**
     * 这张牌的 id(未 setData 时为 -1)
     *
     * 发牌动画要按"本轮新增的是哪张牌"找到对应节点, 而 AI 手牌节点没有固定命名,
     * 只能靠牌 id 反查 —— 这个 getter 就是为此存在(不要改成 setter)。
     */
    get tileId(): number {
        return this._tile ? this._tile.id : -1;
    }

    /** 设置点击回调(同时代表"这张牌参与点选/拖牌手势") */
    setOnClick(callback: (index: number) => void): void {
        this._onClick = callback;
    }

    /** 设置拖牌出牌回调: 返回 true = 已经打出去(手牌会被重建,本组件不要再动节点) */
    setOnDiscard(callback: (index: number) => boolean): void {
        this._onDiscard = callback;
    }

    /** 记录手牌槽位: 拖回时回弹到这个位置(容器局部坐标) */
    setHomePos(pos: Vec3): void {
        this._slotPos = pos.clone();
    }

    /** 选中/取消选中: 牌上移 + 文字/图案变色 */
    setSelected(selected: boolean): void {
        this._selected = selected;
        // 理牌过渡的位移动画可能还在播: 先停掉,否则它会把选中上移的 y 拉回 0
        Tween.stopAllByTarget(this.node);
        this._applyRestPos();
        if (!this._tile) return;
        // 图片牌面: 选中仅上移,不改变文字颜色
        if (this._imageMode) return;
        this._ensureRefs();
        if (this._tile.suit === TileSuit.WAN) {
            // 万子用Label,选中更新文字颜色
            if (this._label) {
                this._label.color = selected ? SELECTED_COLOR : WAN_NUM_COLOR;
            }
            if (this._labelWan) {
                this._labelWan.color = selected ? SELECTED_COLOR : WAN_CHAR_COLOR;
            }
        } else {
            this._applyLabelColor();
        }
    }

    get isSelected(): boolean { return this._selected; }

    /** 标记/取消"刚摸到"的金色高亮框(仅显示,不参与点击) */
    setDrawn(drawn: boolean): void {
        if (drawn && !this._mark) {
            const tileT = this.node.getComponent(UITransform);
            const w = tileT ? tileT.width : 64;
            const h = tileT ? tileT.height : 87;
            const mark = new Node('DrawnMark');
            mark.parent = this.node;
            // 与牌身同尺寸同锚点;插到最前面保证作为底层光晕绘制在牌身之下
            mark.addComponent(UITransform).setContentSize(w, h);
            drawDrawnMark(mark.addComponent(Graphics), w, h);
            mark.setSiblingIndex(0);
            this._mark = mark;
        }
        if (this._mark) this._mark.active = drawn;
    }

    /**
     * 标记/取消"AI 建议打出这张牌"的提示框
     *
     * 与"刚摸到"的金色框刻意区分开: 提示框用**青蓝色**且没有柔光底,
     * 只画外侧一圈亮边 —— 因为"刚摸到的牌"经常同时就是"建议打出的牌",
     * 两个金色框叠在一起会分不清谁是谁。
     */
    setHinted(hinted: boolean): void {
        if (hinted && !this._hintMark) {
            const tileT = this.node.getComponent(UITransform);
            const w = tileT ? tileT.width : 64;
            const h = tileT ? tileT.height : 87;
            const mark = new Node('HintMark');
            mark.parent = this.node;
            mark.addComponent(UITransform).setContentSize(w, h);
            drawHintMark(mark.addComponent(Graphics), w, h);
            // 画在牌身**之上**: 提示框只勾外沿, 盖住一点牌边不影响读面
            mark.setSiblingIndex(this.node.children.length - 1);
            this._hintMark = mark;
        }
        if (this._hintMark) this._hintMark.active = hinted;
        this._hinted = hinted;
        // 提示态也要把牌抬起来(比选中抬得略低, 见 HINTED_LIFT)
        Tween.stopAllByTarget(this.node);
        this._applyRestPos();
    }

    /**
     * 标记"打出去有被点炮的风险"(0=不标 / 1=留意 / 2=危险)
     *
     * 【为什么是角标, 不是第三个整圈框】牌上已经有两套"整圈"语言了:
     * 金色柔光框 = 刚摸到, 青蓝双框 = 建议打出。而"建议打出的那张"经常同时就是
     * 危险牌 —— 再叠一个整圈必然撞在一起、分不清是哪条信息。所以危险改用
     * **右上角的实心圆点**: 位置固定、不占牌面中心、与两种框都能共存。
     *
     * 【为什么要深色外圈 + 白色高光】牌面是浅色, 但右上角可能正压着红色图案
     * (红中 / 一筒 / 九筒), 纯红色块会糊成一片。深色外圈保证任何底色上都看得见。
     *
     * 档位阈值不在这里判(见 `HintAdvisor.dangerLevel`): 角标与提示文案必须同一条线。
     */
    setDanger(level: number): void {
        const lv: number = level >= 2 ? 2 : (level >= 1 ? 1 : 0);
        this._dangerLevel = lv;
        if (lv > 0 && !this._dangerMark) {
            const t = this.node.getComponent(UITransform);
            const mark = new Node('DangerMark');
            mark.parent = this.node;
            mark.addComponent(UITransform)
                .setContentSize(t ? t.width : 64, t ? t.height : 87);
            this._dangerMark = mark;
        }
        // 先切 active 再画: 画在隐藏节点上的 Graphics 在原生平台会被丢掉
        if (this._dangerMark) this._dangerMark.active = lv > 0;
        this._paintDanger();
    }

    /** 按当前档位重画危险角标(节点未创建 / 档位为 0 时直接跳过) */
    private _paintDanger(): void {
        const mark = this._dangerMark;
        if (!mark || this._dangerLevel <= 0 || !mark.active) return;
        const t = this.node.getComponent(UITransform);
        const w = t ? t.width : 64;
        const h = t ? t.height : 87;
        const g = mark.getComponent(Graphics) ?? mark.addComponent(Graphics);
        // 角标永远画在最上层: 牌面 / 刚摸到金框 / 提示框 都在它下面
        mark.setSiblingIndex(this.node.children.length - 1);
        drawDangerDot(g, w, h, this._dangerLevel);
    }

    /** 按花色应用显示: 优先使用真实牌面图片,缺失时回退矢量绘制 */
    private _applyDisplay(): void {
        if (!this._tile) return;
        this._ensureRefs();
        const tile = this._tile;
        const labelNode = this._label ? this._label.node : null;
        const labelWanNode = this._labelWan ? this._labelWan.node : null;
        const patternNode = this._pattern ? this._pattern.node : null;
        const isPatternSuit = tile.suit === TileSuit.TONG || tile.suit === TileSuit.TIAO;

        // ---- 牌面图片层: 有图片时完全按素材显示,并隐藏程序化牌身与文字 ----
        const sf = getTileSpriteFrame(tile);
        this._imageMode = !!sf && !!this._face;
        if (this._imageMode) {
            if (this._face) {
                this._face.spriteFrame = sf;
                this._face.node.active = true;
            }
            // 素材图自带圆角透明边(tools/make-tile-faces.py 裁好), 程序化牌身必须让位:
            // 否则四角会露出牌身的白底, 看起来像"给素材加了白边框"
            if (this._bg) this._bg.active = false;
            if (patternNode) patternNode.active = false;
            if (labelNode) labelNode.active = false;
            if (labelWanNode) labelWanNode.active = false;
            return;
        }
        // 无图片: 隐藏图片层, 恢复牌身, 回退到原有矢量/文字绘制
        if (this._bg) this._bg.active = true;
        if (this._face) this._face.node.active = false;

        // ---- 图案层(筒子/条子) ----
        if (patternNode) {
            if (isPatternSuit) {
                patternNode.active = true;
                const pg = patternNode.getComponent(Graphics);
                const pt = patternNode.getComponent(UITransform);
                if (pg && pt) {
                    drawTilePattern(pg, tile, pt.width, pt.height, this._selected);
                }
            } else {
                patternNode.active = false;
            }
        }

        // ---- 万子: 上数字(黑) + 下"萬"(红),使用系统字体 ----
        if (tile.suit === TileSuit.WAN) {
            if (labelNode) {
                labelNode.active = true;
                const label = labelNode.getComponent(Label);
                const pt = labelNode.getComponent(UITransform);
                const w = pt ? pt.width : 64;
                const h = pt ? pt.height : 64;
                if (label) {
                    label.string = CN_NUMERALS[tile.rank - 1];
                    label.fontSize = Math.round(w * 0.42);
                    label.lineHeight = Math.round(w * 0.5);
                    label.color = this._selected ? SELECTED_COLOR : WAN_NUM_COLOR;
                    labelNode.setPosition(0, h * 0.22, 0);
                }
            }
            if (labelWanNode) {
                labelWanNode.active = true;
                const labelWan = labelWanNode.getComponent(Label);
                const pt = labelWanNode.getComponent(UITransform);
                const w = pt ? pt.width : 64;
                const h = pt ? pt.height : 64;
                if (labelWan) {
                    labelWan.string = SUIT_CHARS[TileSuit.WAN];
                    labelWan.fontSize = Math.round(w * 0.42);
                    labelWan.lineHeight = Math.round(w * 0.5);
                    labelWan.color = this._selected ? SELECTED_COLOR : WAN_CHAR_COLOR;
                    labelWanNode.setPosition(0, -h * 0.22, 0);
                }
            }
            return;
        }

        // ---- 筒子/条子: 隐藏文字层 ----
        if (isPatternSuit) {
            if (labelNode) labelNode.active = false;
            if (labelWanNode) labelWanNode.active = false;
            return;
        }

        // ---- 字牌: 单字大号 ----
        if (labelWanNode) labelWanNode.active = false;
        if (labelNode) {
            labelNode.active = true;
            const label = labelNode.getComponent(Label);
            const pt = labelNode.getComponent(UITransform);
            const w = pt ? pt.width : 64;
            if (label) {
                label.string = tile.displayText;
                label.fontSize = Math.round(w * 0.6);
                label.lineHeight = Math.round(w * 0.7);
                labelNode.setPosition(0, 0, 0);
            }
        }
        this._applyLabelColor();
    }

    /** 应用当前选中态的颜色(字牌Label;万子由setSelected单独处理) */
    private _applyLabelColor(): void {
        if (!this._tile || !this._label) return;
        this._label.color = this._selected
            ? SELECTED_COLOR
            : getTileTextColor(this._tile);
    }

    // ==================== 点选 / 拖牌手势 ====================

    /**
     * 按下:
     *  - 先阻止冒泡(避免触发"点其他区域取消选牌")并把牌抬起来,给出按下反馈;
     *  - 但"选中/出牌"的判定推迟到松手 —— 否则按下一张已选中的牌会立刻打出去,
     *    就没法把它按住拖回来了。
     */
    private _onTouchStart(event: EventTouch): void {
        if (!this._onClick || this._index < 0) return;
        event.propagationStopped = true;
        // 理牌过渡可能还在播: 停掉再接管位置
        Tween.stopAllByTarget(this.node);
        this._ensureRefs();
        const ui = event.getUILocation();
        this._touchBegin.set(ui.x, ui.y, 0);
        this._pressed = true;
        this._dragging = false;
        this._dragReady = false;
        this._applyRestPos();
        this._pressY = this.node.position.y;
    }

    /** 移动: 超过阈值后进入拖牌,牌跟着手指走,并按是否离开手牌区切换"松手即出牌"提示 */
    private _onTouchMove(event: EventTouch): void {
        if (!this._pressed) return;
        const ui = event.getUILocation();
        if (!this._dragging) {
            const dx = ui.x - this._touchBegin.x;
            const dy = ui.y - this._touchBegin.y;
            if (Math.sqrt(dx * dx + dy * dy) < DRAG_START_DIST) return;   // 还在"点一下"的范围内
            this._beginDrag(ui);
        }
        this._followTouch(ui);
    }

    /** 松手: 没拖动=点击(交给 Main 判选中/出牌);拖动过=按位置决定出牌或回弹 */
    private _onTouchEnd(): void {
        if (!this._pressed) return;
        const moved = this._dragging;
        const out = this._dragReady;
        this._pressed = false;
        this._dragging = false;
        if (!moved) {
            this._dragReady = false;
            this._applyRestPos();
            this._onClick?.(this._index);
            return;
        }
        // 甩出手牌区松手 → 出牌;Main 返回 true 表示手牌会整体重建,不用再管节点
        if (out && this._onDiscard?.(this._index)) return;
        this._snapBack();
    }

    /** 触摸被系统打断(来电/切后台等): 回弹,不触发点选 */
    private _onTouchCancel(): void {
        if (!this._pressed) return;
        const moved = this._dragging;
        this._pressed = false;
        this._dragging = false;
        if (moved) this._snapBack();
        else {
            this._dragReady = false;
            this._applyRestPos();
        }
    }

    /** 进入拖牌: 记住手指与牌的相对位置、抬到最上层并放大一点 */
    private _beginDrag(ui: { x: number; y: number }): void {
        this._dragging = true;
        const local = this._toParentLocal(ui);
        const pos = this.node.position;
        this._grabOffset.set(pos.x - local.x, pos.y - local.y, 0);
        const parent = this.node.parent;
        if (parent) this.node.setSiblingIndex(parent.children.length - 1);
        this.node.setScale(DRAG_SCALE, DRAG_SCALE, 1);
        ensureOpacity(this.node).opacity = 255;
    }

    /** 拖动中: 位置跟随手指(保持按下时的抓点),并按是否甩出手牌区切换提示 */
    private _followTouch(ui: { x: number; y: number }): void {
        const local = this._toParentLocal(ui);
        const x = local.x + this._grabOffset.x;
        const y = local.y + this._grabOffset.y;
        this.node.setPosition(x, y, 0);

        // 相对按下点往上拖到阈值以上 = 甩出去(松手即出牌);拖回来又低于阈值就恢复
        const out = (y - this._pressY) >= DRAG_OUT_Y;
        if (out !== this._dragReady) {
            this._dragReady = out;
            const s = out ? DRAG_OUT_SCALE : DRAG_SCALE;
            this.node.setScale(s, s, 1);
            // 甩出去时按横向偏移歪一点,像真的在甩牌
            this.node.angle = out ? clamp((x - this._slotX()) * 0.08, -10, 10) : 0;
            this._showGlow(out);
        }
    }

    /** 回弹到槽位(带过渡),清掉拖动期间的放大/倾斜/光晕 */
    private _snapBack(): void {
        this._dragReady = false;
        this._resetDragVisual();
        const from = this.node.position.clone();
        this._applyRestPos();
        glideTo(this.node, from, 0, SNAP_BACK_TIME);
    }

    /** 恢复拖动前的外观 */
    private _resetDragVisual(): void {
        this.node.setScale(1, 1, 1);
        this.node.angle = 0;
        this._showGlow(false);
    }

    /** 甩牌提示光晕(金色描边),第一次用的时候才创建 */
    private _showGlow(on: boolean): void {
        if (on && !this._dragGlow) {
            const t = this.node.getComponent(UITransform);
            const w = t ? t.width : 64;
            const h = t ? t.height : 87;
            const glow = new Node('DragGlow');
            glow.parent = this.node;
            glow.addComponent(UITransform).setContentSize(w, h);
            drawDragGlow(glow.addComponent(Graphics), w, h);
            glow.setSiblingIndex(0);   // 作为底层光晕,画在牌身之下
            this._dragGlow = glow;
        }
        if (this._dragGlow) this._dragGlow.active = on;
    }

    /** 手牌槽位的 x(没有槽位信息时退回当前 x) */
    private _slotX(): number {
        return this._slotPos ? this._slotPos.x : this.node.position.x;
    }

    /** 静止时应处的位置: 选中/按下则上抬, 提示态也上抬但略低 */
    private _applyRestPos(): void {
        const x = this._slotX();
        let y = 0;
        if (this._selected || this._pressed) y = SELECTED_LIFT;
        else if (this._hinted) y = HINTED_LIFT;
        this.node.setPosition(x, y, 0);
    }

    /** UI 坐标 → 父节点局部坐标(手牌容器的缩放/旋转都会被正确抵消) */
    private _toParentLocal(ui: { x: number; y: number }): Vec3 {
        const parent = this.node.parent;
        const t = parent?.getComponent(UITransform);
        return t ? t.convertToNodeSpaceAR(v3(ui.x, ui.y, 0)) : v3(ui.x, ui.y, 0);
    }
}

/**
 * 牌面圆角比例 —— **必须与 `tools/make-tile-faces.py` 的 `RADIUS_RATIO` 相同**。
 *
 * 牌面是素材图 1:1 铺满整张牌, 牌的实际圆角就是"短边 × 12%"(那圈圆角是裁剪在
 * 图片里的; 素材 75×100 → 9px, 手牌 63 宽时约 7.6px)。所以任何"沿着牌边画"的
 * 东西(高光框 / 提示框 / 拖牌光晕)都必须用同一个比例, 否则角上的弧与牌边不同心:
 * 弧线会在角的两侧"肩部"离牌边而去, 露出一道桌布色的缝隙 ——
 * 看起来就是"金框和牌边不契合"。
 */
const TILE_RADIUS_RATIO = 0.12;

/** 牌的实际圆角半径(与牌面素材的裁剪半径同一比例, 不要另取一套数字) */
export function tileRadius(w: number, h: number): number {
    return Math.min(w, h) * TILE_RADIUS_RATIO;
}

/**
 * 绘制"刚摸到"的牌的高亮标注:
 * 金色柔光底 + 外层发光描边 + 主体亮金描边,全部与牌身同心
 * (牌身已是平面牌面,这里若向下延伸会看着像立体底座,故四周对称外扩)
 *
 * 【描边为什么整个画在牌边之外】标注节点是牌的第一个子节点(画在牌身**之下**),
 * 若路径正好压在牌边上, 内侧半个线宽会被不透明的牌面盖掉 —— 直边上只剩一条
 * 1.5px 的细线, 而角上因为圆角不同心还会被吃掉更多, 于是框看起来"断开、有缝"。
 * 现在路径按线宽的一半外扩(亮金 +1 / 柔光 +2.5), 描边落在牌边 -0.5 ~ +5.5,
 * 内侧那 0.5 藏在牌下 → 描边看起来正好从牌边起笔, 一圈严丝合缝。
 */
function drawDrawnMark(g: Graphics, w: number, h: number): void {
    const r = tileRadius(w, h);
    // 金色柔光底(四周各外扩 5,与牌身同心)
    g.fillColor = new Color(255, 206, 96, 46);
    g.roundRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10, r + 5);
    g.fill();
    // 外层柔光描边: 路径外扩 2.5 / 线宽 6 → 落在牌边 -0.5 ~ +5.5
    g.strokeColor = new Color(255, 208, 110, 120);
    g.lineWidth = 6;
    g.roundRect(-w / 2 - 2.5, -h / 2 - 2.5, w + 5, h + 5, r + 2.5);
    g.stroke();
    // 主体亮金描边: 路径外扩 1 / 线宽 3 → 落在牌边 -0.5 ~ +2.5
    g.strokeColor = new Color(255, 232, 150, 255);
    g.lineWidth = 3;
    g.roundRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, r + 1);
    g.stroke();
}

/**
 * 绘制"AI 建议打出"的提示框: 青蓝色双层描边, 只勾在牌身外沿
 *
 * 刻意**不画柔光底**, 也**不用金色**:
 *  - 金色柔光底已经是"刚摸到这张牌"的语言, 两者叠加就分不清了;
 *  - 建议牌往往正是刚摸到的那张, 两个标记同时出现是常态。
 * 青蓝是牌桌上没有的第三种信号色, 一眼能区分"系统说的"与"我刚摸的"。
 *
 * 圆角与描边位置和 `drawDrawnMark` 同一套(tileRadius + 线宽一半的外扩):
 * 只是这个框画在牌身**之上**, 内侧 0.5 不会被牌面盖住, 直接压在牌边那半像素上。
 */
function drawHintMark(g: Graphics, w: number, h: number): void {
    const r = tileRadius(w, h);
    // 外层柔光(青蓝)
    g.strokeColor = new Color(110, 226, 224, 120);
    g.lineWidth = 6;
    g.roundRect(-w / 2 - 2.5, -h / 2 - 2.5, w + 5, h + 5, r + 2.5);
    g.stroke();
    // 主体亮边
    g.strokeColor = new Color(178, 244, 240, 255);
    g.lineWidth = 3;
    g.roundRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, r + 1);
    g.stroke();
}

/**
 * 绘制危险牌角标: 右上角一颗实心圆点(1=黄 / 2=红), 外圈深色 + 中心高光
 *
 * 圆心与半径都按**短边**取比例, 于是手牌(91×122)、副露牌(52×70)与结算面板的
 * 小牌(36×48)上是同一个观感 —— 不必为每种尺寸各调一套数字。
 * 位置贴右上角内缩 17%, 避开牌面中心的图案/数字。
 */
function drawDangerDot(g: Graphics, w: number, h: number, level: number): void {
    g.clear();
    const short = Math.min(w, h);
    const inset = short * 0.17;
    const cx = w / 2 - inset;
    const cy = h / 2 - inset;
    const r = level >= 2 ? short * 0.105 : short * 0.075;
    // 外圈深色描边: 牌面浅色, 但右上角可能压着红色图案(红中/一筒/九筒), 纯色块会糊
    g.fillColor = new Color(26, 24, 20, 155);
    g.circle(cx, cy, r + Math.max(1.6, short * 0.026));
    g.fill();
    // 主体
    // 留意档刻意偏黄而不是偏橙: 手牌上只有 91px 宽, 橙红两色在牌面的米白底上
    // 远看几乎是一个颜色, 只有"黄 vs 红"才一眼分得开档位
    g.fillColor = level >= 2 ? new Color(226, 75, 74, 255) : new Color(250, 194, 62, 255);
    g.circle(cx, cy, r);
    g.fill();
    // 左上偏一点的白高光, 让圆点看起来是"珠子"而不是贴上去的色块
    g.fillColor = new Color(255, 255, 255, 205);
    g.circle(cx - r * 0.3, cy + r * 0.3, r * 0.33);
    g.fill();
}

/**
 * 绘制拖牌时的"甩出去"提示光晕: 牌身外围一圈金色描边
 * (与 drawDrawnMark 的区别: 这里只画描边、不做柔光底,因为牌是悬空被拖着的;
 *  光圈比"刚摸到"再宽一点, 牌被抬起来之后才够显眼)
 */
function drawDragGlow(g: Graphics, w: number, h: number): void {
    const r = tileRadius(w, h);
    // 外层柔光: 路径外扩 3 / 线宽 7 → 落在牌边 -0.5 ~ +6.5
    g.strokeColor = new Color(255, 214, 120, 110);
    g.lineWidth = 7;
    g.roundRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, r + 3);
    g.stroke();
    // 主体亮金描边: 路径外扩 1 / 线宽 3 → 落在牌边 -0.5 ~ +2.5
    g.strokeColor = new Color(255, 236, 168, 255);
    g.lineWidth = 3;
    g.roundRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, r + 1);
    g.stroke();
}

/** 夹取到 [min, max] */
function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

/** 按花色/点数获取牌面文字颜色 */
function getTileTextColor(tile: Tile): Color {
    if (tile.suit === TileSuit.JIAN) {
        const [r, g, b] = JIAN_TEXT_COLORS[tile.rank - 1] ?? [40, 40, 40];
        return new Color(r, g, b, 255);
    }
    const [r, g, b] = SUIT_TEXT_COLORS[tile.suit] ?? [40, 40, 40];
    return new Color(r, g, b, 255);
}
