"""
AI 提示面板 + 提示按钮 预览(从真实源码镜像常量)

改 HintPanel / Main 的提示相关版式后跑这个出图确认:
  1) 提示面板**不压中央转盘/倒计时**, 也不压手牌(两条硬要求)
  2) 超宽屏下会自动缩放, 文字仍然可读
  3) 提示按钮与"听牌"按钮、手牌、右侧"听"标记的横向关系

【为什么必须镜像而不是手抄】手抄一份会与实现漂移, 于是"脚本说没问题、真机却撞车"。
所以这里的常量全部由 parse_consts() 从 assets/scripts 里正则提取, 改一处两边同步。

用法: python tools/preview-hint.py
输出: hint-preview.png (左=16:9, 右=21:9) + hint-preview-wide.png (超宽)
"""
import math
import os
import re

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ===== 中文字体 =====
# PIL 自带的默认位图字体没有 CJK 字形, 直接画会得到一堆"豆腐块"(截图里满屏方框),
# 预览就白做了。这里按优先级找一个系统字体, 找不到就退化为默认字体(会有方框, 但不崩)。
_FONT_CANDIDATES = [
    'C:/Windows/Fonts/msyh.ttc',    # 微软雅黑
    'C:/Windows/Fonts/Deng.ttf',    # 等线
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/SimSun.ttf',
]
_FONT_PATH = next((p for p in _FONT_CANDIDATES if os.path.exists(p)), None)


def font(size):
    """按像素高度取中文字体; 取不到就返回 None(调用方回退到默认字体)"""
    if not _FONT_PATH:
        return None
    try:
        return ImageFont.truetype(_FONT_PATH, int(round(size)))
    except Exception:
        return None


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


MAIN = read('assets/scripts/Main.ts')
PANEL = read('assets/scripts/ui/HintPanel.ts')


def parse_consts(src):
    """提取 const X = n 与 private readonly X = n 两种写法"""
    out = {}
    for name in re.findall(r'const\s+([A-Z_][A-Z0-9_]*)\s*(?::[^=]*)?=\s*(-?[\d.]+)', src):
        out[name] = float(name[1])
    for name in re.findall(r'readonly\s+([A-Z_][A-Z0-9_]*)\s*(?::[^=]*)?=\s*(-?[\d.]+)', src):
        out[name] = float(name[1])
    return out


def const(src, name):
    m = re.search(r'const\s+%s\s*(?::[^=]*)?=\s*(-?[\d.]+)' % name, src)
    if not m:
        m = re.search(r'readonly\s+%s\s*(?::[^=]*)?=\s*(-?[\d.]+)' % name, src)
    if not m:
        raise KeyError('找不到常量 ' + name)
    return float(m.group(1))


M = parse_consts(MAIN)
P = parse_consts(PANEL)

CONTENT_W = const(MAIN, 'CONTENT_W')
TILE_W = const(MAIN, 'TILE_W')
TILE_H = const(MAIN, 'TILE_H')
TOP_TILE_W = const(MAIN, 'TOP_TILE_W')
RIVER_TILE_W = const(MAIN, 'RIVER_TILE_W')
MELD_MARK_GAP = const(MAIN, 'MELD_MARK_GAP')
MELD_BTN_H = const(MAIN, 'MELD_BTN_H')
HINT_BTN_W = const(MAIN, 'HINT_BTN_W')
HINT_BTN_H = const(MAIN, 'HINT_BTN_H')
HINT_BTN_GAP = const(MAIN, 'HINT_BTN_GAP')
HINT_PANEL_GAP = const(MAIN, 'HINT_PANEL_GAP')
HINT_BREATH = const(MAIN, 'HINT_BREATH')
DISC_R_MIN = const(MAIN, 'TURN_DISC_R_MIN')
DISC_R_MAX = const(MAIN, 'TURN_DISC_R_MAX')

PAD_X = const(PANEL, 'PAD_X')
PAD_Y = const(PANEL, 'PAD_Y')
H_MAIN = const(PANEL, 'H_MAIN')
GAP_MAIN = const(PANEL, 'GAP_MAIN')
H_REASON = const(PANEL, 'H_REASON')
GAP_DIVIDER = const(PANEL, 'GAP_DIVIDER')
H_ALT = const(PANEL, 'H_ALT')
GAP_ALT = const(PANEL, 'GAP_ALT')
CLOSE_W = const(PANEL, 'CLOSE_BTN_W')

TILE_RATIO = TILE_H / TILE_W


def tile_h(w):
    return w * TILE_RATIO


def text_width(text, font):
    """CJK 按字号, 其余半角 —— 与 HintPanel.textWidth 一致"""
    w = 0
    for ch in text:
        w += font if ord(ch) >= 0x2E80 else font * 0.5
    return w


def measure_h(alt_count):
    alts_h = GAP_DIVIDER + alt_count * H_ALT + (alt_count - 1) * GAP_ALT if alt_count > 0 else 0
    return H_MAIN + GAP_MAIN + H_REASON + alts_h + PAD_Y * 2


def fit(max_h, alt_max):
    """复刻 HintPanel.fit"""
    alts = alt_max
    scale = 1.0
    MIN_SCALE = const(PANEL, 'MIN_SCALE')
    while True:
        h = measure_h(alts)
        if h <= max_h:
            scale = 1.0
            break
        scale = max_h / h
        if scale >= MIN_SCALE:
            break
        if alts > 0:
            alts -= 1
            continue
        scale = MIN_SCALE
        break
    scale = max(MIN_SCALE, min(1.0, scale))
    return measure_h(alts) * scale, scale, alts


# ===== 与 HintPanel 一致的内容(取"最坏情况": 文案最长 + 2 条次选) =====
MAIN_TEXT = '打出 三萬'
REASON_TEXT = '听牌 · 8 张进张 · 危险牌, 有人可能点炮'
ALTS = [
    '次选　打出 五筒　1 向听 · 12 张进张 · 安全牌',
    '次选　碰 五萬　手牌慢 1 档 · 会失去门清 +1 番',
]
FONT_MAIN, FONT_REASON, FONT_ALT = 40, 26, 24

# 配色(与 HintPanel 相同)
CARD_BG = (16, 32, 27)
CARD_BORDER = (214, 176, 96)
TEXT_SUB = (200, 216, 198)
TEXT_MUTED = (170, 184, 170)
DIVIDER = (214, 176, 96)
TONE = (244, 192, 100)   # warn
FELT_FAR = (32, 66, 48)
FELT_NEAR = (17, 38, 29)
WOOD = (150, 104, 54)
IVORY = (244, 236, 219)


def layout_for(ratio):
    """复刻 Main._applyLayout + _placeHintPanel, 返回内容坐标下的各元素"""
    half_h = 840 / ratio
    hand_y = -half_h + TILE_H / 2 + 8
    meld_h = tile_h(RIVER_TILE_W)
    meld_y = hand_y + TILE_H / 2 + meld_h / 2 + MELD_MARK_GAP
    disc_y = meld_y + meld_h / 2 + meld_h / 2 + MELD_MARK_GAP
    top_t = tile_h(TOP_TILE_W)
    top_hand_y = half_h - 8 - top_t / 2
    top_meld_y = top_hand_y - top_t / 2 - meld_h / 2 - MELD_MARK_GAP
    top_disc_y = top_meld_y - meld_h / 2 - meld_h / 2 - MELD_MARK_GAP
    bottom_river_top = disc_y + meld_h + meld_h / 2
    top_river_bottom = top_disc_y - meld_h - meld_h / 2
    disc_r = max(DISC_R_MIN, min(DISC_R_MAX, min(-bottom_river_top, top_river_bottom) - 6))
    meld_panel_y = disc_y + meld_h / 2 + 30

    gap = MELD_BTN_H / 2 + HINT_PANEL_GAP
    btn_top = meld_panel_y + gap
    btn_bottom = meld_panel_y - gap
    disc_bottom = -disc_r - 6 - HINT_BREATH
    hand_top = hand_y + TILE_H / 2 + HINT_BREATH
    avail_above = disc_bottom - btn_top
    avail_below = btn_bottom - hand_top
    above = avail_above >= avail_below
    avail = avail_above if above else avail_below

    h, scale, alts = fit(avail, len(ALTS))
    panel_bottom = btn_top if above else btn_bottom - h
    panel_top = btn_top + h if above else btn_bottom

    half_w = CONTENT_W / 2
    riichi_x = -half_w + 115
    hint_x = riichi_x + HINT_BTN_W / 2 + HINT_BTN_GAP + HINT_BTN_W / 2
    return dict(half_h=half_h, half_w=half_w, hand_y=hand_y, meld_y=meld_y, disc_y=disc_y,
                disc_r=disc_r, meld_panel_y=meld_panel_y, hand_top=hand_top,
                top_hand_y=top_hand_y, top_disc_y=top_disc_y, meld_h=meld_h,
                panel_bottom=panel_bottom, panel_top=panel_top, above=above, avail=avail,
                scale=scale, alts=alts, disc_bottom=disc_bottom,
                riichi_x=riichi_x, hint_x=hint_x)


def render(ratio, title, out):
    L = layout_for(ratio)
    # 画布: 内容坐标 x±840, y 只画可见区 [-half_h, +half_h], 上下留 40px 余量标注
    margin = 46
    top_pad = margin
    W = int(CONTENT_W * 0.62)
    H = int((L['half_h'] * 2 + top_pad + margin) * 0.62)
    img = Image.new('RGB', (W, H), (12, 20, 17))
    d = ImageDraw.Draw(img, 'RGBA')
    sx = W / CONTENT_W
    sy = sx


    def T(x, y, text, fill, size):
        """按内容坐标字号绘制文字(x,y 为文字左上角像素, size 为设计字号, 已乘缩放)"""
        f = font(size)
        if f is None:
            d.text((x, y), text, fill=fill)
        else:
            d.text((x, y), text, fill=fill, font=f)

    def P(x, y):
        """内容坐标 → 画布像素(y 向上为正)"""
        return (W / 2 + x * sx, top_pad + (L['half_h'] - y) * sy)

    # ---- 牌桌毡布梯形(简化为色带, 够看就行) ----
    # 注意: 画布 y 向下为正, 而内容坐标 y 向上为正; 竖屏时 P() 的映射会让
    # top 的像素 y **大于** bottom, 所以这里统一按像素 y 排序再画。
    y_bot = P(0, L['hand_y'] - 60)[1]
    y_top = P(0, L['top_hand_y'] + 60)[1]
    y_lo, y_hi = min(y_bot, y_top), max(y_bot, y_top)
    bands = 60
    for i in range(bands):
        t = i / (bands - 1)
        # t=0 在画面顶部(远端, 受光偏亮) → t=1 在底部(近端, 沉暗)
        col = tuple(int(FELT_FAR[k] + (FELT_NEAR[k] - FELT_FAR[k]) * t) for k in range(3))
        yy = y_lo + (y_hi - y_lo) * t
        hw = (CONTENT_W / 2 - 40) * sx * (1.0 - 0.08 * t)
        d.rectangle([W / 2 - hw, yy, W / 2 + hw, yy + (y_hi - y_lo) / bands + 1], fill=col)
    d.rectangle([P(-CONTENT_W / 2 + 40, 0)[0], y_lo, P(CONTENT_W / 2 - 40, 0)[0], y_hi],
                outline=WOOD, width=2)

    # ---- 标记: 可见区上下边界 ----
    for y in (L['half_h'], -L['half_h']):
        d.line([P(-CONTENT_W / 2, y), P(CONTENT_W / 2, y)], fill=(255, 80, 80), width=1)
    T(P(-CONTENT_W / 2 + 10, L['half_h'] - 16)[0], P(-CONTENT_W / 2 + 10, L['half_h'] - 16)[1], '可见区上边界', (255, 120, 120), 22)

    # ---- 中央转盘 ----
    cx, cy = P(0, 0)
    r = L['disc_r'] * sx
    d.ellipse([cx - r * 1.03, cy - r * 1.03 + 3, cx + r * 1.03, cy + r * 1.03 + 3], fill=(0, 0, 0, 70))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(168, 120, 52))
    d.ellipse([cx - r * .91, cy - r * .91, cx + r * .91, cy + r * .91], fill=(38, 96, 64))
    d.ellipse([cx - r * .73, cy - r * .73, cx + r * .73, cy + r * .73], fill=IVORY)
    # 倒计时圆牌(提示绝不能压它)
    cd = r * 0.575
    d.ellipse([cx - cd, cy - cd, cx + cd, cy + cd], fill=(176, 132, 58))
    d.ellipse([cx - cd * .88, cy - cd * .88, cx + cd * .88, cy + cd * .88], fill=(248, 243, 231))
    T(cx - cd * .3, cy - cd * .45, '20', (58, 38, 16), 34)

    # ---- 上家弃牌河 ----
    for i in range(6):
        x = (i - 2.5) * (RIVER_TILE_W + 4) * sx
        px, py = P(x, L['top_disc_y'])
        d.rectangle([px - 20, py - 26, px + 20, py + 26], fill=(248, 238, 210), outline=(200, 190, 160))

    # ---- 自家弃牌河 ----
    for i in range(8):
        x = (i - 3.5) * (RIVER_TILE_W + 4) * sx
        px, py = P(x, L['disc_y'])
        d.rectangle([px - 20, py - 26, px + 20, py + 26], fill=(248, 238, 210), outline=(200, 190, 160))

    # ---- 吃/碰按钮行 ----
    bx, by = P(0, L['meld_panel_y'])
    for i, label in enumerate(['碰 五萬', '过']):
        w = text_width(label, 26) + 44
        x0 = bx - (w * 0 + 0)
        bx0 = bx - (w + 12) / 2 if i == 0 else bx + 12
        d.rounded_rectangle([bx0, by - MELD_BTN_H / 2 * sy, bx0 + w * sx, by + MELD_BTN_H / 2 * sy],
                            radius=8, fill=(196, 132, 44) if i == 0 else (96, 104, 116))
        T(bx0 + 10 * sx, by - 13, label, (255, 255, 255), 26)

    # ---- 自家手牌 ----
    tw, th = TILE_W * sx, TILE_H * sy
    total = 13 * tw
    for i in range(13):
        x0 = W / 2 - total / 2 + i * tw
        y0h = P(0, L['hand_y'])[1]
        d.rectangle([x0, y0h - th / 2, x0 + tw, y0h + th / 2], fill=(248, 238, 210),
                    outline=(200, 190, 160))
    # 第 6 张 = 被提示的牌(青蓝描边)
    hx = W / 2 - total / 2 + 6 * tw
    hy = P(0, L['hand_y'])[1]
    d.rectangle([hx - 2, hy - th / 2 - 2, hx + tw + 2, hy + th / 2 + 2], outline=(178, 244, 240), width=3)

    # ---- 左上角: 听牌 + 提示 两个按钮 ----
    for x, label, col in ((L['riichi_x'], '听牌', (226, 182, 74)),
                          (L['hint_x'], '提示', (96, 186, 190))):
        cxp, cyp = P(x, L['hand_y'])
        d.rounded_rectangle([cxp - HINT_BTN_W / 2 * sx, cyp - HINT_BTN_H / 2 * sy,
                             cxp + HINT_BTN_W / 2 * sx, cyp + HINT_BTN_H / 2 * sy],
                            radius=HINT_BTN_H / 2 * sy, fill=(255, 255, 255, 20), outline=col, width=2)
        T(cxp - text_width(label, 24) * sx / 2, cyp - 12, label, col, 24)

    # ---- 提示面板 ----
    # 内部排版**逐行复刻** HintPanel._buildContent 的游标写法:
    # 游标 y 恒表示"上一段的底边", 每段先取中心再连同高度+间距一起下移。
    # (曾经在这里另写一套, 结果次选被画到卡片外面 —— 预览骗人比没预览更糟)
    alts = ALTS[:L['alts']]
    main_w = text_width(MAIN_TEXT, FONT_MAIN) + 8
    reason_w = text_width(REASON_TEXT, FONT_REASON) + 8
    alt_ws = [text_width(a, FONT_ALT) + 8 for a in alts]
    content_w = max(main_w, reason_w, *(alt_ws or [0]), CLOSE_W + 16)
    card_w = content_w + PAD_X * 2
    card_h = measure_h(L['alts'])
    k = L['scale']

    cyp = P(0, (L['panel_top'] + L['panel_bottom']) / 2)[1]   # 面板中心(像素)
    box_w, box_h = card_w * sx * k, card_h * sy * k
    x0, y0 = W / 2 - box_w / 2, cyp - box_h / 2
    d.rounded_rectangle([x0, y0, x0 + box_w, y0 + box_h], radius=20, fill=CARD_BG,
                        outline=CARD_BORDER, width=2)

    def local(cx, cy):
        """卡片局部坐标(原点在卡片中心, **y 向上为正**) → 像素(y 向下为正, 故取负)"""
        return (cxp_ + cx * sx * k, cyp - cy * sy * k)

    cxp_ = W / 2
    # 游标: 以卡片半高为起点向下走(内部逻辑与 HintPanel 完全一致)
    ly = card_h / 2 - PAD_Y
    main_y = ly - H_MAIN / 2
    ly -= H_MAIN + GAP_MAIN
    reason_y = ly - H_REASON / 2
    ly -= H_REASON
    divider_y = ly - GAP_DIVIDER / 2
    ly -= GAP_DIVIDER
    alt_top = ly

    left_x = -content_w / 2
    mx, my = local(left_x, main_y)
    T(mx, my - FONT_MAIN * sy * k * .38, MAIN_TEXT, TONE, FONT_MAIN * sy * k)
    rx, ry = local(left_x, reason_y)
    T(rx, ry - FONT_REASON * sy * k * .38, REASON_TEXT, TEXT_SUB, FONT_REASON * sy * k)

    if alts:
        _, dy = local(0, divider_y)
        d.line([local(-content_w / 2, divider_y)[0], dy, local(content_w / 2, divider_y)[0], dy],
               fill=DIVIDER + (105,), width=1)
        for a, aw in zip(alts, alt_ws):
            ax, ay = local(left_x, alt_top - H_ALT / 2)
            T(ax, ay - FONT_ALT * sy * k * .38, a, TEXT_MUTED, FONT_ALT * sy * k)
            alt_top -= H_ALT + GAP_ALT

    # 关闭按钮贴卡片上沿, 不参与纵向游标
    T(cxp_ + box_w / 2 - 22, y0 + 8, '×', (180, 200, 186), 24)

    # ---- 标注 ----
    info = (f"{title}  halfH={L['half_h']:.0f}  落位={'按钮行上方' if L['above'] else '按钮行下方'}"
            f"  可用={L['avail']:.0f}px  面板高={card_h * k:.0f}px  scale={L['scale']:.2f}"
            f"  次选={L['alts']}")
    T(8, 6, info, (255, 240, 190), 17)
    # 安全边界: 手牌上沿 / 转盘下沿
    for y, col, label in ((L['hand_top'], (120, 255, 180), '手牌上沿'),
                          (L['disc_bottom'], (255, 160, 120), '转盘下沿')):
        _, py = P(0, y)
        d.line([P(-CONTENT_W / 2, y)[0], py, P(CONTENT_W / 2, y)[0], py], fill=col + (140,), width=1)
        T(W - 118, py - 8, label, col, 16)

    img.save(out)
    print('已输出 %s  (%dx%d)' % (out, W, H))


def main():
    render(16 / 9, '16:9  1920x1080', os.path.join(ROOT, 'hint-preview.png'))
    render(21 / 9, '21:9  2520x1080', os.path.join(ROOT, 'hint-preview-wide.png'))
    render(3440 / 1440, '超宽 3440x1440', os.path.join(ROOT, 'hint-preview-ultrawide.png'))
    render(1080 / 2400, '竖屏 1080x2400', os.path.join(ROOT, 'hint-preview-portrait.png'))


if __name__ == '__main__':
    main()
