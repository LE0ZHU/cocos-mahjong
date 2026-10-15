"""
排版核对(逐张牌做几何校验)

1) 中央转盘与上下弃牌河之间的空隙(按不同屏幕比例)
2) 四家所有牌(手牌 / 副露 / 弃牌河)两两之间是否重叠 —— 用分离轴定理算真矩形相交
3) 所有牌是否都在可见范围内(不被屏幕裁掉)

用法: python tools/check-layout-fit.py
"""
import importlib.util
import math

spec = importlib.util.spec_from_file_location("pv", "tools/preview-layout.py")
pv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv)

ASPECTS = [
    ("16:9   1920x1080", 1920, 1080),
    ("19.5:9 2340x1080", 2340, 1080),
    ("20:9   2400x1080", 2400, 1080),
    ("21:9   2520x1080", 2520, 1080),
    ("4:3    1440x1080", 1440, 1080),
]

# 每家最多弃 21 张: 牌墙 136 - 起手 13×4 = 84 张,四家各摸 21 次、每次最多弃 1 张。
# 这是硬上限(吃碰杠只会让手牌变短、弃牌更少),所以按 21 张校验就够。
MAX_DISCARDS = 21
HAND_TILES = 13
MELD_GROUPS = (4, 3)   # 一个杠(4张) + 一个碰(3张)


def solve(v, w, h):
    aw = max(1920, round(1080 * w / h))
    ah = max(1080, round(1920 * h / w))
    return pv.resolve_layout(v, aw, ah), ah


def rect_poly(r):
    cx, cy, w, h, ang = r
    a = math.radians(ang)
    ca, sa = math.cos(a), math.sin(a)
    return [(cx + dx * ca - dy * sa, cy + dx * sa + dy * ca)
            for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]


def overlap(a, b):
    for poly in (a, b):
        n = len(poly)
        for i in range(n):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % n]
            nx, ny = -(y2 - y1), (x2 - x1)
            pa = [p[0] * nx + p[1] * ny for p in a]
            pb = [p[0] * nx + p[1] * ny for p in b]
            if max(pa) <= min(pb) or max(pb) <= min(pa):
                return False
    return True


def all_rects(v, lay, discards):
    """四家所有牌: 键 (seat, kind) → [rect]"""
    out = {}
    for seat in range(4):
        out[(seat, '手牌')] = pv.hand_tiles(seat, v, lay, HAND_TILES)
        out[(seat, '副露')] = pv.meld_tiles(seat, v, lay, MELD_GROUPS)
        out[(seat, '牌河')] = pv.river_tiles(seat, v, lay, discards)
    return out


print("== 1. 中央转盘 vs 上下弃牌河(各两行)的空隙 ==")
print("screen               halfH  |  oldR  oldClear  |  newR  newClear  verdict")
for name, w, h in ASPECTS:
    cells, half_h = [], 0.0
    for v in (pv.OLD, pv.NEW):
        lay, _ = solve(v, w, h)
        half_h = lay["half_h"]
        riv, sq = lay["riv_h"], v.river_squash_y
        bottom_river_top = lay["disc_y"] + sq * (riv + 2) + sq * riv / 2
        top_river_bottom = lay["top_disc_y"] - (riv + 2) - riv / 2
        cells.append((lay["disc_r"], min(-bottom_river_top, top_river_bottom) - lay["disc_r"]))
    verdict = "OK" if cells[1][1] > 0 else "OVERLAP"
    print(f"{name}  {half_h:6.1f}  | {cells[0][0]:5.1f} {cells[0][1]:8.1f}  | "
          f"{cells[1][0]:5.1f} {cells[1][1]:8.1f}  {verdict}")

print()
print("== 2. 四家所有牌两两重叠检查(弃牌 1→21 张逐张扫) ==")
print("screen             variant   首次重叠")
for name, w, h in ASPECTS:
    for label, v in (("before", pv.OLD), ("after ", pv.NEW)):
        lay, _ = solve(v, w, h)
        worst, detail = None, ""
        for count in range(1, MAX_DISCARDS + 1):
            rects = {k: [rect_poly(r) for r in rs] for k, rs in all_rects(v, lay, count).items()}
            keys = sorted(rects)
            for i, ka in enumerate(keys):
                # 只比不同元素;同一组内部(例如侧边手牌按可见高度压缩后牌背略微叠压)是设计如此
                for kb in keys[i + 1:]:
                    for ra in rects[ka]:
                        for rb in rects[kb]:
                            if overlap(ra, rb):
                                worst, detail = count, f"{ka} × {kb}"
                                break
                        if worst:
                            break
                    if worst:
                        break
                if worst:
                    break
            if worst:
                break
        got = f"{worst} 张时 {detail}" if worst else f"无(到 {MAX_DISCARDS} 张)"
        print(f"{name}  {label}   {got}")

print()
print("== 3. 是否被屏幕裁掉(可见半高/半宽) ==")
print("screen             variant   手牌/副露/牌河出屏情况")
for name, w, h in ASPECTS:
    aw = max(1920, round(1080 * w / h))
    for label, v in (("before", pv.OLD), ("after ", pv.NEW)):
        lay, ah = solve(v, w, h)
        half_h, half_w = lay["half_h"], pv.CONTENT_W / 2
        worst = 0.0
        where = "-"
        for count in (MAX_DISCARDS,):
            for key, rs in all_rects(v, lay, count).items():
                for r in rs:
                    for x, y in rect_poly(r):
                        over = max(abs(y) - half_h, abs(x) - half_w, 0)
                        if over > worst:
                            worst, where = over, f"{key}"
        got = f"超出 {worst:.1f}px ({where})" if worst > 0.5 else "全部在屏内"
        print(f"{name}  {label}   {got}")
