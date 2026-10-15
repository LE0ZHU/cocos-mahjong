import { Color, Graphics, Node, Tween, UIOpacity, UITransform, Vec3, tween, v3 } from 'cc';

/**
 * 牌桌过渡动画工具
 *
 * 设计约定:
 *  - 只补间"位置 / 缩放 / 角度 / 透明度",不改动布局算出的最终值,动画结束即为布局结果;
 *  - 起止点用世界坐标进出,内部换算到牌所在容器的局部坐标,因此容器带缩放/旋转(左右家、弃牌河压扁)也准确;
 *  - 每个牌节点都是刷新时新建的,动画天然不会跨帧残留;重建容器前用 stopTweensDeep 停掉未播完的补间,
 *    避免补间继续操作已销毁的节点。
 */

/** 各类过渡的时长与幅度(秒 / 倍率),想整体调快调慢只改这里 */
export const ANIM = {
    /** 出牌: 从手牌飞进弃牌河 */
    discardFly: 0.22,
    /** 出牌落地后轻微弹一下 */
    discardPop: 0.06,
    /** 手牌理牌滑位 */
    handGlide: 0.16,
    /** 刚摸到的牌从右侧滑入 */
    drawSlide: 0.2,
    /** 副露整组聚拢入场 */
    meldGather: 0.26,
    /** 副露每张牌之间的错峰 */
    meldStagger: 0.03,
    /** 续杠补进第 4 张时的弹入 */
    kanPop: 0.22,
    /** 副露金色闪光 */
    flash: 0.34,
};

/** 递归停掉节点及其子节点上的补间(销毁节点前调用) */
export function stopTweensDeep(node: Node): void {
    Tween.stopAllByTarget(node);
    for (const child of node.children) stopTweensDeep(child);
}

/** 取节点的 UIOpacity(没有就加一个,牌节点只在做淡入时才需要) */
export function ensureOpacity(node: Node): UIOpacity {
    return node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
}

/** 世界坐标 → 容器局部坐标(容器缺 UITransform 时退回原值,不会崩) */
export function toLocal(container: Node, world: Vec3): Vec3 {
    const ui = container.getComponent(UITransform);
    return ui ? ui.convertToNodeSpaceAR(world) : world.clone();
}

/** 容器局部坐标 → 世界坐标 */
export function toWorld(container: Node, local: Vec3): Vec3 {
    const ui = container.getComponent(UITransform);
    return ui ? ui.convertToWorldSpaceAR(local) : local.clone();
}

/** 节点中心点的世界坐标 */
export function centerOf(node: Node): Vec3 {
    const ui = node.getComponent(UITransform);
    return ui ? ui.convertToWorldSpaceAR(Vec3.ZERO) : node.worldPosition.clone();
}

/**
 * 滑位: 牌从上一帧的槽位滑到当前槽位(理牌/张开手牌的过渡)
 * @param fromLocal 上一帧在同一容器内的局部坐标
 * @param delay 错峰延时(秒)
 */
export function glideTo(node: Node, fromLocal: Vec3, delay = 0, duration = ANIM.handGlide): void {
    const target = node.position.clone();
    if (Math.abs(fromLocal.x - target.x) < 0.5 && Math.abs(fromLocal.y - target.y) < 0.5) return;
    node.setPosition(fromLocal);
    const tw = delay > 0 ? tween(node).delay(delay) : tween(node);
    tw.to(duration, { position: target }, { easing: 'quadOut' }).start();
}

/**
 * 滑入: 牌从相对当前位置的偏移处滑进来(新摸到的牌从手牌右侧进场)
 * @param offset 起点相对终点的偏移(容器局部坐标)
 */
export function slideIn(
    node: Node,
    offset: Vec3,
    startOpacity = 110,
    duration = ANIM.drawSlide,
): void {
    const target = node.position.clone();
    node.setPosition(target.x + offset.x, target.y + offset.y, target.z);
    const op = ensureOpacity(node);
    op.opacity = startOpacity;
    tween(node).to(duration, { position: target }, { easing: 'quadOut' }).start();
    tween(op).to(duration * 0.7, { opacity: 255 }).start();
}

export interface FlyOptions {
    /** 起点世界坐标;为空则不位移,只做原地弹入 */
    fromWorld?: Vec3 | null;
    /** 起点缩放倍率(相对终点缩放),用于"手牌尺寸 → 牌河尺寸"的缩放过渡 */
    startScale?: number;
    /** 起点相对终点的角度偏移(度) */
    startTilt?: number;
    /** 起点不透明度 0~255 */
    startOpacity?: number;
    /** 飞行时长(秒) */
    duration?: number;
    /** 落点是否弹一下(默认弹) */
    pop?: boolean;
}

/**
 * 飞到槽位: 把一张已经摆到最终位置(容器局部坐标)的牌,改成"从 fromWorld 飞过来"的动画
 *
 * 位置、缩放、角度、透明度同时过渡,落点再轻微弹一下,读起来就是"牌从手里甩到牌河上"。
 */
export function flyToSlot(node: Node, container: Node, opts: FlyOptions = {}): void {
    const target = node.position.clone();
    const targetScale = node.scale.clone();
    const targetAngle = node.angle;
    const dur = opts.duration ?? ANIM.discardFly;

    if (opts.fromWorld) {
        const start = toLocal(container, opts.fromWorld);
        node.setPosition(start);
        node.angle = targetAngle + (opts.startTilt ?? 0);
        const op = ensureOpacity(node);
        op.opacity = opts.startOpacity ?? 120;
        tween(op).to(dur * 0.5, { opacity: 255 }).start();
        tween(node).to(dur, { position: target }, { easing: 'quadOut' }).start();
        tween(node).to(dur * 0.85, { angle: targetAngle }, { easing: 'quadOut' }).start();
    } else {
        node.angle = targetAngle + (opts.startTilt ?? 0);
        tween(node).to(dur * 0.85, { angle: targetAngle }, { easing: 'quadOut' }).start();
    }

    const s0 = opts.startScale ?? 1;
    const tw = tween(node);
    if (s0 !== 1) {
        node.setScale(targetScale.x * s0, targetScale.y * s0, 1);
        tw.to(dur * 0.85, { scale: targetScale }, { easing: 'quadOut' });
    }
    if (opts.pop !== false) {
        tw.to(ANIM.discardPop, { scale: v3(targetScale.x * 1.07, targetScale.y * 1.07, 1) })
            .to(ANIM.discardPop + 0.01, { scale: targetScale });
    }
    tw.start();
}

/**
 * 副露聚拢入场: 整组的每张牌都从 startWorld(通常是触发牌在弃牌河里的位置)方向错峰滑到自己的位置
 * @param group 已经排好最终位置的副露组节点
 * @param startWorld 起点世界坐标;为空则只在原地淡入
 */
export function gatherIn(
    group: Node,
    startWorld: Vec3 | null,
    duration = ANIM.meldGather,
    stagger = ANIM.meldStagger,
): void {
    const tiles = group.children;
    for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        const target = tile.position.clone();
        const delay = i * stagger;
        const op = ensureOpacity(tile);
        op.opacity = 120;
        tween(op).delay(delay).to(duration * 0.6, { opacity: 255 }).start();

        if (startWorld) {
            // 起点方向: 用牌自己的 UITransform 把起点换算到"牌 → 起点"的局部向量,
            // 组节点没有 UITransform 也能算;越靠后的牌起点越接近触发牌,形成聚拢感
            const ui = tile.getComponent(UITransform);
            if (ui) {
                const delta = ui.convertToNodeSpaceAR(startWorld);
                const k = Math.min(1, 0.92 + i * 0.04);
                const from = new Vec3(target.x + delta.x * k, target.y + delta.y * k, 0);
                tile.setPosition(from);
                const tw = delay > 0 ? tween(tile).delay(delay) : tween(tile);
                tw.to(duration, { position: target }, { easing: 'quadOut' }).start();
            }
        }
        // 落地前微微歪一下,避免整组平移显得生硬
        // (终点角度按各自当前值取,这样副露里的"来源小牌子"自带的回正角度不会被覆盖)
        const targetAngle = tile.angle;
        tile.angle = targetAngle - 10;
        const angTw = delay > 0 ? tween(tile).delay(delay) : tween(tile);
        angTw.to(duration * 0.9, { angle: targetAngle }, { easing: 'backOut' }).start();
    }
}

/** 续杠: 新补进来的那张牌从 0.4 倍弹到原大小(整组其他牌位置不变,所以看起来只是"多了一张") */
export function popIn(node: Node, duration = ANIM.kanPop): void {
    const target = node.scale.clone();
    node.setScale(target.x * 0.4, target.y * 0.4, 1);
    tween(node)
        .to(duration * 0.7, { scale: v3(target.x * 1.12, target.y * 1.12, 1) }, { easing: 'quadOut' })
        .to(duration * 0.3, { scale: target })
        .start();
}

/** 金色闪光: 在父容器 (x,y) 处画一块会放大淡出的光晕,用于强调"这里刚吃/碰/杠了" */
export function flashBurst(
    parent: Node,
    x: number,
    y: number,
    w: number,
    h: number,
    duration = ANIM.flash,
): void {
    const node = new Node('MeldFlash');
    node.parent = parent;
    node.setPosition(x, y, 0);
    node.setSiblingIndex(0);
    node.addComponent(UITransform).setContentSize(w, h);
    const g = node.addComponent(Graphics);
    const r = Math.max(3, Math.min(w, h) * 0.2);
    g.fillColor = new Color(255, 214, 120, 255);
    g.roundRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8, r + 2);
    g.fill();
    const op = node.addComponent(UIOpacity);
    op.opacity = 0;
    node.setScale(0.88, 0.88, 1);
    tween(op).to(0.05, { opacity: 190 }).to(duration, { opacity: 0 }, { easing: 'quadIn' }).start();
    tween(node)
        .to(duration + 0.05, { scale: v3(1.16, 1.16, 1) }, { easing: 'quadOut' })
        .call(() => node.destroy())
        .start();
}
