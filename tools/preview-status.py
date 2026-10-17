"""
对局信息常驻显示预览(比分条 + 听牌详情芯片)

把 Main.ts 里 _applyLayout / _refreshScoreStrip / _showTenpaiChip / _placeTenpaiChip
的坐标算法在 Python 里复刻一遍, 按各屏幕比例出图, 用来确认:
  1) 左上角比分条: 在齿轮右侧、"上家手牌最宽情形"左侧那条净空里, 不含糊
  2) 手牌右侧听牌芯片: 不压满手 14 张牌, 也不压右侧"你·听"标记(多面听文案靠缩放兜底)

【为什么必须镜像而不是手抄】手抄一份会与实现漂移, 于是"脚本说没问题、真机却撞车"。
所以常量全部由 const() 从 assets/scripts/Main.ts 正则提取, 改一处两边同步。

用法: python tools/preview-status.py
输出: status-preview.png (16:9) / -wide (21:9) / -ultrawide (超宽) / -portrait (竖屏)
"""
import os
import re

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ===== 中文字体(PIL 默认字体没有 CJK 字形, 不找字体就满屏豆腐块) =====
_FONT_CANDIDATES = [
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/Deng.ttf',
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/SimSun.ttf',
]
_FONT_PATH = next((p for p in _FONT_CANDIDATES if os.path.exists(p)), None)


def font(size):
    if not _FONT_PATH:
        return None
    try:
        return ImageFont.truetype(_FONT_PATH, int(round(size)))
    except Exception:
        return None


with open(os.path.join(ROOT, 'assets/scripts/Main.ts'), encoding='utf-8') as f:
    MAIN = f.read()


def const(name):
    """提取 const X = n 与 private readonly X = n 两种写法"""
    m = re.search(r'const\s+%s\s*(?::[^=]*)?=\s*(-?[\d.]+)' % name, MAIN)
    if not m:
        m = re.search(r'readonly\s+%s\s*(?::[^=]*)?=\s*(-?[\d.]+)' % name, MAIN)
    if not m:
        raise KeyError('找不到常量 ' + name)
    return float(m.group(1))


CONTENT_W = const('CONTENT_W')
TILE_W = const('BASE_TILE_W')
TILE_H = const('BASE_TILE_H')
TOP_TILE_W = const('BASE_TOP_TILE_W')
RIVER_TILE_W = const('BASE_RIVER_TILE_W')
MELD_MARK_GAP = const('MELD_MARK_GAP')
HINT_BTN_W = const('HINT_BTN_W')
HINT_BTN_H = const('HINT_BTN_H')
HINT_BTN_GAP = const('HINT_BTN_GAP')

SCORE_CHIP_H = const('SCORE_CHIP_H')
SCORE_FONT = const('SCORE_FONT')
SCORE_CHIP_PAD = const('SCORE_CHIP_PAD')
SCORE_CHIP_GAP = const('SCORE_CHIP_GAP')
SCORE_STRIP_GAP = const('SCORE_STRIP_GAP')
SCORE_HAND_GAP = const('SCORE_HAND_GAP')

TENPAI_CHIP_H = const('TENPAI_CHIP_H')
TENPAI_FONT = const('TENPAI_FONT')
TENPAI_CHIP_PAD = const('TENPAI_CHIP_PAD')
TENPAI_CHIP_RIGHT = const('TENPAI_CHIP_RIGHT')
TENPAI_HAND_GAP = const('TENPAI_HAND_GAP')
CHIP_MIN_SCALE = const('CHIP_MIN_SCALE')

# 座位名牌(见 Main._refreshSeatPlates / _placeSeatPlates)
SEAT_PLATE_H = const('SEAT_PLATE_H')
SEAT_PLATE_FONT = const('SEAT_PLATE_FONT')
SEAT_PLATE_PAD = const('SEAT_PLATE_PAD')
SEAT_PLATE_GAP = const('SEAT_PLATE_GAP')
SIDE_TILE_W = const('BASE_SIDE_TILE_W')
TENPAI_MARK_W = const('TENPAI_MARK_W')
TENPAI_MARK_H = const('TENPAI_MARK_H')
TENPAI_MARK_INSET = const('TENPAI_MARK_INSET')
# 桌面几何(平板适配: 可见半高很大时牌位要夹到毡布内)
TABLE_FAR_HH = const('TABLE_FAR_HH')
FELT_TILE_TOP = const('FELT_TILE_TOP')
FELT_TILE_BOTTOM = const('FELT_TILE_BOTTOM')
# 桌面侧边透视倾斜角(与 Main.SIDE_EDGE_TILT 同一式子)
import math as _math
SIDE_EDGE_TILT = _math.degrees(_math.atan2(786 - 786 * 0.78, 526 + 526 * (530 / 560)))

# 齿轮按钮尺寸(与 _buildSettingsUI 的 createIconButton 一致)
_gear = re.search(r"createIconButton\(\s*'icons/settings'\s*,\s*(\d+)\s*,\s*(\d+)", MAIN)
GEAR_W, GEAR_H = float(_gear.group(1)), float(_gear.group(2))
# 齿轮按钮左缘留白(与 _applyLayout 的定位式一致)
_pad = re.search(r'_settingsBtnX\s*=\s*-this\.CONTENT_W\s*/\s*2\s*\+\s*(\d+)\s*\+\s*(\d+)', MAIN)
GEAR_PAD = float(_pad.group(1))

TILE_RATIO = TILE_H / TILE_W

# 配色(与 Main.ts 常量同源)
CHIP_BG = (24, 58, 40)
CHIP_EDGE = (214, 176, 96)
CHIP_EDGE_SELF = (244, 200, 108)
CHIP_TEXT = (255, 236, 190)
SCORE_GAIN = (250, 208, 118)
SCORE_LOSS = (238, 138, 124)
SCORE_ZERO = (200, 216, 198)
WARN = (236, 134, 90)
FELT_FAR = (32, 66, 48)
FELT_NEAR = (17, 38, 29)
WOOD = (150, 104, 54)
IVORY = (248, 238, 210)

# ---- 展示文案(比分取"常见两三位数", 听牌取"多面听"最坏情况) ----
SCORE_TEXTS = ['你 +12', '老陈 -4', '小雨 +128', '阿虎 -36']
SCORE_VALUES = [12, -4, 128, -36]
TENPAI_TEXT = '听 2/3/4/5/6萬 · 余 12 张'   # 最坏情况: 五面听 + 两位数剩余


def text_width(text, f):
    """CJK 按字号, 其余半角 —— 与 Main.textWidth 一致"""
    w = 0
    for ch in text:
        w += f if ord(ch) >= 0x2E80 else f * 0.5
    return w


def layout_for(ratio):
    """复刻 Main._applyLayout 里与新元素相关的定位"""
    half_h = 840 / ratio
    half_w = CONTENT_W / 2
    # 平板(3:2 / 4:3)上可见半高超过毡布: 牌位要夹住(见 Main._applyLayout)
    k = max(1.0, (half_h + 10) / TABLE_FAR_HH)
    top_half = min(half_h, FELT_TILE_TOP * k)
    bottom_half = min(half_h, FELT_TILE_BOTTOM * k)
    hand_y = -bottom_half + TILE_H / 2 + 8
    hand_top = hand_y + TILE_H / 2
    top_tile_h = TOP_TILE_W * TILE_RATIO
    top_hand_y = top_half - 8 - top_tile_h / 2
    top_meld_top = half_h - 8 - top_tile_h - MELD_MARK_GAP
    meld_y = hand_y + TILE_H / 2 + RIVER_TILE_W * TILE_RATIO / 2 + MELD_MARK_GAP

    gear_x = -half_w + GEAR_PAD + GEAR_W / 2
    gear_y = half_h - 8 - GEAR_H / 2
    strip_left = gear_x + GEAR_W / 2 + SCORE_STRIP_GAP
    strip_right = -(14 * TOP_TILE_W) / 2 - SCORE_HAND_GAP
    strip_cx = (strip_left + strip_right) / 2
    strip_max_w = strip_right - strip_left

    # _refreshScoreStrip: 逐芯片算宽 → 超预算整体缩
    widths = [text_width(t, SCORE_FONT) + SCORE_CHIP_PAD * 2 for t in SCORE_TEXTS]
    total = sum(widths) + (len(widths) - 1) * SCORE_CHIP_GAP
    strip_scale = max(CHIP_MIN_SCALE, strip_max_w / total) if total > strip_max_w else 1.0

    # _placeTenpaiChip
    chip_right = half_w - TENPAI_CHIP_RIGHT
    hand_right = (14 * TILE_W) / 2 + TENPAI_HAND_GAP
    chip_max_w = chip_right - hand_right
    chip_w = text_width(TENPAI_TEXT, TENPAI_FONT) + TENPAI_CHIP_PAD * 2
    chip_scale = max(CHIP_MIN_SCALE, chip_max_w / chip_w) if chip_w > chip_max_w else 1.0

    # ---- 座位名牌(镜像 _placeSeatPlates) ----
    plate_names = ['', '老陈', '小雨', '阿虎']   # 自家没有名牌(见 Main._buildSeatPlates)
    plate_badges = ['', '×2', '', '']          # 只演示"上家在连庄"
    plates = []
    for i in range(4):
        name_w = text_width(plate_names[i], SEAT_PLATE_FONT)
        badge_w = text_width(plate_badges[i], SEAT_PLATE_FONT) if plate_badges[i] else 0
        gap_w = SEAT_PLATE_FONT * 0.3 if plate_badges[i] else 0
        w = name_w + badge_w + gap_w + SEAT_PLATE_PAD * 2
        plates.append(dict(name=plate_names[i], badge=plate_badges[i],
                           name_w=name_w, badge_w=badge_w, gap_w=gap_w, w=w))
    tilt = _math.radians(90 - SIDE_EDGE_TILT)
    side_half = (14 * SIDE_TILE_W) / 2 * _math.sin(tilt) + (SIDE_TILE_W * TILE_RATIO) / 2 * _math.cos(tilt)
    side_x = CONTENT_W / 2 - TENPAI_MARK_INSET
    side_y = -(TENPAI_MARK_H / 2 + SEAT_PLATE_GAP + SEAT_PLATE_H / 2)
    plates[1]['x'] = (14 * TOP_TILE_W) / 2 + SEAT_PLATE_GAP + plates[1]['w'] / 2
    plates[1]['y'] = top_hand_y
    plates[2]['x'], plates[2]['y'] = -side_x, side_y
    plates[3]['x'], plates[3]['y'] = side_x, side_y
    plates[0]['x'], plates[0]['y'] = None, None

    return dict(
        half_h=half_h, half_w=half_w, hand_y=hand_y, hand_top=hand_top, top_meld_top=top_meld_top,
        table_k=k, top_half=top_half, bottom_half=bottom_half, top_hand_y=top_hand_y,
        meld_y=meld_y, side_half=side_half, plates=plates,
        gear_x=gear_x, gear_y=gear_y, strip_left=strip_left, strip_right=strip_right,
        strip_cx=strip_cx, strip_max_w=strip_max_w, widths=widths, total=total,
        strip_scale=strip_scale, chip_right=chip_right, hand_right=hand_right,
        chip_w=chip_w, chip_scale=chip_scale,
    )


def render(ratio, title, out):
    L = layout_for(ratio)
    margin = 46
    W = int(CONTENT_W * 0.62)
    H = int((L['half_h'] * 2 + margin * 2) * 0.62)
    img = Image.new('RGB', (W, H), (12, 20, 17))
    d = ImageDraw.Draw(img, 'RGBA')
    sx = W / CONTENT_W

    def T(x, y, text, fill, size):
        f = font(size)
        if f is None:
            d.text((x, y), text, fill=fill)
        else:
            d.text((x, y), text, fill=fill, font=f)

    def P(x, y):
        """内容坐标 → 画布像素(y 向上为正)"""
        return (W / 2 + x * sx, margin + (L['half_h'] - y) * sx)

    # ---- 毡布台面(简化渐变带) ----
    y_bot = P(0, L['hand_y'] - 60)[1]
    y_top = P(0, L['half_h'])[1]
    y_lo, y_hi = min(y_bot, y_top), max(y_bot, y_top)
    bands = 60
    for i in range(bands):
        t = i / (bands - 1)
        col = tuple(int(FELT_FAR[k] + (FELT_NEAR[k] - FELT_FAR[k]) * t) for k in range(3))
        yy = y_lo + (y_hi - y_lo) * t
        hw = (CONTENT_W / 2 - 40) * sx
        d.rectangle([W / 2 - hw, yy, W / 2 + hw, yy + (y_hi - y_lo) / bands + 1], fill=col)

    # ---- 可见区上下边界 ----
    for y in (L['half_h'], -L['half_h']):
        d.line([P(-CONTENT_W / 2, y), P(CONTENT_W / 2, y)], fill=(255, 80, 80), width=1)

    # ---- 左上角: 齿轮按钮 + 比分条 ----
    gx, gy = P(L['gear_x'], L['gear_y'])
    gr = GEAR_W / 2 * sx
    d.ellipse([gx - gr, gy - gr, gx + gr, gy + gr], fill=(245, 240, 228), outline=(200, 190, 170))
    d.ellipse([gx - gr * .45, gy - gr * .45, gx + gr * .45, gy + gr * .45],
              fill=(96, 100, 96), outline=(70, 72, 70))
    d.ellipse([gx - gr * .16, gy - gr * .16, gx + gr * .16, gy + gr * .16], fill=(245, 240, 228))
    # 齿轮右缘 / 净空边界
    for x, col, label in ((L['gear_x'] + GEAR_W / 2, (255, 120, 120), '齿轮右缘'),
                          (L['strip_left'], (120, 255, 180), '比分条左界'),
                          (L['strip_right'], (120, 255, 180), '比分条右界'),
                          (-(14 * TOP_TILE_W) / 2, (255, 200, 120), '上家满手 14 张左缘')):
        px, py = P(x, L['gear_y'])
        d.line([px, P(0, L['half_h'])[1], px, P(0, L['gear_y'] - 60)[1]], fill=col + (150,), width=1)
        T(px + 3, P(0, L['half_h'])[1] + 4, label, col, 15)

    # 比分芯片(按真实宽度与缩放排布; 名字与分数分两段着色)
    widths = L['widths']
    total = L['total']
    scale = L['strip_scale']
    cursor = -total / 2
    for i, text in enumerate(SCORE_TEXTS):
        w = widths[i]
        cx = L['strip_cx'] + (cursor + w / 2) * scale
        pw, ph = w * scale * sx, SCORE_CHIP_H * scale * sx
        px, py = P(cx, L['gear_y'])
        r = min(10 * scale * sx, ph / 2)
        d.rounded_rectangle([px - pw / 2, py - ph / 2, px + pw / 2, py + ph / 2], radius=r,
                            fill=CHIP_BG + (235,),
                            outline=(CHIP_EDGE_SELF if i == 0 else CHIP_EDGE) + (245,), width=2)
        fs = SCORE_FONT * scale * sx
        f = font(fs)
        name, _, score = text.partition(' ')
        col = SCORE_GAIN if SCORE_VALUES[i] > 0 else (SCORE_LOSS if SCORE_VALUES[i] < 0 else SCORE_ZERO)
        nw = text_width(name, fs)
        # 名字(浅色) + 分数(正负色)在同一行里手工居中
        sw = text_width(score, fs)
        x0 = px - (nw + fs * 0.5 + sw) / 2
        d.text((x0, py), name, fill=CHIP_TEXT, font=f, anchor='lm')
        d.text((x0 + nw + fs * 0.5, py), score, fill=col, font=f, anchor='lm')
        cursor += w + SCORE_CHIP_GAP
    T(P(L['strip_right'], 0)[0] - 200, P(0, L['gear_y'] + 44)[1],
      '比分条 x%.2f' % scale, (200, 216, 198), 16)

    # ---- 底部: 手牌(最坏 14 张) + 按钮 + 听牌芯片 + "你·听"标记 ----
    hy = P(0, L['hand_y'])[1]
    tw = TILE_W * sx
    th = TILE_H * sx
    for i in range(14):
        cx = (i - 6.5) * tw
        d.rounded_rectangle([W / 2 + cx - tw / 2, hy - th / 2, W / 2 + cx + tw / 2, hy + th / 2],
                            radius=4, fill=IVORY, outline=(200, 190, 160))
    # 听牌/提示按钮(手牌左侧)
    riichi_x = -L['half_w'] + 115
    hint_x = riichi_x + HINT_BTN_W / 2 + HINT_BTN_GAP + HINT_BTN_W / 2
    for x, text, col in ((riichi_x, '听牌', (226, 182, 74)), (hint_x, '提示', (96, 186, 190))):
        px, py = P(x, L['hand_y'])
        d.rounded_rectangle([px - HINT_BTN_W / 2 * sx, py - HINT_BTN_H / 2 * sx,
                             px + HINT_BTN_W / 2 * sx, py + HINT_BTN_H / 2 * sx],
                            radius=HINT_BTN_H / 2 * sx, fill=col + (235,))
        f = font(20 * sx)
        d.text((px, py), text, fill=(255, 255, 255), font=f, anchor='mm')

    # "你·听"标记(宣告听牌时出现, 中心 halfW-70, 112×36)
    mx, my = P(L['half_w'] - 70, L['hand_y'])
    d.rounded_rectangle([mx - 56 * sx, my - 18 * sx, mx + 56 * sx, my + 18 * sx], radius=8,
                        fill=CHIP_BG + (235,), outline=CHIP_EDGE_SELF + (245,), width=2)
    f = font(22 * sx)
    d.text((mx, my), '你·听', fill=(255, 226, 158), font=f, anchor='mm')

    # 听牌详情芯片(真实宽度与缩放, 右对齐到 halfW−TENPAI_CHIP_RIGHT)
    chip_w = L['chip_w'] * L['chip_scale']
    cxx = L['chip_right'] - chip_w / 2
    px, py = P(cxx, L['hand_y'])
    pw, ph = chip_w * sx, TENPAI_CHIP_H * L['chip_scale'] * sx
    r = min(10 * L['chip_scale'] * sx, ph / 2)
    d.rounded_rectangle([px - pw / 2, py - ph / 2, px + pw / 2, py + ph / 2], radius=r,
                        fill=CHIP_BG + (235,), outline=CHIP_EDGE + (245,), width=2)
    f = font(TENPAI_FONT * L['chip_scale'] * sx)
    d.text((px, py), TENPAI_TEXT, fill=CHIP_TEXT, font=f, anchor='mm')

    # ---- 各家牌区(淡框): 核对座位名牌有没有压到牌 ----
    riv_h = RIVER_TILE_W * TILE_RATIO
    top_tile_h = TOP_TILE_W * TILE_RATIO
    top_meld_y = L['top_hand_y'] - top_tile_h / 2 - riv_h / 2 - MELD_MARK_GAP

    def box(cx, cy, w, h, col, label=''):
        x0, y0 = P(cx - w / 2, cy + h / 2)
        x1, y1 = P(cx + w / 2, cy - h / 2)
        d.rectangle([x0, min(y0, y1), x1, max(y0, y1)], outline=col + (110,), width=1)
        if label:
            T(x0 + 2, min(y0, y1) + 2, label, col, 14)

    box(0, L['top_hand_y'], 14 * TOP_TILE_W, top_tile_h, (150, 190, 255), '上家手牌 14 张')
    box(-620, 0, SIDE_TILE_W * 1.5, L['side_half'] * 2, (150, 190, 255), '左家手牌')
    box(620, 0, SIDE_TILE_W * 1.5, L['side_half'] * 2, (150, 190, 255), '右家手牌')
    box(0, L['meld_y'], 4 * 3 * RIVER_TILE_W, riv_h, (150, 190, 255), '自家副露(4 组最坏)')
    box(-TENPAI_MARK_INSET, top_meld_y, TENPAI_MARK_W, TENPAI_MARK_H, (170, 210, 255), '上家·听')
    box(-TENPAI_MARK_INSET, 0, TENPAI_MARK_W, TENPAI_MARK_H, (170, 210, 255), '左家·听')
    box(TENPAI_MARK_INSET, 0, TENPAI_MARK_W, TENPAI_MARK_H, (170, 210, 255), '右家·听')
    box(764, L['half_h'] - 16 - 27, 96, 55, (170, 210, 255), '牌墙')

    # ---- 四家座位名牌(名字 + 连庄角标) ----
    for i, p in enumerate(L['plates']):
        if p['x'] is None:
            continue
        px, py = P(p['x'], p['y'])
        pw, ph = p['w'] * sx, SEAT_PLATE_H * sx
        d.rounded_rectangle([px - pw / 2, py - ph / 2, px + pw / 2, py + ph / 2],
                            radius=min(10 * sx, ph / 2), fill=CHIP_BG + (235,),
                            outline=(CHIP_EDGE_SELF if i == 0 else CHIP_EDGE) + (245,), width=2)
        f = font(SEAT_PLATE_FONT * sx)
        x0 = px - pw / 2 + SEAT_PLATE_PAD * sx
        d.text((x0, py), p['name'], fill=CHIP_TEXT, font=f, anchor='lm')
        if p['badge']:
            d.text((x0 + (p['name_w'] + p['gap_w']) * sx, py), p['badge'],
                   fill=SCORE_GAIN, font=f, anchor='lm')

    # 关键边界线: 手牌右缘 / 芯片右缘 / 手牌上沿
    for x, col, label in ((L['hand_right'], (255, 200, 120), '手牌右缘(14 张最坏)'),
                          (L['chip_right'], (120, 255, 180), '芯片右缘'),
                          (L['half_w'] - 70 - 56, (160, 200, 255), '“你·听”左缘')):
        px2, _ = P(x, 0)
        d.line([px2, P(0, L['hand_y'] - 50)[1], px2, P(0, L['hand_top'] + 40)[1]],
               fill=col + (170,), width=1)
        T(px2 + 3, P(0, L['hand_top'] + 40)[1], label, col, 15)
    d.line([P(-CONTENT_W / 2, L['hand_top']), P(CONTENT_W / 2, L['hand_top'])],
           fill=(120, 255, 180), width=1)

    # ---- 标题与数据 ----
    T(8, 6, f"{title}  halfH={L['half_h']:.0f}  比分条: 预算 {L['strip_max_w']:.0f}px / 实际 "
            f"{L['total']:.0f}px × {L['strip_scale']:.2f}  听牌芯片: 预算 "
            f"{L['chip_right'] - L['hand_right']:.0f}px / 实际 {L['chip_w']:.0f}px × {L['chip_scale']:.2f}",
      (255, 240, 190), 17)

    img.save(out)
    print('已输出 %s  (%dx%d)' % (out, W, H))


def main():
    render(16 / 9, '16:9  1920x1080', os.path.join(ROOT, 'status-preview.png'))
    render(21 / 9, '21:9  2520x1080', os.path.join(ROOT, 'status-preview-wide.png'))
    render(3440 / 1440, '超宽 3440x1440', os.path.join(ROOT, 'status-preview-ultrawide.png'))
    render(1080 / 2400, '竖屏 1080x2400', os.path.join(ROOT, 'status-preview-portrait.png'))


if __name__ == '__main__':
    main()
