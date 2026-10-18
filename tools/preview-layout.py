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
from PIL import Image, ImageDraw, ImageFont

# ===== Main.ts 中与尺寸无关的常量 =====
CONTENT_W = 1680
BASE_W, BASE_H = 1920, 1080
TILE_H_RATIO = 4 / 3             # 所有牌统一宽高比 3:4(与 Main.ts 一致)
TILE_W, TILE_H, TILE_GAP = 63, 84, 3          # 牌基准(手牌另乘 HAND_SCALE)
# 镜像 UIFactory: 牌节点比格位缩 TILE_GAP; 三家手牌格位只有 32~34 宽, 用更窄的 TILE_GAP_THIN
TILE_GAP_THIN = 1.5
# 镜像 Main: 手牌倍率由「你·听」标记反算(下限 1.13 / 目标 1.45);
# 其他牌(三家手牌 / 牌河 / 副露)乘 OTHERS_SCALE(1.0 = 与基准同大, 4:3 净空天花板)
HAND_SCALE_MIN, HAND_SCALE_TARGET = 1.13, 1.45
HAND_EDGE_GAP = 12
OTHERS_SCALE = 1.0
TENPAI_MARK_INSET, TENPAI_MARK_W = 70, 112
MARK_INNER = (CONTENT_W / 2 - TENPAI_MARK_INSET) - TENPAI_MARK_W / 2 - HAND_EDGE_GAP
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

# ===== 弃牌河列数 / 侧家牌河 x(镜像 Main.RIVER_COLS / SIDE_RIVER_COLS / _sideRiverX) =====
RIVER_COLS = 9
SIDE_RIVER_COLS = 7
SIDE_RIVER_GAP = 30        # 侧家牌河内缘 ↔ 上下牌河外沿的横向净空
SIDE_RIVER_X_MAX = 340     # 老位置 = 上限: 反推出来更大时保持原位(只许往桌心靠)


def side_river_x(riv_w, riv_h):
    """镜像 Main._sideRiverX: 侧家牌河容器 x(正数)。

    侧家那块是斜着摆的, 最靠桌心的不是容器原点而是内角, 探出量 =
    (半排长 + 半张牌宽) × sin(tilt) + 半张牌高 × cos(tilt)。
    """
    tilt = math.radians(SIDE_EDGE_TILT)
    overhang = (((SIDE_RIVER_COLS - 1) * riv_w) / 2 + riv_w / 2) * math.sin(tilt) \
        + riv_h / 2 * math.cos(tilt)
    return min(SIDE_RIVER_X_MAX, RIVER_COLS * riv_w / 2 + SIDE_RIVER_GAP + overhang)


def side_river_inner(riv_w, riv_h, x=None):
    """侧家牌河内缘到桌心的距离(用于算它和上下牌河之间的真实净空)

    x=None 表示按 _sideRiverX 反推; 给数字表示写死(出"改前"对照图时用)。
    """
    tilt = math.radians(SIDE_EDGE_TILT)
    overhang = (((SIDE_RIVER_COLS - 1) * riv_w) / 2 + riv_w / 2) * math.sin(tilt) \
        + riv_h / 2 * math.cos(tilt)
    return (side_river_x(riv_w, riv_h) if x is None else x) - overhang



def tile_h(w):
    return w * TILE_H_RATIO


class Variant:
    """一套牌桌尺寸参数"""

    def __init__(self, name, river_w, river_cols, meld_w, meld_gap, disc_r_max, disc_adaptive, tip_ratio,
                 info_rows, meld_matches_river=False, meld_squash=0.85, river_squash=0.82,
                 side_river_inward=True, disc_r_min=30, side_river_cols=None,
                 top_tile_w=32, top_tile_gap=2, side_tile_w=38, side_tile_gap=3,
                 ai_layout=None, meld_offset=70, side_step_adaptive=False,
                 side_river_x=None):
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
        # None = 按 Main._sideRiverX 反推; 给数字 = 写死(用来出"改前"对照图)
        self.side_river_x = side_river_x

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
        tk = lay.get('tile_k', 1.0)
        full = (self.side_tile_w + self.side_tile_gap) * tk
        half_h = lay['half_h']
        if not self.side_step_adaptive or half_h <= 0 or count <= 1:
            return full
        tilt = math.radians(SIDE_EDGE_TILT)
        cos, sin = math.cos(tilt), math.sin(tilt)
        th = tile_h(self.side_tile_w * tk)
        usable_half = half_h - 10 - (th / 2) * sin - (self.side_tile_w * tk / 2) * cos
        if usable_half <= 0:
            return full
        return min(full, (usable_half * 2) / ((count - 1) * cos))


# ===== 桌面几何与"牌能摆多高"(镜像 Main.ts 的 TABLE_* / FELT_TILE_HALF) =====
TABLE_FAR_HH = 530
FELT_TILE_TOP = 492       # 毡布上沿 497.75 再留 6
FELT_TILE_BOTTOM = 520    # 毡布下沿 -526 再留 6

# ===== 牌尺寸的屏幕比例适配(镜像 Main._applyTileScale) =====
TILE_REF_HALF_H = 472.5   # 牌尺寸 1:1 的基准可见半高(= 16:9 的 840 × 9/16)
TILE_SCALE_MAX = 1.4      # 上限: 卡在"9 张牌河不撞左右家牌河"上(见 Main.TILE_SCALE_MAX)


def tile_scale(half_h):
    """镜像 Main._applyTileScale: 手机(≥16:9)恒为 1, 平板按可见高度等比放大"""
    return max(1.0, min(TILE_SCALE_MAX, half_h / TILE_REF_HALF_H))


def table_scale(half_h):
    """镜像 Main._applyTableScale: 屏幕比 16:9 更方时桌面按比例放大, 永远比可见区大一圈"""
    return max(1.0, (half_h + 10) / TABLE_FAR_HH)


OLD = Variant('before', 36, 7, (34, 22, 26), (2, 1, 2), 68, False, 86 / 68, 3,
              ai_layout=OLD_AI_LAYOUT)
NEW = Variant('after', 44, 9, (42, 28, 32), (3, 1, 2), 52, True, 1.27, 1,
              meld_matches_river=True, river_squash=1.0, side_river_inward=False, side_river_cols=7)
# 当前 Main.ts 的真实参数(上家牌 36 宽、牌间距 0、副露同牌河), 专门给平板适配对照用
CURRENT = Variant('current', 44, 9, (44, 44, 44), (0, 0, 0), 52, True, 1.27, 1,
                  meld_matches_river=True, river_squash=1.0, side_river_inward=False,
                  side_river_cols=7, top_tile_w=36, top_tile_gap=0, side_tile_gap=0)

def resolve_layout(v, design_w, design_h):
    """复刻 _applyAdaptation + _applyLayout,返回内容坐标下的排版结果"""
    scale = design_w / CONTENT_W
    half_h = (design_h / 2) / scale
    k = table_scale(half_h)
    # 牌尺寸也跟着可见高度放大(平板), 否则牌相对被放大的桌面会明显偏小;
    # 自家手牌再乘 HAND_SCALE, 三家 AI / 牌河 / 副露都只看 tk
    tk = tile_scale(half_h)
    hs = max(HAND_SCALE_MIN, min(HAND_SCALE_TARGET, MARK_INNER / (7 * TILE_W * tk)))
    tile_w, tile_h_full = TILE_W * tk * hs, TILE_H * tk * hs
    # 牌位可用半高: 屏幕越方, 可见半高越大, 但桌面只有那么大 —— 必须夹住, 否则牌摆到桌外。
    # 毡布上下不对称(近端更低), 所以上下各夹一次
    top_half = min(half_h, FELT_TILE_TOP * k)
    bottom_half = min(half_h, FELT_TILE_BOTTOM * k)

    riv_w = v.river_w * tk * OTHERS_SCALE
    top_w = v.top_tile_w * tk * OTHERS_SCALE
    riv_h = tile_h(riv_w)
    top_tile_h = tile_h(top_w)
    meld_h = tile_h(v.meld_width(0) * tk) if not v.meld_matches_river else riv_h
    top_meld_h = tile_h(v.meld_width(1) * tk) if not v.meld_matches_river else riv_h
    gap = MELD_MARK_GAP

    hand_y = -bottom_half + tile_h_full / 2 + 8
    meld_y = hand_y + tile_h_full / 2 + meld_h / 2 + gap
    disc_y = meld_y + meld_h / 2 + riv_h / 2 + gap

    top_hand_y = top_half - 8 - top_tile_h / 2
    top_meld_y = top_hand_y - top_tile_h / 2 - top_meld_h / 2 - gap
    top_disc_y = top_meld_y - top_meld_h / 2 - riv_h / 2 - gap
    # 临时提示(听牌/胡牌)给上家牌河让位几行
    info_y = top_disc_y - (riv_h + v.river_gap) * v.info_rows - riv_h / 2 - 24 - 22

    # 中央转盘半径: 上限 或 按上下弃牌河(各两行)之间的空隙自适应
    bottom_river_top = disc_y + v.river_squash_y * (riv_h + v.river_gap) + v.river_squash_y * riv_h / 2
    top_river_bottom = top_disc_y - (riv_h + v.river_gap) - riv_h / 2
    avail = min(-bottom_river_top, top_river_bottom) - 6
    v.disc_r = max(v.disc_r_min, min(v.disc_r_max, avail)) if v.disc_adaptive else v.disc_r_max

    return dict(scale=scale, half_h=half_h, top_half=top_half, bottom_half=bottom_half,
                table_k=k, tile_k=tk, tile_w=tile_w, tile_h=tile_h_full,
                top_tile_w=top_w, side_tile_w=v.side_tile_w * tk * OTHERS_SCALE, river_w=riv_w,
                riv_h=riv_h, meld_h=meld_h, top_meld_h=top_meld_h,
                hand_y=hand_y, meld_y=meld_y, disc_y=disc_y,
                top_hand_y=top_hand_y, top_meld_y=top_meld_y, top_disc_y=top_disc_y,
                info_y=info_y, disc_r=v.disc_r, tip=v.disc_r * v.tip_ratio,
                side_river_x=side_river_x(riv_w, riv_h))


# ===== 绘制 =====
def make_canvas(design_w, design_h):
    # 必须 RGBA: 桌面的暗角/高光是半透明描边, RGB 画布无法 alpha 合成
    img = Image.new('RGBA', (design_w, design_h), (24, 16, 10, 255))
    return img


class Painter:
    def __init__(self, img, scale, design_w, design_h):
        self.img = img            # 合成半透明描边时要用到底图本身
        self.d = ImageDraw.Draw(img, 'RGBA')
        self.scale = scale
        self.cx, self.cy = design_w / 2, design_h / 2

    def pt(self, x, y):
        return (self.cx + x * self.scale, self.cy - y * self.scale)

    def poly(self, pts, fill=None, outline=None, width=1):
        """填充/描边多边形。

        描边必须**逐层混合**: PIL 的 RGBA 画笔不会自动与已有像素混合,
        直接把半透明色当不透明画上去, 暗角/高光会变成纯白或纯黑边,
        预览就会骗人(曾据此误判"桌面多了一圈白边")。
        """
        pix = [self.pt(x, y) for x, y in pts]
        if fill:
            self.d.polygon(pix, fill=fill)
        if outline:
            r, g_, b, a = (outline + (255,))[:4] if len(outline) == 4 else (*outline, 255)
            # PIL 的 RGBA 画笔**不会**与底图混合: 直接把半透明色画上去会变成实色,
            # 暗角/高光会渲染成纯黑或纯白边, 预览因此骗人。
            # 正确做法: 透明图层上画线 → alpha_composite 合成回底图。
            w = max(1, int(width))
            pad = w + 2
            box = [
                min(p[0] for p in pix) - pad, min(p[1] for p in pix) - pad,
                max(p[0] for p in pix) + pad, max(p[1] for p in pix) + pad,
            ]
            layer = Image.new('RGBA', (int(box[2] - box[0]), int(box[3] - box[1])), (0, 0, 0, 0))
            ld = ImageDraw.Draw(layer)
            shifted = [(p[0] - box[0], p[1] - box[1]) for p in pix]
            ld.line(shifted + [shifted[0]], fill=(r, g_, b, a), width=w, joint='curve')
            self.img.alpha_composite(layer, dest=(int(box[0]), int(box[1])))
            self.d = ImageDraw.Draw(self.img, 'RGBA')

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


def draw_table(p, v, k=1.0):
    """镜像 Main.ts 的 _buildTable()。

    桌面倒角/毡布用横向色带做光照渐变(远端受光偏亮、近端沉暗),
    台面不再有平涂浅绿色块。改 Main.ts 时必须同步改这里, 否则预览会骗人。

    k = 桌面整体缩放(镜像 Main._applyTableScale): 所有梯形尺寸连同线宽一起乘 k。
    """
    NEAR_HH, FAR_RATIO, FAR_HH = 560, 0.78, 530

    def trap(hwb, hh, fill=None, outline=None, width=1):
        hwb, hh, width = hwb * k, hh * k, width * k
        hwt = hwb * FAR_RATIO
        hhf = hh * (FAR_HH / NEAR_HH)
        p.poly([(-hwb, -hh), (hwb, -hh), (hwt, hhf), (-hwt, hhf)], fill=fill, outline=outline, width=width)

    def trap_bands(hwb, hh, col_far, col_near, bands=72):
        """在梯形内画横向色带, 由远及近插值 —— 光照渐变"""
        hwb, hh = hwb * k, hh * k
        hwt = hwb * FAR_RATIO
        hhf = hh * (FAR_HH / NEAR_HH)
        band_h = (hh + hhf) / bands
        for i in range(bands):
            t = i / (bands - 1)
            y_top = hhf - (i + 1) * band_h
            y_bot = hhf - i * band_h
            col = tuple(int(round(col_far[k] + (col_near[k] - col_far[k]) * t)) for k in range(3))
            w_top = hwb + (hwt - hwb) * ((y_top + hh) / (hh + hhf))
            w_bot = hwb + (hwt - hwb) * ((y_bot + hh) / (hh + hhf))
            p.poly([(-w_bot, y_bot), (w_bot, y_bot), (w_top, y_top), (-w_top, y_top)], fill=col)

    trap(824, 560, fill=(18, 10, 4, 200))
    trap(820, 556, fill=(54, 32, 16))
    trap_bands(814, 550, (158, 104, 58), (104, 64, 34))
    trap(804, 544, outline=(52, 30, 14), width=2)
    trap(800, 540, outline=(186, 132, 78), width=1)
    trap(794, 534, fill=(150, 98, 54))
    trap(790, 530, fill=(58, 36, 20))
    # 毡布色相 ~135° 正绿(去青); 转盘盘身同色系, 两处必须与 Main.ts 保持同步
    trap_bands(786, 526, (36, 72, 45), (19, 42, 26))
    trap(786, 526, outline=(12, 28, 22), width=2)
    # 四边暗角: 绒布被木框挡光后的自然阴影, 平涂色块没有这个会显得"贴"在框上
    # lineWidth 是像素单位(与 Cocos 一致), 画粗会变黑边
    trap(776, 521, outline=(0, 0, 0, 52), width=14)
    trap(779, 523, outline=(0, 0, 0, 44), width=6)
    # 只勾一圈细边, 不再有平涂浅绿色块
    trap(768, 515, outline=(132, 158, 124))


def draw_disc(p, v, lay):
    R, tip = lay['disc_r'], lay['tip']
    p.circle(R * 0.022, -R * 0.022, R * 1.03, fill=(0, 0, 0, 70))
    p.circle(0, 0, R, fill=(168, 120, 52))
    p.circle(0, 0, R * 0.97, fill=(230, 192, 110))
    p.circle(0, 0, R * 0.91, fill=(41, 98, 57))
    p.circle(0, 0, R * 0.895, fill=(53, 116, 71))
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


FACE = (255, 255, 255, 255)      # 牌身底色 = 牌面图片白底(无边框, 与 Main.ts 一致)
FACE_EDGE = (255, 255, 255, 255)  # 牌身已不画描边, 与底色同色
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
    # 游戏里格位间距恒等于牌宽, 相邻两张的缝靠"节点比格位缩一圈"实现;
    # 所以这里 step 用格位宽、画出来的牌面减去 gap, 才和真机一致
    if seat == 0:
        w, h, step, gap = lay['tile_w'], lay['tile_h'], lay['tile_w'], TILE_GAP
    elif seat == 1:
        w = lay['top_tile_w']
        h = tile_h(w)
        step, gap = w + v.top_tile_gap, TILE_GAP_THIN
    else:
        w = lay['side_tile_w']
        h = tile_h(w)
        step, gap = v.side_hand_step(lay, count), TILE_GAP_THIN
    start = -((count - 1) * step) / 2
    a = math.radians(angle)
    ca, sa = math.cos(a), math.sin(a)
    out = []
    for i in range(count):
        lx = start + i * step
        out.append((origin[0] + lx * ca, origin[1] + lx * sa, w - gap, h - gap, angle))
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
    w = v.meld_width(seat) * lay['tile_k']
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
    w = lay['river_w']
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
        # x 不再取 AI_LAYOUT 里写死的 340, 而是按牌尺寸反推(镜像 Main._sideRiverX)
        dx = v.side_river_x if v.side_river_x is not None else lay['side_river_x']
        angle = (90 - SIDE_EDGE_TILT) if seat == 2 else (SIDE_EDGE_TILT - 90)
        origin, squash = (-dx if seat == 2 else dx, 0.0), 1.0
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
    draw_table(p, v, lay['table_k'])

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


# ===== 平板适配对照(3:2 / 4:3) =====
FELT_NEAR_Y, FELT_FAR_Y = -526.0, 526.0 * (530 / 560)    # 毡布梯形上下沿(桌面坐标)


def felt_half_width(y_table):
    """毡布在桌面坐标 y 处的半宽(与 _buildTable 的梯形一致)"""
    near_w, far_w = 786.0, 786.0 * 0.78
    t = (y_table - FELT_NEAR_Y) / (FELT_FAR_Y - FELT_NEAR_Y)
    return near_w + (far_w - near_w) * t


def _corners(cx, cy, w, h, ang):
    """矩形四角(与 Painter.rect_rot 同一套旋转约定)"""
    a = math.radians(ang)
    ca, sa = math.cos(a), math.sin(a)
    return [(cx + dx * ca - dy * sa, cy + dx * sa + dy * ca)
            for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]


def check_fit(lay, discards=14):
    """所有牌是否有角跑到毡布外: 返回 (最大溢出px, 出处; <=0 表示全在桌上)"""
    k = lay['table_k']
    worst, where = -1e9, '全部在桌上'
    for seat in range(4):
        for cx, cy, w, h, ang in (hand_tiles(seat, CURRENT, lay, 13)
                                  + river_tiles(seat, CURRENT, lay, discards)
                                  + meld_tiles(seat, CURRENT, lay)):
            for x, y in _corners(cx, cy, w, h, ang):
                ty, tx = y / k, x / k
                if ty > FELT_FAR_Y:
                    over = (ty - FELT_FAR_Y) * k
                elif ty < FELT_NEAR_Y:
                    over = (FELT_NEAR_Y - ty) * k
                else:
                    over = (abs(tx) - felt_half_width(ty)) * k
                if over > worst:
                    worst, where = over, f'seat{seat} @({x:.0f},{y:.0f})'
    return worst, where


def edge_margins(lay):
    """上家手牌上沿 / 自家手牌下沿 到毡布上下沿的余量(屏幕像素)"""
    k = lay['table_k']
    top_h = tile_h(lay['top_tile_w']) / 2
    top = (FELT_FAR_Y - (lay['top_hand_y'] + top_h) / k) * k
    bottom = lay['hand_y'] - lay['tile_h'] / 2 - FELT_NEAR_Y * k
    return top, bottom


def main_tablet():
    """平板(3:2)与 iPad(4:3)的适配对照: 桌面是否溢出屏幕、牌是否还在桌上"""
    cases = [('16:9 参照 (1680x945)', 1680, 945),
             ('3:2 平板 (1680x1120)', 1680, 1120),
             ('4:3 iPad (1680x1260)', 1680, 1260)]
    f_label = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 22)
    rows = []
    for label, dw, dh in cases:
        f = f'tools/.preview-aspect-{dh}.png'
        lay = render(CURRENT, dw, dh, 14, f)
        over, where = check_fit(lay)
        top_m, bot_m = edge_margins(lay)
        print(f'[{label}] 可见半高={lay["half_h"]:.0f} 桌面缩放={lay["table_k"]:.3f} '
              f'牌倍率={lay["tile_k"]:.3f}({lay["tile_w"]:.0f}x{lay["tile_h"]:.0f}) '
              f'牌位半高={lay["top_half"]:.0f}/{lay["bottom_half"]:.0f} 盘半径={lay["disc_r"]:.0f} | '
              f'上沿余量={top_m:.1f} 下沿余量={bot_m:.1f} | 越界={over:+.1f}px {where}')
        img = Image.open(f).convert('RGB')
        os.remove(f)
        rows.append((label, img))

    scale = 0.5
    gap, pad_top = 12, 34
    panels = [(t, im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS))
              for t, im in rows]
    tw = max(im.width for _, im in panels) + gap * 2
    th = sum(im.height + pad_top + gap for _, im in panels)
    out = Image.new('RGB', (tw, th), (18, 20, 24))
    d = ImageDraw.Draw(out)
    y = gap
    for title, im in panels:
        d.text((gap, y), title, font=f_label, fill=(232, 236, 240))
        out.paste(im, (gap, y + pad_top))
        y += im.height + pad_top + gap
    out.save('tablet-preview.png')
    print('saved tablet-preview.png', out.size)


def main_side():
    """左右家牌河"往桌心靠": 改前(写死 340) / 改后(按牌尺寸反推)对照

    弃牌取 21 张(= 三排)是最坏情况: 侧家那块纵向最长, 与上下牌河的重叠带最宽,
    也最靠桌心。图里要确认两件事: 两块牌河之间**没有叠**, 且看得出是两堆。
    """
    cases = [('16:9 手机 (1680x945)', 1680, 945),
             ('4:3 iPad (1680x1260)', 1680, 1260)]
    f_label = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 22)
    rows = []
    for label, dw, dh in cases:
        for tag, fixed in (('改前 写死 340', 340.0), ('改后 反推', None)):
            v = Variant('side', 44, 9, (44, 44, 44), (0, 0, 0), 52, True, 1.27, 1,
                        meld_matches_river=True, river_squash=1.0, side_river_inward=False,
                        side_river_cols=7, top_tile_w=36, top_tile_gap=0, side_tile_gap=0,
                        side_river_x=fixed)
            f = f'tools/.preview-side-{dh}-{tag[:2]}.png'
            lay = render(v, dw, dh, 21, f)
            riv_w, riv_h = lay['river_w'], lay['riv_h']
            x = fixed if fixed is not None else lay['side_river_x']
            inner = side_river_inner(riv_w, riv_h, fixed)
            gap = inner - RIVER_COLS * riv_w / 2
            print(f'[{label} | {tag}] 牌宽={riv_w:.0f} 侧家牌河 x={x:.0f} '
                  f'内缘={inner:.0f} 上下牌河外沿={RIVER_COLS * riv_w / 2:.0f} 净空={gap:+.0f}px')
            img = Image.open(f).convert('RGB')
            os.remove(f)
            rows.append((f'{label} | {tag} (净空 {gap:+.0f}px)', img))

    scale = 0.5
    gap_px, pad_top = 12, 30
    panels = [(t, im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS))
              for t, im in rows]
    tw = max(im.width for _, im in panels) + gap_px * 2
    th = sum(im.height + pad_top + gap_px for _, im in panels)
    out = Image.new('RGB', (tw, th), (18, 20, 24))
    d = ImageDraw.Draw(out)
    y = gap_px
    for title, im in panels:
        d.text((gap_px, y), title, font=f_label, fill=(232, 236, 240))
        out.paste(im, (gap_px, y + pad_top))
        y += im.height + pad_top + gap_px
    out.save('side-river-preview.png')
    print('saved side-river-preview.png', out.size)


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
            canvas.paste(Image.open(f).convert('RGB'), (0, i * (design_h + 8)))
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
    import sys
    if '--tablet' in sys.argv:
        main_tablet()
    elif '--side' in sys.argv:
        main_side()
    else:
        main()
