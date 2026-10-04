#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
庄方宜主题 · 配色求解器（一次性工具，用来选色，不是运行时依赖）

背景：初版配色把色阶饱和度压到 ≤4%，结果整屏接近纯灰（burst 深色底
`#141917`），观感「太丑」。这一版改成「**表面克制但有色相，强调色拉满**」。

做法：不再手工试色（4 预设 × 2 明暗 × ~30 角色 = 240 个值，手工必出错），
而是用 HSL 规格生成候选，直接跑 `src/contrast.js` 的同一组 WCAG 断言，
不达标就调参重来。输出可直接粘进 `src/palette.js` 的角色表。

用法：
    python tools/solve-palette.py            # 求解并打印角色表
    python tools/solve-palette.py --verify    # 只校验当前 palette.js
"""

import argparse
import colorsys
import json
import math
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# ── 每个预设的色相与色度规格 ──────────────────────────────────────────────
# hue 取自官方取色：本体荧光黄绿 56.5°、大招墨青 155.6°、青 178.3°、酒红 0.5°
# chroma 是「绝对色度」（max-min，0..255），这一版的核心改动 ——
# ── chroma 的设计原则（踩过两次坑才定下来）──────────────────────────────
#
# 第一次：chroma 3~5 → 整屏发灰，用户说「太丑」。
# 第二次：chroma 12~22 铺满所有表面 → 用户说「像给整个画面加了一层滤镜」。
#
# 两次都错在同一个地方：把色度当成「整体染色」的旋钮。
# 正确做法是按**面积**分配色度：
#
#   大面积（base/surface/surfaceAlt/sidebar）→ 近中性，色度 4~7
#     大面积带色相必然显脏、像滤镜。真实界面（GitHub dark #0D1117、
#     VS Code #1E1E1E）的大面积色度都只有 0~10。
#   中面积（code/navActive/卡片）→ 略高，色度 6~10，用来区分层次
#   小面积（brand/link/focusRing/选中态）→ **拉满**，色度 60~155
#
# 也就是「中性打底，主题色做点缀」—— 这才是用户要的「更明显的主题色」：
# 不是把底色染绿，而是让强调色在近中性的底上跳出来。
SPECS = {
    'zhuang': {
        'label': '本体黄绿',
        'hue': 58, 'hueDark': 58,
        'accent': '#F2E957',        # 官方荧光黄绿（深色模式强调色）
        # 浅色模式强调色要压得够深：它同时要当链接（压在最亮的 surfaceAlt 上
        # 达 4.5:1）与焦点环（压在 surfaceSunken 上达 3:1）。黄绿色相本身
        # 亮度高，所以比其它预设需要更低的 L。
        'accentLight': '#4E6409',
        'chroma': 5, 'chromaDark': 6,
    },
    'burst': {
        'label': '大招墨青金',
        'hue': 156, 'hueDark': 156,
        'accent': '#C4D579',        # 官方香槟金
        'accentLight': '#17513E',   # 墨青
        'chroma': 5, 'chromaDark': 6,
    },
    'cyan': {
        'label': '青',
        'hue': 178, 'hueDark': 178,
        'accent': '#75DCD9',
        'accentLight': '#0A5B5E',
        'chroma': 5, 'chromaDark': 6,
    },
    'wine': {
        'label': '酒红',
        'hue': 2, 'hueDark': 2,
        'accent': '#E08B87',
        'accentLight': '#8A2F2B',
        'chroma': 5, 'chromaDark': 6,
    },
}

# 明度骨架（浅色 / 深色），单位 %
LIGHT = {
    'base': 95.0, 'surface': 98.4, 'surfaceAlt': 91.0, 'surfaceSunken': 86.8,
    'sidebar': 93.0, 'overlay': 98.4,
    'code': 91.6, 'codeBanner': 89.0, 'inlineCode': 91.0,
}
DARK = {
    'base': 8.6, 'surface': 12.4, 'surfaceAlt': 16.4, 'surfaceSunken': 20.4,
    'sidebar': 10.4, 'overlay': 16.4,
    'code': 11.2, 'codeBanner': 14.6, 'inlineCode': 16.4,
}

# 文字明度（饱和度由 chroma 规格统一决定）
# 浅色模式的 textFaint / textMuted 必须够深：它们要压在最深的那个表面
# （surfaceAlt，L≈92.8%）上仍达 4.5:1，所以 L 不能超过 ~45%
TEXT_L = {
    'light': {'text': 12.5, 'textMuted': 29.0, 'textFaint': 38.0},
    'dark': {'text': 92.0, 'textMuted': 72.0, 'textFaint': 62.5},
}


def hsl(h, s, l):
    """{h:0..360, s:0..1, l:0..1} → `#RRGGBB`（大写）。"""
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360.0, max(0.0, min(1.0, l)), max(0.0, min(1.0, s)))
    return '#%02X%02X%02X' % (round(r * 255), round(g * 255), round(b * 255))


def tint(hue, lightness, chroma):
    """按「色度」生成颜色 —— 比直接给 HSL 饱和度可靠得多。

    为什么不用 HSL 饱和度：饱和度是**相对**量，在明度两端会被压缩。
    L=96.5% 时 s=0.13 算出来是 `#F7F7F5`（几乎是灰的），而同样 s=0.13 在
    L=50% 却是明显有色。这正是初版配色「看起来只有灰」的原因之一。

    色度（max-min，0..255）是**绝对**量，直接决定「看起来有多少颜色」。
    由 `chroma = (1-|2L-1|)·S·255` 反解出需要的 HSL 饱和度：
        S = chroma / (255 · (1-|2L-1|))
    这样无论明度多少，色相都保持同样的可见强度。

    @param hue      色相 0..360
    @param lightness 明度 0..1
    @param chroma   目标色度 0..255
    """
    l = max(0.0, min(1.0, lightness))
    span = 1.0 - abs(2.0 * l - 1.0)
    if span <= 1e-6:
        return hsl(hue, 0, l)
    s = min(1.0, (chroma / 255.0) / span)
    return hsl(hue, s, l)


def rgb(value):
    t = value.lstrip('#')
    return tuple(int(t[i:i + 2], 16) for i in (0, 2, 4))


def chroma_of(value):
    v = rgb(value)
    return max(v) - min(v)


def lum(value):
    def lin(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb(value)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def ratio(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def shift(value, dl=0.0, ds=0.0, dh=0.0):
    """按 HSL 微调颜色。"""
    r, g, b = [v / 255.0 for v in rgb(value)]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return hsl(h * 360 + dh, s + ds, max(0.0, min(1.0, l + dl)))


def build(preset, scheme):
    """生成一个预设/明暗下的完整角色表。

    **色度按面积分配**（这是第三版的核心修正）：

      大面积 → 近中性（`c * 0.4 ~ c * 1.0`，绝对色度只有 2~7）
      中面积 → 略高（`c * 1.2 ~ c * 1.8`），用来区分层次
      小面积 → 拉满（强调色直接用官方取色，色度 60~155）

    前两版分别错在「整体太灰」和「整体染色像加滤镜」，根因都是把色度当成
    整体旋钮。界面的大面积必须是中性底，颜色靠强调色跳出来。
    """
    sp = SPECS[preset]
    hue = sp['hueDark'] if scheme == 'dark' else sp['hue']
    L = DARK if scheme == 'dark' else LIGHT
    dark = scheme == 'dark'
    c = sp['chromaDark'] if dark else sp['chroma']

    r = {}
    # ── 大面积：近中性。色度只有 c*0.4 ~ c*1.0（绝对 2~6），
    #    只留一丝色相暗示冷暖，不构成「染色」。──
    r['base'] = tint(hue, L['base'] / 100, c * 0.45)
    r['surface'] = tint(hue, L['surface'] / 100, c * 0.40)
    r['surfaceAlt'] = tint(hue, L['surfaceAlt'] / 100, c * 0.80)
    r['surfaceSunken'] = tint(hue, L['surfaceSunken'] / 100, c * 0.90)
    r['sidebar'] = tint(hue, L['sidebar'] / 100, c * 1.00)
    r['overlay'] = tint(hue, L['overlay'] / 100, c * 0.40)
    # ── 中面积：略高，用来把代码块/导航从底上分出来 ──
    r['code'] = tint(hue, L['code'] / 100, c * 1.30)
    r['codeBanner'] = tint(hue, L['codeBanner'] / 100, c * 1.60)
    r['inlineCode'] = tint(hue, L['inlineCode'] / 100, c * 1.40)

    # ── 文字：只留极轻色相，避免死黑死白 ──
    tl = TEXT_L[scheme]
    r['text'] = tint(hue, tl['text'] / 100, c * 0.25)
    r['textMuted'] = tint(hue, tl['textMuted'] / 100, c * 0.35)
    r['textFaint'] = tint(hue, tl['textFaint'] / 100, c * 0.40)

    # ── 强调色：**主题色只在这里出现**，直接取官方本色，色度拉满 ──
    r['brand'] = sp['accent'] if dark else sp['accentLight']
    r['brandHover'] = shift(r['brand'], dl=0.06 if dark else 0.05, ds=0.02)
    r['brandInk'] = r['base'] if dark else '#FFFFFF'
    # 强调色浅底：给足色度（c*3.5），让选中项/气泡真的带主题色，
    # 而不是像大面积那样只留一丝暗示
    r['brandSoft'] = tint(hue, (90.5 if not dark else 20.0) / 100, c * 3.50)
    r['brandSoftInk'] = r['brand']
    r['link'] = r['brand'] if not dark else shift(r['brand'], dl=-0.02)
    r['focusRing'] = shift(r['brand'], dl=0.04 if not dark else -0.06)
    r['tintRgb'] = r['text']

    # ── 其余面 ──
    r['navActive'] = tint(hue, (88.5 if not dark else 19.0) / 100, c * 3.00)
    r['navHover'] = tint(hue, (92.0 if not dark else 15.0) / 100, c * 1.20)
    r['scrollbar1'] = tint(hue, (84.0 if not dark else 20.0) / 100, c * 1.10)
    r['scrollbar2'] = tint(hue, (74.0 if not dark else 27.0) / 100, c * 1.30)
    r['toast'] = tint(hue, (17.0 if not dark else 20.4) / 100, c * 0.90)
    r['toastInk'] = tint(hue, (95.0 if not dark else 90.0) / 100, c * 0.30)
    r['tooltip'] = tint(hue, (13.0 if not dark else 20.4) / 100, c * 0.90)
    r['skeleton'] = r['text'] + ('0A' if not dark else '14')
    return r


# ── 与 src/contrast.js 完全一致的断言集 ────────────────────────────────────
CHECKS = [
    ('正文 / 底色', 'label-primary', 'bg-base', 4.5),
    ('正文 / 一级面', 'label-primary', 'bg-layer-1', 4.5),
    ('正文 / 二级面', 'label-primary', 'bg-layer-2', 4.5),
    ('正文 / 三级面', 'label-primary', 'bg-layer-3', 4.5),
    ('正文 / 浮层', 'label-primary', 'bg-overlay', 4.5),
    ('正文 / 侧栏', 'label-primary', 'specific-sidebar-fill', 4.5),
    ('正文 / 设置卡片', 'label-primary', 'settings-card-fill', 4.5),
    ('正文 / 菜单', 'label-primary', 'specific-menu', 4.5),
    ('次要文字 / 底色', 'label-secondary', 'bg-base', 4.5),
    ('次要文字 / 二级面', 'label-secondary', 'bg-layer-2', 4.5),
    ('次要文字 / 侧栏', 'label-secondary', 'specific-sidebar-fill', 4.5),
    ('次要文字 / 设置卡片', 'label-secondary', 'settings-card-fill', 4.5),
    ('三级文字 / 底色', 'label-tertiary', 'bg-base', 4.5),
    ('三级文字 / 二级面', 'label-tertiary', 'bg-layer-2', 4.5),
    ('三级文字 / 侧栏', 'label-tertiary', 'specific-sidebar-fill', 4.5),
    ('说明文字 / 底色', 'label-caption', 'bg-base', 4.5),
    ('品牌色 / 底色', 'brand-primary', 'bg-base', 3),
    ('品牌色 / 二级面', 'brand-primary', 'bg-layer-2', 3),
    ('品牌色 / 侧栏', 'brand-primary', 'specific-sidebar-fill', 3),
    ('链接 / 底色', 'link', 'bg-base', 4.5),
    ('链接 / 气泡', 'link', 'specific-bubble', 4.5),
    ('链接 / 代码块', 'link', 'markdown-code-block', 4.5),
    ('链接 / 二级面', 'link', 'bg-layer-2', 4.5),
    ('正文 / 气泡', 'label-primary', 'specific-bubble', 4.5),
    ('正文 / 高亮气泡', 'label-primary', 'specific-bubble-highlight', 4.5),
    ('正文 / 内联代码', 'label-primary', 'markdown-inline-code', 4.5),
    ('正文 / 侧栏选中', 'label-primary', 'specific-sidebar-nav-item-active', 4.5),
    ('正文 / 输入框', 'label-primary', 'specific-input-major', 4.5),
    ('正文 / Toast', 'toast-label', 'toast-bg', 4.5),
    ('按钮文字 / 按钮底', 'label-primary-foreground', 'button-primary-fill', 4.5),
    ('次级按钮文字 / 浮起面', 'label-primary', 'button-elevated-fill', 4.5),
    ('焦点环 / 底色', 'focus-ring-color', 'bg-base', 3),
    ('焦点环 / 二级面', 'focus-ring-color', 'bg-layer-2', 3),
    ('焦点环 / 三级面', 'focus-ring-color', 'bg-layer-3', 3),
    ('焦点环 / 设置卡片', 'focus-ring-color', 'settings-card-fill', 3),
    ('开关滑块 / 轨道', 'switch-thumb', 'button-primary-fill', 1.5),
    ('代码块文字 / 代码块底', 'label-primary', 'markdown-code-block', 4.5),
    ('文档预览文字 / 预览底', 'label-document-preview', 'bg-document-preview', 4.5),
    ('菜单图标 / 菜单底', 'menu-icon', 'specific-menu', 3),
]


def aliases(r):
    """与 src/palette.js 的 deriveAliases 保持一致的派生。"""
    def wa(value, a):
        v = rgb(value)
        return '#%02X%02X%02X%02X' % (v[0], v[1], v[2], round(a * 255))
    return {
        'bg-base': r['base'], 'bg-layer-1': r['surface'], 'bg-layer-2': r['surfaceAlt'],
        'bg-layer-3': r['surfaceSunken'], 'bg-overlay': r['overlay'],
        'bg-module-platform': r['surfaceAlt'], 'bg-multi-select': r['surfaceAlt'],
        'bg-document-preview': r['surfaceSunken'], 'bg-skeleton': r['skeleton'],
        'specific-sidebar-fill': r['sidebar'], 'specific-menu': r['surface'],
        'specific-input-major': r['surface'], 'specific-login-input': r['surfaceAlt'],
        'specific-selector': r['surfaceAlt'], 'specific-tip': r['surfaceAlt'],
        'specific-sidebar-nav-item-active': r['navActive'],
        'specific-sidebar-nav-item-active-accent': r['brandSoft'],
        'specific-sidebar-nav-item-hover': r['navHover'],
        'specific-bubble': r['brandSoft'],
        'specific-bubble-highlight': shift(r['brandSoft'], dl=-0.03),
        'brand-primary': r['brand'], 'brand-primary-invert': r['brand'],
        'brand-primary-new-color': r['brand'], 'brand-text': r['brand'],
        'state-business-primary': r['link'], 'state-business-tertiary': r['brandSoft'],
        'link': r['link'],
        'label-primary': r['text'], 'label-primary-bluish': r['text'],
        'label-primary-dimmed': shift(r['text'], dl=0.04),
        'label-primary-foreground': r['brandInk'], 'label-primary-inverted': r['brandInk'],
        'label-secondary': r['textMuted'], 'label-tertiary': r['textFaint'],
        'label-caption': r['textFaint'], 'label-document-preview': r['textMuted'],
        'label-dimmed': r['brandSoft'],
        'border-l1': wa(r['tintRgb'], 0.07), 'border-l2': wa(r['tintRgb'], 0.12),
        'border-l2-darkmode-thin': wa(r['tintRgb'], 0.07), 'border-l3': wa(r['tintRgb'], 0.18),
        'border-l4': wa(r['tintRgb'], 0.26), 'border-inverted': wa(r['tintRgb'], 0.0),
        'border-inverted2': wa(r['tintRgb'], 0.07),
        'button-primary-fill': r['brand'], 'button-primary-hover': r['brandHover'],
        'button-primary-dimmed': r['brandSoft'], 'button-elevated-fill': r['surface'],
        'button-floating-fill': r['surface'], 'button-floating-hover': r['surfaceAlt'],
        'button-ghost-active-fill': r['brandSoft'],
        'button-ghost-active-hover': shift(r['brandSoft'], dl=-0.03),
        'button-ghost-active-border': r['textFaint'], 'button-contrast-fill': r['textMuted'],
        'button-info-fill': r['link'], 'button-info-hover': r['brandHover'],
        'interactive-bg-hover': wa(r['tintRgb'], 0.07), 'interactive-bg-active': wa(r['tintRgb'], 0.12),
        'interactive-bg-hover-accent': wa(r['tintRgb'], 0.18),
        'interactive-bg-hover-solid': r['surfaceAlt'],
        'interactive-bg-hover-danger': wa('#EC1313', 0.05),
        'markdown-code-block': r['code'], 'markdown-code-block-banner': r['codeBanner'],
        'markdown-code-segment-selected': r['surface'], 'markdown-code-segment-unselected': r['code'],
        'markdown-inline-code': r['inlineCode'], 'markdown-placeholder': r['surfaceAlt'],
        'markdown-tag': r['surfaceAlt'], 'markdown-citation': r['surfaceSunken'],
        'switch-thumb': r['brandInk'], 'focus-ring-color': r['focusRing'],
        'menu-group-header-fill': wa(r['surface'], 0.94), 'menu-icon': r['text'],
        'scrollbar-bg-l1': r['scrollbar1'], 'scrollbar-bg-l2': r['scrollbar1'],
        'scrollbar-hover-l1': r['scrollbar2'], 'scrollbar-hover-l2': r['scrollbar2'],
        'toast-bg': r['toast'], 'toast-label': r['toastInk'], 'tooltip-bg': r['tooltip'],
        'turn-trigger-bg': r['code'], 'turn-trigger-bg-hover': wa(r['tintRgb'], 0.07),
        'settings-card-fill': r['surface'], 'settings-card-stroke': wa(r['tintRgb'], 0.26),
        'onboarding-card-fill': wa(r['surface'], 0.8), 'onboarding-secondary-fill': r['surface'],
        'onboarding-accent': r['brand'], 'onboarding-checkbox-border': wa(r['tintRgb'], 0.2),
    }


def check_all(verbose=True):
    """跑全部断言，返回失败列表。"""
    fails = []
    total = 0
    for preset in SPECS:
        for scheme in ('light', 'dark'):
            t = aliases(build(preset, scheme))
            for label, fg, bg, need in CHECKS:
                total += 1
                if fg not in t or bg not in t:
                    fails.append((preset, scheme, label, None, need, fg, bg, '缺 token'))
                    continue
                r = ratio(t[fg], t[bg])
                if r < need:
                    fails.append((preset, scheme, label, r, need, fg, bg, ''))
    return total, fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--verify', action='store_true', help='只跑断言')
    args = ap.parse_args()

    total, fails = check_all()
    print('合计 %d 项断言，不达标 %d 项\n' % (total, len(fails)))
    if fails:
        for preset, scheme, label, r, need, fg, bg, why in fails:
            tag = '浅色' if scheme == 'light' else '深色'
            rr = ('%.2f:1' % r) if r is not None else why
            print('  FAIL %-8s %s  %-22s %9s < %s' % (preset, tag, label, rr, need))
        print()

    if args.verify:
        return 1 if fails else 0

    # 输出角色表，便于粘进 palette.js
    print('=' * 78)
    for preset in SPECS:
        print("\n  %s: {" % preset)
        print("    label: '%s'," % SPECS[preset]['label'])
        print("    accent: '%s'," % SPECS[preset]['accent'])
        for scheme in ('light', 'dark'):
            r = build(preset, scheme)
            print("    %s: {" % scheme)
            for k in ('base', 'surface', 'surfaceAlt', 'surfaceSunken', 'sidebar', 'overlay',
                      'text', 'textMuted', 'textFaint', 'brand', 'brandHover', 'brandInk',
                      'brandSoft', 'brandSoftInk', 'link', 'tintRgb', 'focusRing', 'code',
                      'codeBanner', 'inlineCode', 'scrollbar1', 'scrollbar2', 'toast',
                      'toastInk', 'tooltip', 'skeleton', 'navActive', 'navHover'):
                print("      %s: '%s'," % (k, r[k]))
            print("    },")
        print("  },")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
