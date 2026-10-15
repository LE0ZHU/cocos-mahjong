"""
牌桌排版预览(改尺寸前后对照)

把 Main.ts 里 _applyLayout / 弃牌河 / 副露 的坐标算法在 Python 里复刻一遍,
按手机横屏比例渲染成图,用来确认:
  1) 中央转盘不会压到上下的弃牌河
  2) 副露(吃/碰/杠)那一排、弃牌河的牌明显变大

用法: python tools/preview-layout.py
输出: layout-preview.png
"""
import math
import os
from PIL import Image, ImageDraw

# ===== Main.ts 中与尺寸无关的常量 =====
CONTENT_W = 1680
BASE_W, BASE_H = 1920, 1080
TILE_H_RATIO = 87 / 64          # 所有牌统一宽高比
TILE_W, TILE_H, TILE_GAP = 64, 87, 4          # 自家手牌(三家 AI 手牌现在同尺寸)
MELD_MARK_GAP = 24
DEFAULT_AI_LAYOUT = [               # [hx, 横向, dx]
    (0, True, 0),                   # 上家
    (-620, False, -340),            # 左家
    (620, False, 340),              # 右家
]
OLD_AI_LAYOUT = [
    (0, True, 0),
    (-620, False, -340),
    (620, False, 340),
]
SIDE_EDGE_TILT = math.degrees(math.atan2(786 - 786 * 0.78, 526 + 526 * (530 / 560)))


def tile_h(w):
    return w * TILE_H_RATIO


class Variant:
    """一套牌桌尺寸参数"""

    def __init__(self, name, river_w, river_cols, meld_w, meld_gap, disc_r_max, disc_adaptive, tip_ratio,
                 info_rows, meld_matches_river=False, meld_squash=0.85, river_squash=0.82,
                 side_river_inward=True, disc_r_min=30, side_river_cols=None,
                 top_tile_w=32, top_tile_gap=2, side_tile_w=38, side_tile_gap=3,
                 ai_layout=None, meld_offset=70, side_step_adaptive=False):
        self.name = name
        self.river_w = river_w
        self.river_gap = 2
        self.river_cols = river_cols
        self.side_river_cols = side_river_cols or river_cols   # 左右家每排张数
        self.river_squash_y = river_squash
        self.meld_w = meld_w          # [自己, 上家, 左右]
        self.meld_gap = meld_gap
        self.disc_r_max = disc_r_max
        self.disc_adaptive = disc_adaptive
        self.tip_ratio = tip_ratio
        self.info_rows = info_rows    # 临时提示给上家牌河让位的行数
        self.meld_matches_river = meld_matches_river   # 副露牌是否与弃牌河同尺寸
        self.meld_squash = meld_squash                 # 自己副露容器的纵向压缩
        self.side_river_inward = side_river_inward     # 左右家牌河是否朝桌心堆
        self.disc_r_min = disc_r_min
        self.disc_r = disc_r_max
        self.top_tile_w = top_tile_w
        self.top_tile_gap = top_tile_gap
        self.side_tile_w = side_tile_w
        self.side_tile_gap = side_tile_gap
        self.ai_layout = ai_layout or DEFAULT_AI_LAYOUT
        self.meld_offset = meld_offset
        self.side_step_adaptive = side_step_adaptive   # 侧边手牌间距是否按可见高度压缩

    def meld_width(self, seat):
        if self.meld_matches_river:
            return self.river_w
        return self.meld_w[0 if seat == 0 else (1 if seat == 1 else 2)]

    def meld_gap_of(self, seat):
        if self.meld_matches_river:
            return self.river_gap
        return self.meld_gap[0 if seat == 0 else (1 if seat == 1 else 2)]

    def player_meld_squash(self):
        return self.river_squash_y if self.meld_matches_river else self.meld_squash

    def side_hand_step(self, lay, count):
        """左右家手牌每张牌的间距(复刻 Main._sideHandStep)"""
        full = self.side_tile_w + self.side_tile_gap
        half_h = lay['half_h']
        if not self.side_step_adaptive or half_h <= 0 or count <= 1:
            return full
        tilt = math.radians(SIDE_EDGE_TILT)
        cos, sin = math.cos(tilt), math.sin(tilt)
        th = tile_h(self.side_tile_w)
        usable_half = half_h - 10 - (th / 2) * sin - (self.side_tile_w / 2) * cos
        if usable_half <= 0:
            return full
        return min(full, (usable_half * 2) / ((count - 1) * cos))


OLD = Variant('before', 36, 7, (34, 22, 26), (2, 1, 2), 68, False, 86 / 68, 3,
              ai_layout=OLD_AI_LAYOUT)
NEW = Variant('after', 44, 9, (42, 28, 32), (3, 1, 2), 52, True, 1.27, 1,
              meld_matches_river=True, river_squash=1.0, side_river_inward=False, side_river_cols=7)

def resolve_layout(v, design_w, design_h):
    """复刻 _applyAdaptation + _applyLayout,返回内容坐标下的排版结果"""
    scale = design_w / CONTENT_W
    half_h = (design_h / 2) / scale

    riv_h = tile_h(v.river_w)
    top_tile_h = tile_h(v.top_tile_w)
    meld_h = tile_h(v.meld_width(0)) if not v.meld_matches_river else riv_h
    top_meld_h = tile_h(v.meld_width(1)) if not v.meld_matches_river else riv_h
    gap = MELD_MARK_GAP

    hand_y = -half_h + TILE_H / 2 + 8
    meld_y = hand_y + TILE_H / 2 + meld_h / 2 + gap
    disc_y = meld_y + meld_h / 2 + riv_h / 2 + gap

    top_hand_y = half_h - 8 - top_tile_h / 2
    top_meld_y = top_hand_y - top_tile_h / 2 - top_meld_h / 2 - gap
    top_disc_y = top_meld_y - top_meld_h / 2 - riv_h / 2 - gap
    # 临时提示(听牌/胡牌)给上家牌河让位几行
    info_y = top_disc_y - (riv_h + v.river_gap) * v.info_rows - riv_h / 2 - 24 - 22

    # 中央转盘半径: 上限 或 按上下弃牌河(各两行)之间的空隙自适应
    bottom_river_top = disc_y + v.river_squash_y * (riv_h + v.river_gap) + v.river_squash_y * riv_h / 2
    top_river_bottom = top_disc_y - (riv_h + v.river_gap) - riv_h / 2
    avail = min(-bottom_river_top, top_river_bottom) - 6
    v.disc_r = max(v.disc_r_min, min(v.disc_r_max, avail)) if v.disc_adaptive else v.disc_r_max

    return dict(scale=scale, half_h=half_h, riv_h=riv_h, meld_h=meld_h, top_meld_h=top_meld_h,
                hand_y=hand_y, meld_y=meld_y, disc_y=disc_y,
                top_hand_y=top_hand_y, top_meld_y=top_meld_y, top_disc_y=top_disc_y,
                info_y=info_y, disc_r=v.disc_r, tip=v.disc_r * v.tip_ratio)


# ===== 绘制 =====
def make_canvas(design_w, design_h):
    img = Image.new('RGB', (design_w, design_h), (24, 16, 10))
    return img


class Painter:
    def __init__(self, img, scale, design_w, design_h):
        self.d = ImageDraw.Draw(img, 'RGBA')
        self.scale = scale
        self.cx, self.cy = design_w / 2, design_h / 2

    def pt(self, x, y):
        return (self.cx + x * self.scale, self.cy - y * self.scale)

    def poly(self, pts, fill=None, outline=None, width=1):
        pix = [self.pt(x, y) for x, y in pts]
        self.d.polygon(pix, fill=fill, outline=outline, width=width)

    def circle(self, x, y, r, fill=None, outline=None, width=1):
        box = [self.pt(x - r, y + r), self.pt(x + r, y - r)]
        self.d.ellipse(box, fill=fill, outline=outline, width=width)

    def rect_rot(self, cx, cy, w, h, angle_deg, fill=None, outline=None, width=1):
        """以 (cx,cy) 为中心、旋转 angle_deg 的矩形"""
        a = math.radians(angle_deg)
        ca, sa = math.cos(a), math.sin(a)
        pts = []
        for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
            pts.append((cx + dx * ca - dy * sa, cy + dx * sa + dy * ca))
        self.poly(pts, fill=fill, outline=outline, width=width)


def draw_table(p, v):
    NEAR_HH, FAR_RATIO, FAR_HH = 560, 0.78, 530

    def trap(hwb, hh, fill=None, outline=None, width=1):
        hwt = hwb * FAR_RATIO
        hhf = hh * (FAR_HH / NEAR_HH)
        p.poly([(-hwb, -hh), (hwb, -hh), (hwt, hhf), (-hwt, hhf)], fill=fill, outline=outline, width=width)

    trap(824, 560, fill=(18, 10, 4, 200))
    trap(820, 556, fill=(54, 32, 16))
    trap(814, 550, fill=(124, 78, 42))
    trap(794, 534, fill=(156, 102, 56))
    trap(790, 530, fill=(64, 40, 22))
    trap(786, 526, fill=(28, 78, 50), outline=(15, 52, 32), width=2)
    trap(766, 514, outline=(60, 130, 80, 120))
    trap(460, 320, fill=(42, 102, 66), outline=(22, 72, 42))


def draw_disc(p, v, lay):
    R, tip = lay['disc_r'], lay['tip']
    p.circle(R * 0.022, -R * 0.022, R * 1.03, fill=(0, 0, 0, 70))
    p.circle(0, 0, R, fill=(168, 120, 52))
    p.circle(0, 0, R * 0.97, fill=(230, 192, 110))
    p.circle(0, 0, R * 0.91, fill=(38, 96, 64))
    p.circle(0, 0, R * 0.895, fill=(50, 114, 78))
    p.circle(0, 0, R * 0.73, fill=(244, 236, 219))
    p.circle(0, 0, R * 0.7, outline=(206, 172, 104))

    # 指针(朝下 = 自己出牌),几何同 drawTurnNeedle
    half, tail = R * 0.12, R * 0.34
    shoulder = tail + (tip - tail) * 0.3
    needle = [(0, tip), (half, shoulder), (half * 0.5, tail), (-half * 0.5, tail), (-half, shoulder)]
    a = math.radians(180)
    ca, sa = math.cos(a), math.sin(a)
    rot = [(x * ca - y * sa, x * sa + y * ca) for x, y in needle]
    p.poly(rot, fill=(44, 38, 34), outline=(232, 196, 118), width=2)
    p.circle(0, 0, R * 0.16, fill=(58, 34, 18), outline=(255, 226, 150), width=2)
    # 盘面高度基准线(便于判断是否被牌压住)
    return R


FACE = (248, 238, 210, 255)
FACE_EDGE = (168, 158, 130, 255)
BACK = (60, 90, 160, 255)
BACK_EDGE = (30, 50, 100, 255)


def seat_origin_angle(seat, v, lay):
    """某座位容器原点与旋转角"""
    if seat == 0:
        return (0.0, lay['hand_y']), 0.0
    if seat == 1:
        return (0.0, lay['top_hand_y']), 0.0
    hx, _, _ = v.ai_layout[seat - 1]
    angle = (90 - SIDE_EDGE_TILT) if seat == 2 else (SIDE_EDGE_TILT - 90)
    return (hx, 0.0), angle


def hand_tiles(seat, v, lay, count):
    """某家手牌每张牌的 (中心x, 中心y, 宽, 高, 旋转角)"""
    origin, angle = seat_origin_angle(seat, v, lay)
    if seat == 0:
        w, h, step = TILE_W, TILE_H, TILE_W + TILE_GAP
    elif seat == 1:
        w = v.top_tile_w
        h = tile_h(w)
        step = w + v.top_tile_gap
    else:
        w = v.side_tile_w
        h = tile_h(w)
        step = v.side_hand_step(lay, count)
    start = -((count - 1) * step) / 2
    a = math.radians(angle)
    ca, sa = math.cos(a), math.sin(a)
    out = []
    for i in range(count):
        lx = start + i * step
        out.append((origin[0] + lx * ca, origin[1] + lx * sa, w, h, angle))
    return out


def meld_tiles(seat, v, lay, groups=(4, 3)):
    """某家副露(吃/碰/杠)每张牌的 (中心x, 中心y, 宽, 高, 旋转角)"""
    if seat == 0:
        origin, angle = (0.0, lay['meld_y']), 0.0
    elif seat == 1:
        origin, angle = (0.0, lay['top_meld_y']), 0.0
    else:
        hx, _, _ = v.ai_layout[seat - 1]
        off = v.meld_offset if seat == 2 else -v.meld_offset
        origin = (hx + off, 0.0)
        angle = (90 - SIDE_EDGE_TILT) if seat == 2 else (SIDE_EDGE_TILT - 90)
    w = v.meld_width(seat)
    gap = v.meld_gap_of(seat)
    h = tile_h(w)
    squash = v.player_meld_squash() if seat == 0 else 1.0
    widths = [n * (w + gap) - gap for n in groups]
    group_gap = 8
    total = sum(widths) + (len(groups) - 1) * group_gap
    a = math.radians(angle)
    ca, sa = math.cos(a), math.sin(a)
    cursor = -total / 2
    out = []
    for gi, n in enumerate(groups):
        gw = widths[gi]
        start_x = cursor + gw / 2 - gw / 2 + w / 2
        for i in range(n):
            lx = start_x + i * (w + gap)
            out.append((origin[0] + lx * ca, origin[1] + lx * sa, w, h * squash, angle))
        cursor += gw + group_gap
    return out


def draw_hand(p, seat, v, lay, count, front=False):
    for cx, cy, w, h, ang in hand_tiles(seat, v, lay, count):
        p.rect_rot(cx, cy, w, h, ang,
                   fill=FACE if front else BACK, outline=FACE_EDGE if front else BACK_EDGE)


def river_tiles(seat, v, lay, count):
    """某家弃牌河每张牌在内容坐标下的 (中心x, 中心y, 宽, 高, 旋转角)"""
    w = v.river_w
    h = lay['riv_h']
    gap = v.river_gap
    cols = v.side_river_cols if seat >= 2 else v.river_cols
    step_x, step_y = w + gap, h + gap
    start_x = -cols * step_x / 2 + step_x / 2
    if seat == 0:                       # 自家: 向上堆(朝桌心)
        direction, origin, angle, squash = 1, (0.0, lay['disc_y']), 0.0, v.river_squash_y
    elif seat == 1:                     # 上家: 向下堆(朝桌心)
        direction, origin, angle, squash = -1, (0.0, lay['top_disc_y']), 0.0, 1.0
    else:                               # 左右家: 容器已旋转,行向沿桌面横轴
        # 两家容器旋转方向相反,但"容器局部 +y"在左家指向桌外、在右家也指向桌外,
        # 所以朝桌外都是 +1;朝桌心则是左家 -1、右家 +1
        inward = -1 if seat == 2 else 1
        direction = inward if v.side_river_inward else 1
        _, _, dx = v.ai_layout[seat - 1]
        angle = (90 - SIDE_EDGE_TILT) if seat == 2 else (SIDE_EDGE_TILT - 90)
        origin, squash = (dx, 0.0), 1.0
    a = math.radians(angle)
    ca, sa = math.cos(a), math.sin(a)
    out = []
    for i in range(count):
        col, row = i % cols, i // cols
        lx = start_x + col * step_x
        ly = direction * row * step_y * squash
        out.append((origin[0] + lx * ca - ly * sa, origin[1] + lx * sa + ly * ca, w, h * squash, angle))
    return out


def draw_river(p, seat, v, lay, count):
    for cx, cy, w, h, ang in river_tiles(seat, v, lay, count):
        p.rect_rot(cx, cy, w, h, ang, fill=FACE, outline=FACE_EDGE)


def draw_melds(p, seat, v, lay):
    for cx, cy, w, h, ang in meld_tiles(seat, v, lay):
        p.rect_rot(cx, cy, w, h, ang, fill=FACE, outline=FACE_EDGE)


def render(v, design_w, design_h, discards, filename):
    lay = resolve_layout(v, design_w, design_h)
    img = make_canvas(design_w, design_h)
    p = Painter(img, lay['scale'], design_w, design_h)
    draw_table(p, v)

    # 中央转盘
    R = draw_disc(p, v, lay)

    # 临时提示条(听牌/胡牌提示所在的一行,用半透明条示意位置与宽度)
    p.rect_rot(0, lay['info_y'], 520, 38, 0, fill=(255, 240, 180, 110))

    # 自家(下)
    draw_hand(p, 0, v, lay, 13, front=True)
    draw_melds(p, 0, v, lay)
    draw_river(p, 0, v, lay, discards)

    # 上家(顶部)
    draw_hand(p, 1, v, lay, 13)
    draw_melds(p, 1, v, lay)
    draw_river(p, 1, v, lay, discards)

    # 左右家
    for seat in (2, 3):
        draw_hand(p, seat, v, lay, 13)
        draw_melds(p, seat, v, lay)
        draw_river(p, seat, v, lay, discards)

    img.save(filename)
    return lay


def main():
    design_w, design_h = 2340, 1080        # 19.5:9 手机横屏
    report = []
    # 牌河张数: 14 = 两排(过半局的常见情况), 19 = 三排(残局)
    # 每张图都是"改前在上、改后在下"
    for discards, out in ((14, 'layout-preview.png'), (19, 'layout-preview-3rows.png')):
        panels = []
        for v in (OLD, NEW):
            f = f'tools/.preview-{v.name}-{discards}.png'
            lay = render(v, design_w, design_h, discards, f)
            panels.append(f)
            report.append((v.name, discards, lay))
        canvas = Image.new('RGB', (design_w, design_h * 2 + 8), (0, 0, 0))
        for i, f in enumerate(panels):
            canvas.paste(Image.open(f), (0, i * (design_h + 8)))
        canvas.save(out)
        # 中间产物只用于拼接,拼完即删
        for f in panels:
            os.remove(f)

    for name, discards, lay in report:
        v = OLD if name == 'before' else NEW
        print(f'[{name}] 弃牌 {discards} 张: 可见半高={lay["half_h"]:.1f} '
              f'盘半径={lay["disc_r"]:.1f} 弃牌河牌宽={v.river_w} '
              f'副露牌宽(自己/上家/左右)={[v.meld_width(s) for s in range(4)]}')


if __name__ == '__main__':
    main()
