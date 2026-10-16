"""
对局内设置弹窗 + 齿轮按钮 预览(从真实源码镜像常量)

改 SettingsPanel / Main 的设置相关版式后跑这个出图确认:
  1) 弹窗**完整落在可见区内**(21:9 手机横屏可见高度最小, 是最坏情况)
  2) 卡片内部各段不重叠, 两个操作按钮留在卡里(它们是玩家唯一的出口)
  3) 左上角齿轮按钮压在牌桌左上角, 不与上家手牌/牌河撞车

【为什么必须镜像而不是手抄】手抄一份会与实现漂移, 于是"脚本说没问题、真机却撞车"。
所以这里的常量全部由 const() 从 assets/scripts 正则提取, 改一处两边同步。

用法: python tools/preview-settings.py
输出: settings-preview.png (上=16:9, 下=21:9, 含弹窗与齿轮按钮)
"""
import os
import re

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_FONT_CANDIDATES = [
    'C:/Windows/Fonts/msyh.ttc',    # 微软雅黑
    'C:/Windows/Fonts/Deng.ttf',
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/SimSun.ttf',
]
_FONT_PATH = next((p for p in _FONT_CANDIDATES if os.path.exists(p)), None)


def font(size):
    if not _FONT_PATH:
        return None
    try:
        return ImageFont.truetype(_FONT_PATH, max(8, int(round(size))))
    except Exception:
        return None


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


MAIN = read('assets/scripts/Main.ts')
PANEL = read('assets/scripts/ui/SettingsPanel.ts')


def const(src, name):
    m = re.search(r'const\s+%s\s*(?::[^=]*)?=\s*(-?[\d.]+)' % name, src)
    if not m:
        m = re.search(r'readonly\s+%s\s*(?::[^=]*)?=\s*(-?[\d.]+)' % name, src)
    if not m:
        raise KeyError('找不到常量 ' + name)
    return float(m.group(1))


CONTENT_W = const(MAIN, 'CONTENT_W')
TILE_W = const(MAIN, 'TILE_W')
TILE_H = const(MAIN, 'TILE_H')
TOP_TILE_W = const(MAIN, 'TOP_TILE_W')
DISC_R_MAX = const(MAIN, 'TURN_DISC_R_MAX')

CARD_W = const(PANEL, 'CARD_W')
PAD_X = const(PANEL, 'PAD_X')
PAD_Y = const(PANEL, 'PAD_Y')
H_TITLE = const(PANEL, 'H_TITLE')
GAP_TITLE = const(PANEL, 'GAP_TITLE')
H_GROUP = const(PANEL, 'H_GROUP')
GAP_GROUP = const(PANEL, 'GAP_GROUP')
H_CAPTION = const(PANEL, 'H_CAPTION')
GAP_CAPTION = const(PANEL, 'GAP_CAPTION')
H_ROW = const(PANEL, 'H_ROW')
GAP_ROW = const(PANEL, 'GAP_ROW')
H_DIVIDER = const(PANEL, 'H_DIVIDER')
GAP_DIVIDER = const(PANEL, 'GAP_DIVIDER')
H_BTN = const(PANEL, 'H_BTN')
OPT_GAP = const(PANEL, 'OPT_GAP')
BTN_GAP = const(PANEL, 'BTN_GAP')
MIN_SCALE = const(PANEL, 'MIN_SCALE')

FONT_TITLE, FONT_GROUP, FONT_CAPTION, FONT_OPTION = 44, 26, 28, 28
GROUPS = [
    ('音效音量', ['静音', '小', '中', '大'], 2),
    ('背景音乐', ['开', '关'], 0),
    ('音乐音量', ['静音', '小', '中', '大'], 1),
]
SETTINGS_BTN = 64

# 配色(与 SettingsPanel 一致)
CARD_BG = (16, 32, 27)
CARD_BORDER = (214, 176, 96)
TEXT_TITLE = (250, 246, 236)
TEXT_GROUP = (206, 184, 132)
TEXT_CAPTION = (226, 220, 202)
SELECTED = (230, 182, 68)
TEXT_INK = (28, 21, 12)
GHOST = (240, 238, 228)
BTN_BACK = (198, 108, 96)
DIVIDER = (214, 176, 96)
FELT_FAR = (32, 66, 48)
FELT_NEAR = (17, 38, 29)
IVORY = (244, 236, 219)
BTN_BG = (245, 240, 228)


def content_h():
    """复刻 SettingsPanel._contentH"""
    return (PAD_Y * 2 + H_TITLE + GAP_TITLE + H_GROUP + GAP_GROUP
            + len(GROUPS) * (H_CAPTION + GAP_CAPTION + H_ROW)
            + (len(GROUPS) - 1) * GAP_ROW
            + GAP_DIVIDER + H_DIVIDER + GAP_DIVIDER + H_BTN)


def compute_scale(half_h):
    """复刻 SettingsPanel._computeScale"""
    h = content_h()
    avail = half_h * 2 - 24 if half_h > 0 else 0
    if avail <= 0 or h <= avail:
        return 1.0
    return max(MIN_SCALE, min(1.0, avail / h))


def layout():
    """复刻 SettingsPanel._rebuild 的纵向游标, 返回各段的位置(卡片局部坐标, y 向上)"""
    h = content_h()
    out = {'h': h}
    y = h / 2 - PAD_Y
    out['title_y'] = y - H_TITLE / 2
    y -= H_TITLE + GAP_TITLE
    out['group_y'] = y - H_GROUP / 2
    y -= H_GROUP + GAP_GROUP
    out['rows'] = []
    for i, (_, _, _) in enumerate(GROUPS):
        cap_y = y - H_CAPTION / 2
        y -= H_CAPTION + GAP_CAPTION
        row_y = y - H_ROW / 2
        y -= H_ROW + (GAP_ROW if i < len(GROUPS) - 1 else 0)
        out['rows'].append({'cap_y': cap_y, 'row_y': row_y})
    y -= GAP_DIVIDER
    out['divider_y'] = y - H_DIVIDER / 2
    y -= H_DIVIDER + GAP_DIVIDER
    out['btn_y'] = y - H_BTN / 2
    return out


def mix(c1, c2, t):
    return tuple(int(round(c1[i] + (c2[i] - c1[i]) * t)) for i in range(3))


def render(ratio, scale_px):
    """渲染一张牌桌 + 齿轮按钮 + 设置弹窗, 返回 PIL 图"""
    half_h = 840 / ratio
    W = int(CONTENT_W * scale_px)
    H = int(half_h * 2 * scale_px)
    img = Image.new('RGB', (W, H), FELT_NEAR)
    d = ImageDraw.Draw(img)

    def px(x, y):
        """内容坐标(中心原点, y 向上) → 画布像素"""
        return (W / 2 + x * scale_px, H / 2 - y * scale_px)

    def rect_c(x0, y0, x1, y1, fill, radius=0, outline=None, width=1):
        """内容坐标矩形 → 画布(自动换算上下)"""
        a = px(x0, y1)   # 左上
        b = px(x1, y0)   # 右下
        d.rounded_rectangle([a[0], a[1], b[0], b[1]], radius=radius, fill=fill,
                            outline=outline, width=width)

    def text_c(x, y, s, f, fill, anchor='mm'):
        d.text(px(x, y), s, font=font(f * scale_px), fill=fill, anchor=anchor)

    # ---- 牌桌: 竖向渐变毡布 ----
    for i in range(H):
        d.line([(0, i), (W, i)], fill=mix(FELT_FAR, FELT_NEAR, i / max(1, H - 1)))

    # ---- 上家手牌(顶部一排) ----
    top_h = TOP_TILE_W * (TILE_H / TILE_W)
    top_y = half_h - 8 - top_h / 2
    for i in range(13):
        x = (i - 6) * TOP_TILE_W
        rect_c(x - TOP_TILE_W / 2, top_y - top_h / 2, x + TOP_TILE_W / 2, top_y + top_h / 2,
               (216, 208, 188), radius=int(3 * scale_px))

    # ---- 自家手牌(底部一排) ----
    hand_y = -half_h + TILE_H / 2 + 8
    for i in range(14):
        x = (i - 6.5) * TILE_W
        rect_c(x - TILE_W / 2 + 2, hand_y - TILE_H / 2, x + TILE_W / 2 - 2, hand_y + TILE_H / 2,
               (248, 244, 232), radius=int(4 * scale_px))

    # ---- 中央转盘(两圈) ----
    cx, cy = px(0, 0)
    for rr, col in ((DISC_R_MAX, (150, 116, 66)), (DISC_R_MAX * 0.9, (58, 92, 72)),
                    (DISC_R_MAX * 0.73, IVORY)):
        d.ellipse([cx - rr * scale_px, cy - rr * scale_px, cx + rr * scale_px, cy + rr * scale_px], fill=col)

    # ---- 左上角齿轮按钮(用真实图标素材) ----
    bx = -CONTENT_W / 2 + 24 + SETTINGS_BTN / 2
    by = half_h - 8 - SETTINGS_BTN / 2
    a = px(bx - SETTINGS_BTN / 2, by + SETTINGS_BTN / 2)
    b = px(bx + SETTINGS_BTN / 2, by - SETTINGS_BTN / 2)
    d.ellipse([a[0], a[1], b[0], b[1]], fill=BTN_BG)
    icon_path = os.path.join(ROOT, 'assets/resources/icons/settings.png')
    if os.path.exists(icon_path):
        ICON = 40
        icon = Image.open(icon_path).convert('RGBA').resize(
            (max(2, int(ICON * scale_px)), max(2, int(ICON * scale_px))), Image.LANCZOS)
        ia = px(bx - ICON / 2, by + ICON / 2)
        img.paste(icon, (int(ia[0]), int(ia[1])), icon)

    # ---- 设置弹窗 ----
    sc = compute_scale(half_h)
    lay = layout()
    card_h = lay['h'] * sc
    card_w = CARD_W * sc
    content_w = (CARD_W - PAD_X * 2) * sc

    # 遮罩: 整屏压暗(弹窗打开时牌桌变暗)
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 150))
    img.paste(Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB'), (0, 0))

    def card_px(x, y):
        """卡片局部坐标(y 向上, 卡片中心为原点) → 画布像素"""
        return px(x * sc, y * sc)

    # 阴影 + 卡底 + 描边
    a = card_px(-card_w / 2, card_h / 2)
    b = card_px(card_w / 2, -card_h / 2)
    r = int(26 * sc * scale_px)
    d.rounded_rectangle([a[0] + 4, a[1] + 6, b[0] + 4, b[1] + 6], radius=r, fill=(6, 14, 12))
    d.rounded_rectangle([a[0], a[1], b[0], b[1]], radius=r, fill=CARD_BG,
                        outline=CARD_BORDER, width=max(1, int(3 * sc * scale_px)))

    def ct(x, y, s, f, fill, anchor='mm'):
        d.text(card_px(x, y), s, font=font(f * sc * scale_px), fill=fill, anchor=anchor)

    def cbtn(x, y, w, h, label, selected, fill_override=None):
        a2 = card_px(x - w / 2, y + h / 2)
        b2 = card_px(x + w / 2, y - h / 2)
        rr = int(h * sc * scale_px / 2)
        fill = fill_override if fill_override else (SELECTED if selected else (26, 44, 38))
        d.rounded_rectangle([a2[0], a2[1], b2[0], b2[1]], radius=rr, fill=fill,
                            outline=None if selected or fill_override else GHOST,
                            width=1 if not selected and not fill_override else 0)
        ct(x, y, label, FONT_OPTION, TEXT_INK if selected else
           (TEXT_TITLE if not fill_override else ((28, 21, 12) if fill_override == SELECTED else TEXT_TITLE)))

    ct(0, lay['title_y'], '设置', FONT_TITLE, TEXT_TITLE)
    ct(0, lay['group_y'], '声音', FONT_GROUP, TEXT_GROUP)
    for i, (caption, opts, sel) in enumerate(GROUPS):
        row = lay['rows'][i]
        ct(-content_w / (2 * sc) + 6, row['cap_y'], caption, FONT_CAPTION, TEXT_CAPTION, anchor='lm')
        n = len(opts)
        bw = (content_w / sc - (n - 1) * OPT_GAP) / n
        total = n * bw + (n - 1) * OPT_GAP
        x0 = -total / 2 + bw / 2
        for j, lab in enumerate(opts):
            cbtn(x0 + j * (bw + OPT_GAP), row['row_y'], bw, H_ROW, lab, j == sel)

    # 分隔线
    a3 = card_px(-content_w / (2 * sc), lay['divider_y'])
    b3 = card_px(content_w / (2 * sc), lay['divider_y'])
    d.line([a3, b3], fill=DIVIDER, width=1)

    # 两个操作按钮
    aw = min(250, (content_w / sc - BTN_GAP) / 2)
    total = aw * 2 + BTN_GAP
    x0 = -total / 2 + aw / 2
    cbtn(x0, lay['btn_y'], aw, H_BTN, '重新开始', True, SELECTED)
    cbtn(x0 + aw + BTN_GAP, lay['btn_y'], aw, H_BTN, '返回主页面', True, BTN_BACK)

    # 关闭按钮
    close_x = CARD_W / 2 - 44 / 2 - 12
    close_y = lay['h'] / 2 - 44 / 2 - 10
    cbtn(close_x, close_y, 44, 44, '×', False)

    return img


def main():
    shots = [('16:9', 16 / 9, 0.5), ('21:9', 21 / 9, 0.5)]
    imgs = [render(r, s) for _, r, s in shots]
    gap = 16
    W = max(i.width for i in imgs)
    H = sum(i.height for i in imgs) + gap * (len(imgs) - 1)
    canvas = Image.new('RGB', (W, H), (10, 10, 10))
    y = 0
    for im in imgs:
        canvas.paste(im, (0, y))
        y += im.height + gap
    out = os.path.join(ROOT, 'settings-preview.png')
    canvas.save(out)
    print('已输出: ' + out)
    print('  上 = 16:9 (可见半高 472)')
    print('  下 = 21:9 (可见半高 360, 手机横屏最坏情况)')
    h = content_h()
    for _, r, _ in shots:
        half = 840 / r
        print('  %s: 卡片高 %.0f, 缩放 %.2f, 可用高 %.0f' % (_, h, compute_scale(half), half * 2 - 24))


if __name__ == '__main__':
    main()
