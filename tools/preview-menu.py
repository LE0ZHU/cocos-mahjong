"""
菜单内容页预览(主菜单 / 设置规则 / 玩法说明) —— 从真实源码镜像常量与文案

改 MenuUI 的 `RULES_*` / `HELP_*` 常量、文案, 或改 HuScore 的 `FAN_DEFS` 后跑这个出图:
  1) 各段会不会压在上一段上(游标写错是硬约束 3 的老毛病)
  2) 内容比视口高多少(滚动量)、首屏第一行是否完整可见
  3) 番型表 / 选项按钮的文字会不会超出各列宽度被 SHRINK 压扁
  4) 阅读底板(遮罩)与滚动指示条的位置

【关键: 内容画在离屏图上再裁进视口】真机的滚动内容被 Mask 裁掉,
预览如果直接把整段画出来就会"显示"出真机上根本看不到的部分 —— 那是骗人的。
所以内容先画在按内容高度开的离屏图上, 再按滚动位置裁一块贴进视口。

用法: python tools/preview-menu.py
输出: menu-home-preview.png / rules-preview.png / help-preview.png / help-preview-portrait.png
"""
import os
import re

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

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
        return ImageFont.truetype(_FONT_PATH, max(8, int(round(size))))
    except Exception:
        return None


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


MENU = read('assets/scripts/ui/MenuUI.ts')
SCORE = read('assets/scripts/core/HuScore.ts')

_cache = {}


def const(name):
    """提取 const X = n / readonly X = n / 表达式常量(递归求值)"""
    if name in _cache:
        return _cache[name]
    m = re.search(r'const\s+%s\s*(?::[^=]*)?=\s*([^;\n]+);' % name, MENU)
    if not m:
        raise KeyError('找不到常量 ' + name)
    expr = m.group(1).strip()
    if re.fullmatch(r'-?[\d.]+', expr):
        v = float(expr)
    else:
        scope = {}
        for ref in re.findall(r'[A-Z][A-Z0-9_]*', expr):
            if ref == name:
                continue
            try:
                scope[ref] = const(ref)
            except KeyError:
                pass
        v = float(eval(expr, {}, scope))
    _cache[name] = v
    return v


def joined_str(name):
    """跨行拼接的字符串常量(如 RULES_TIPS_TEXT)

    【坑】不能取"第一个分号"——文案里就有分号, 会截断。要取**行尾那个分号**;
    另外源码里的 \\n 是转义写法, 解析出来要还原成真换行。
    """
    i = MENU.index('const %s = ' % name)
    m = re.search(r"const %s = ([\s\S]*?);\n" % name, MENU[i:])
    if not m:
        raise KeyError('解析不到常量 ' + name)
    parts = re.findall(r"'([^']*)'", m.group(1))
    return ''.join(parts).replace('\\n', '\n')


def parse_sections():
    start = MENU.index('export const HELP_SECTIONS')
    end = MENU.index('\n];', start)
    out, cur = [], None
    for raw in MENU[start:end].split('\n'):
        line = raw.strip()
        t = re.fullmatch(r"title: '(.+)',", line)
        if t:
            cur = [t.group(1), [], False]
            out.append(cur)
            continue
        if cur is None:
            continue
        if line == 'fanTable: true,':
            cur[2] = True
            continue
        s = re.fullmatch(r"'(.+)',", line)
        if s:
            cur[1].append(s.group(1))
    return out


def parse_groups():
    """解析 _buildRulesPage 的选项组(键 / 标题 / 说明 / 选项标签)"""
    groups = []
    for block in re.findall(r'_buildChoiceGroup\(host, \{[\s\S]*?\n        \}\);', MENU):
        cap = re.search(r"caption: '([^']+)'", block)
        hint = re.search(r"hint: '([^']+)'", block)
        opt = re.search(r'options: ([A-Z_]+)', block)
        labels = []
        if opt:
            m = re.search(r'const %s: ChoiceOption\[\] = \[([\s\S]*?)\];' % opt.group(1), MENU)
            if m:
                labels = re.findall(r"label: '([^']+)'", m.group(1))
        groups.append({
            'caption': cap.group(1) if cap else '?',
            'hint': hint.group(1) if hint else '',
            'labels': labels,
        })
    return groups


def parse_home():
    def one(pattern, default=None):
        m = re.search(pattern, MENU)
        return float(m.group(1)) if m else default
    return {
        'title_y': one(r"title\.setPosition\(0, (-?\d+), 0\)"),
        'sub_y': one(r"sub\.setPosition\(0, (-?\d+), 0\)"),
        'start_y': one(r"startBtn\.setPosition\(0, (-?\d+), 0\)"),
        'start_w': one(r"createButtonNode\('开始游戏', (\d+)"),
        'start_h': one(r"createButtonNode\('开始游戏', \d+, (\d+)"),
        'sec_w': one(r'const secBtnW = (\d+)'),
        'sec_gap': one(r'const secBtnGap = (\d+)'),
        'row_y': one(r"rulesBtn\.setPosition\(-secBtnX, (-?\d+), 0\)"),
        'sec_h': one(r"createButtonNode\('设置规则', secBtnW, (\d+)"),
        'sum_y': one(r"summary\.setPosition\(0, (-?\d+), 0\)"),
        'tip_y': one(r"tip\.setPosition\(0, (-?\d+), 0\)"),
    }


def parse_fan_defs():
    rows = re.findall(r"\{ name: '([^']+)', fan: (\d+), desc: '([^']+)' \}", SCORE)
    streak = int(re.search(r'export const STREAK_FAN_MAX = (\d+);', SCORE).group(1))
    return [(n, int(f), d) for n, f, d in rows] + [('连庄', streak, '连续胡牌第 N 次 +（N−1）番')]


# ---- 常量 ----
MENU_W = const('MENU_CONTENT_W')
MENU_H = const('MENU_CONTENT_H')
TOP_Y = const('RULES_TOP_Y')
TOP_BTN_H = const('RULES_TOP_BTN_H')
BACK_X = const('RULES_BACK_X')
PAGE_W = const('PAGE_VIEW_W')
VIEW_TOP_GAP = const('PAGE_VIEW_TOP_GAP')
BAR_W = const('SCROLL_BAR_W')
BAR_RIGHT = const('SCROLL_BAR_RIGHT')
BAR_PAD = const('SCROLL_BAR_PAD')
BAR_MIN_H = const('SCROLL_BAR_MIN_H')

# 设置规则页
PANEL_W = const('PANEL_W')
PAD = const('RULES_PAD')
TEXT_LEFT = -PANEL_W / 2 + PAD
TEXT_W = const('RULES_TEXT_W')
BTN_RIGHT = PANEL_W / 2 - PAD
BTN_W = const('RULES_BTN_W')
BTN_H = const('RULES_BTN_H')
BTN_GAP = const('RULES_BTN_GAP')
CAP_DY = const('RULES_CAPTION_DY')
HINT_DY = const('RULES_HINT_DY')
H_CAP = const('H_CAP_LINE')
H_HINT = const('H_HINT_LINE')
PITCH = const('RULES_ROW_PITCH')
ROW_TOP = const('RULES_ROW_TOP')
TIPS_W = const('RULES_TIPS_W')
TIPS_H = const('RULES_TIPS_H')
TIPS_GAP = const('RULES_TIPS_GAP')
CONTENT_BOTTOM = const('RULES_CONTENT_BOTTOM')
F_CAP = const('RULES_CAPTION_FONT')
F_HINT = const('RULES_HINT_FONT')
F_TIPS = const('RULES_TIPS_FONT')
F_OPTION = 30
TIPS_TEXT = joined_str('RULES_TIPS_TEXT')

# 玩法说明页
HELP_PAD_TOP = const('HELP_PAD_TOP')
HELP_PAD_BOTTOM = const('HELP_PAD_BOTTOM')
HELP_CAP_H = const('HELP_CAP_H')
HELP_CAP_GAP = const('HELP_CAP_GAP')
HELP_LINE_H = const('HELP_LINE_H')
HELP_SEC_GAP = const('HELP_SEC_GAP')
HELP_FAN_ROW_H = const('HELP_FAN_ROW_H')
HELP_FAN_COL_GAP = const('HELP_FAN_COL_GAP')
HELP_FAN_NAME_W = const('HELP_FAN_NAME_W')
HELP_FAN_COL_W = const('HELP_FAN_COL_W')
HELP_CAP_FONT = const('HELP_CAP_FONT')
HELP_LINE_FONT = const('HELP_LINE_FONT')
HELP_FAN_NAME_FONT = const('HELP_FAN_NAME_FONT')
HELP_FAN_FONT = const('HELP_FAN_FONT')

SECTIONS = parse_sections()
GROUPS = parse_groups()
FAN_ROWS = parse_fan_defs()

# 配色
TEXT_TITLE = (250, 246, 236)
TEXT_SUB = (224, 218, 200)
TEXT_MUTED = (180, 176, 164)
TEXT_CAP = (236, 226, 202)
TEXT_HINT = (204, 200, 184)
TEXT_TIPS = (216, 206, 182)
HELP_CAP = (238, 214, 150)
HELP_LINE = (226, 222, 206)
HELP_FAN_NAME = (250, 246, 236)
HELP_FAN_DESC = (206, 202, 186)
CAP_LINE = (214, 176, 96)
GHOST = (240, 238, 228)
DIM = (8, 18, 14, 175)
BAR_TRACK = (255, 255, 255, 30)
BAR_THUMB = (214, 176, 96, 205)
FELT_TOP = (30, 58, 44)
FELT_BOT = (10, 18, 15)


def fan_color(fan):
    if fan <= 0:
        return (178, 188, 178)
    if fan <= 2:
        return (132, 206, 152)
    if fan <= 4:
        return (126, 192, 230)
    if fan <= 6:
        return (244, 192, 100)
    return (236, 134, 90)


def text_width(text, f):
    w = 0
    for ch in text:
        w += f if ord(ch) >= 0x2E80 else f * 0.5
    return w


def make_canvas(view_w, view_h, dim):
    """屏幕画布: 玉绿渐变底 + (内容页)阅读底板; 菜单内容按 min() 缩放居中"""
    view_w, view_h = int(view_w), int(view_h)
    s = min(view_w / MENU_W, view_h / MENU_H)
    img = Image.new('RGB', (view_w, view_h), (10, 16, 14))
    d = ImageDraw.Draw(img, 'RGBA')
    for i in range(60):
        t = i / 59
        col = tuple(int(FELT_TOP[k] + (FELT_BOT[k] - FELT_TOP[k]) * t) for k in range(3))
        d.rectangle([0, view_h * t, view_w, view_h * (t + 1 / 60) + 1], fill=col)
    if dim:
        d.rectangle([0, 0, view_w, view_h], fill=DIM)
    return img, d, s


W_PX = int(MENU_W * 1.038)
H_PX = int(MENU_H * 1.038)


def render_content_page(kind, out, title, scroll_px=0, screen_w=None, screen_h=None):
    """kind: 'rules' | 'help'; 内容画在离屏图上, 再按滚动位置裁进视口"""
    screen_w = int(screen_w or MENU_W * 1.038)
    screen_h = int(screen_h or MENU_H * 1.038)
    s = min(screen_w / MENU_W, screen_h / MENU_H)
    view_top = TOP_Y - TOP_BTN_H / 2 - VIEW_TOP_GAP
    view_bottom = -MENU_H / 2 + 8
    view_h = view_top - view_bottom

    # ---- 内容高度(与源码同一套算术) ----
    if kind == 'rules':
        def row_y(i):
            return ROW_TOP - i * PITCH
        last_bottom = row_y(len(GROUPS) - 1) + HINT_DY - H_HINT / 2
        tips_top = last_bottom - TIPS_GAP
        content_h = -(tips_top - TIPS_H) + CONTENT_BOTTOM
    else:
        y = -HELP_PAD_TOP
        for _t, lines, fan in SECTIONS:
            y -= HELP_CAP_H + HELP_CAP_GAP
            y -= len(lines) * HELP_LINE_H
            if fan:
                y -= ((len(FAN_ROWS) + 1) // 2) * HELP_FAN_ROW_H
            y -= HELP_SEC_GAP
        content_h = -(y + HELP_SEC_GAP) + HELP_PAD_BOTTOM

    max_scroll = max(0, content_h - view_h)
    scroll = max(0, min(max_scroll, scroll_px))

    img, d, _ = make_canvas(screen_w, screen_h, True)

    def X(x):
        return screen_w / 2 + x * s

    def Y(y):
        return screen_h / 2 - y * s

    def T(x, y, text, fill, size, draw=d, anchor='lm'):
        draw.text((X(x), Y(y)), text, fill=fill, font=font(size * s), anchor=anchor)

    # ---- 离屏内容图: 内容局部坐标 → 像素(0 在内容顶边) ----
    cw, ch = int(PAGE_W * s), int(content_h * s)
    canvas = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    cd = ImageDraw.Draw(canvas, 'RGBA')

    def CX(x):
        return cw / 2 + x * s

    def CY(y):
        return -y * s      # 内容局部 y=0 是顶边, 往下为负 → 像素向下

    def CT(x, y, text, fill, size, anchor='lm'):
        cd.text((CX(x), CY(y)), text, fill=fill, font=font(size * s), anchor=anchor)

    if kind == 'rules':
        for i, g in enumerate(GROUPS):
            ry = ROW_TOP - i * PITCH
            CT(TEXT_LEFT, ry + CAP_DY, g['caption'], TEXT_CAP, F_CAP)
            if g['hint']:
                CT(TEXT_LEFT, ry + HINT_DY, g['hint'], TEXT_HINT, F_HINT)
            labels = g['labels'] or ['允许', '禁止']
            n = len(labels)
            avail = BTN_RIGHT - (TEXT_LEFT + TEXT_W) - 8
            bw = min(BTN_W, (avail - (n - 1) * BTN_GAP) / n)
            total = n * bw + (n - 1) * BTN_GAP
            first = BTN_RIGHT - total + bw / 2
            for k, lab in enumerate(labels):
                bx = first + k * (bw + BTN_GAP)
                x0, y0 = CX(bx - bw / 2), CY(ry + BTN_H / 2)
                x1, y1 = CX(bx + bw / 2), CY(ry - BTN_H / 2)
                cd.rounded_rectangle([x0, y0, x1, y1], radius=BTN_H / 2 * s, fill=(255, 255, 255, 14),
                                     outline=GHOST + (170,), width=2)
                CT(bx, ry, lab, TEXT_TITLE, F_OPTION, 'mm')
        # 底部说明(多行)
        tips_y = tips_top - TIPS_H / 2
        for li, line in enumerate(TIPS_TEXT.split('\n')):
            ly = tips_y + TIPS_H / 2 - (li + 0.5) * (TIPS_H / len(TIPS_TEXT.split('\n')))
            CT(TEXT_LEFT, ly, line, TEXT_TIPS, F_TIPS)
            if text_width(line, F_TIPS) > TIPS_W:
                print('  !! 说明行超出宽度: %s' % line)
    else:
        y = -HELP_PAD_TOP
        for sec_title, lines, fan in SECTIONS:
            cap_y = y - HELP_CAP_H / 2
            cap_bottom = y - HELP_CAP_H
            y = cap_bottom - HELP_CAP_GAP
            CT(-PAGE_W / 2, cap_y, sec_title, HELP_CAP, HELP_CAP_FONT)
            cd.line([CX(-PAGE_W / 2), CY(cap_bottom), CX(PAGE_W / 2), CY(cap_bottom)],
                    fill=CAP_LINE + (96,), width=1)
            for line in lines:
                CT(-PAGE_W / 2, y - HELP_LINE_H / 2, line, HELP_LINE, HELP_LINE_FONT)
                if text_width(line, HELP_LINE_FONT) > PAGE_W:
                    print('  !! 正文行超出内容宽: %s' % line)
                y -= HELP_LINE_H
            if fan:
                per_col = (len(FAN_ROWS) + 1) // 2
                for i, (name, fv, desc) in enumerate(FAN_ROWS):
                    col, r = i // per_col, i % per_col
                    left = -PAGE_W / 2 + col * (HELP_FAN_COL_W + HELP_FAN_COL_GAP)
                    cy = y - r * HELP_FAN_ROW_H - HELP_FAN_ROW_H / 2
                    CT(left, cy, name, HELP_FAN_NAME, HELP_FAN_NAME_FONT)
                    fan_text = ('最多 +%d 番' % fv) if name == '连庄' else ('%d 番' % fv)
                    fw = text_width(fan_text, HELP_FAN_FONT)
                    CT(left + HELP_FAN_NAME_W, cy, fan_text, fan_color(fv), HELP_FAN_FONT)
                    if text_width(desc, HELP_FAN_FONT) > HELP_FAN_COL_W - HELP_FAN_NAME_W - fw - 8:
                        print('  !! %s 的说明超出列宽' % name)
                    CT(left + HELP_FAN_NAME_W + fw + 8, cy, desc, HELP_FAN_DESC, HELP_FAN_FONT)
                y -= per_col * HELP_FAN_ROW_H
            y -= HELP_SEC_GAP

    # ---- 把内容裁进视口 ----
    vx0, vy0 = X(-PAGE_W / 2), Y(view_top)
    wpx, hpx = int(PAGE_W * s), int(view_h * s)
    crop = canvas.crop((0, int(scroll * s), wpx, int(scroll * s) + hpx))
    img.paste(crop, (int(vx0), int(vy0)), crop)

    # ---- 视口边框 + 滚动条 ----
    d.rectangle([vx0, vy0, vx0 + wpx, vy0 + hpx], outline=(255, 255, 255, 30), width=1)
    if max_scroll > 1:
        top = view_h / 2 - BAR_PAD
        bottom = -view_h / 2 + BAR_PAD
        track = top - bottom
        thumb = max(BAR_MIN_H, track * min(1, view_h / content_h))
        prog = scroll / max_scroll
        thumb_top = top - prog * (track - thumb)
        bx = PAGE_W / 2 - BAR_RIGHT
        d.rounded_rectangle([X(bx - BAR_W / 2), Y(top), X(bx + BAR_W / 2), Y(bottom)],
                            radius=BAR_W / 2 * s, fill=BAR_TRACK)
        d.rounded_rectangle([X(bx - BAR_W / 2), Y(thumb_top), X(bx + BAR_W / 2), Y(thumb_top - thumb)],
                            radius=BAR_W / 2 * s, fill=BAR_THUMB)

    # ---- 顶部一行(不滚动) ----
    bx0, by0 = X(BACK_X - 100), Y(TOP_Y + TOP_BTN_H / 2)
    bx1, by1 = X(BACK_X + 100), Y(TOP_Y - TOP_BTN_H / 2)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=TOP_BTN_H / 2 * s, fill=(255, 255, 255, 14),
                        outline=GHOST + (170,), width=2)
    T(BACK_X, TOP_Y, '返回', TEXT_TITLE, 28, d, 'mm')
    if kind == 'rules':
        rx0, ry0 = X(BACK_X + 320 - 110), Y(TOP_Y + TOP_BTN_H / 2)
        rx1, ry1 = X(BACK_X + 320 + 110), Y(TOP_Y - TOP_BTN_H / 2)
        d.rounded_rectangle([rx0, ry0, rx1, ry1], radius=TOP_BTN_H / 2 * s, fill=(255, 255, 255, 14),
                            outline=GHOST + (170,), width=2)
        T(BACK_X + 320, TOP_Y, '恢复默认', TEXT_TITLE, 28, d, 'mm')
    else:
        T(0, TOP_Y, '玩法说明', TEXT_TITLE, 42, d, 'mm')

    label = ('%s  缩放=%.3f  内容 %.0f / 视口 %.0f → 可滚 %.0f  当前滚动 %.0f'
             % (title, s, content_h, view_h, max_scroll, scroll))
    view_h_px = int(screen_h)
    d.text((8, view_h_px - 24), label, fill=(255, 240, 190), font=font(16 * s))
    img.save(out)
    print('已输出 %s  (%dx%d)  %s' % (out, img.size[0], img.size[1], label))


def render_home(out, view_w=None, view_h=None):
    view_w = view_w or int(MENU_W * 1.038)
    view_h = view_h or int(MENU_H * 1.038)
    img, d, s = make_canvas(view_w, view_h, False)
    d.rectangle([0, 0, view_w, view_h], fill=(0, 0, 0, 60))

    def X(x):
        return view_w / 2 + x * s

    def Y(y):
        return view_h / 2 - y * s

    def T(x, y, text, fill, size, anchor='mm'):
        d.text((X(x), Y(y)), text, fill=fill, font=font(size * s), anchor=anchor)

    def btn(cx, cy, w, h, label, size, primary=False):
        x0, y0, x1, y1 = X(cx - w / 2), Y(cy + h / 2), X(cx + w / 2), Y(cy - h / 2)
        r = h / 2 * s
        if primary:
            d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=(230, 182, 68))
            T(cx, cy, label, (28, 21, 12), size)
        else:
            d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=(255, 255, 255, 14),
                                outline=GHOST + (170,), width=2)
            T(cx, cy, label, TEXT_TITLE, size)

    L = parse_home()
    T(0, L['title_y'], '麻 将', TEXT_TITLE, 128)
    T(0, L['sub_y'], '单人对局 · 三家 AI', TEXT_SUB, 30)
    btn(0, L['start_y'], L['start_w'], L['start_h'], '开始游戏', 36, primary=True)
    sec_x = (L['sec_w'] + L['sec_gap']) / 2
    btn(-sec_x, L['row_y'], L['sec_w'], L['sec_h'], '设置规则', 28)
    btn(sec_x, L['row_y'], L['sec_w'], L['sec_h'], '玩法说明', 28)
    # 摘要两行
    for li, line in enumerate(['当前规则: 吃开 · 续杠开 · 吃胡开 · 抢杠开 · 一炮多响开 · 听牌宣言开 · AI 满能力',
                               '音频: 音效中 · 音乐开(大)(默认)']):
        T(0, L['sum_y'] + (24 + 8) * (0.5 - li), line, TEXT_SUB, 24)
    T(0, L['tip_y'], '按住手牌往上拖, 松手即可出牌 · 不会打先看「玩法说明」', TEXT_MUTED, 22)
    d.text((8, view_h - 24), '主菜单(次级按钮行: 设置规则 | 玩法说明)', fill=(255, 240, 190), font=font(16 * s))
    img.save(out)
    print('已输出 %s  (%dx%d)' % (out, img.size[0], img.size[1]))


def main():
    render_home(os.path.join(ROOT, 'menu-home-preview.png'))
    render_content_page('rules', os.path.join(ROOT, 'rules-preview.png'), '设置规则页 16:9')
    render_content_page('rules', os.path.join(ROOT, 'rules-preview-bottom.png'),
                        '设置规则页 16:9(滚到底)', 100000)
    render_content_page('help', os.path.join(ROOT, 'help-preview.png'), '玩法说明页 16:9')
    render_content_page('help', os.path.join(ROOT, 'help-preview-portrait.png'),
                        '玩法说明页 手机竖屏', 0, 1080, 2400)


if __name__ == '__main__':
    main()
