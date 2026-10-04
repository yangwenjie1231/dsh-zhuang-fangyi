#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
庄方宜主题 · 素材准备

从 `庄方宜素材\\` 取官方图，产出 `art/` 下的壁纸（明暗两版）、等高线纹理与头像。

可重复运行：每次覆盖 art/ 下同名文件，不改动源素材。

用法：
    python tools/prepare-art.py                # 全量重建
    python tools/prepare-art.py --only sakura  # 只重建一张

设计要点：
  · 每张壁纸产出**两版**：亮色版原样，暗色版压暗（降低亮度 + 略降饱和），
    让浅色主题下正文清晰、深色主题下不刺眼。
  · 头像用 `15-头像/聊天头像.webp`（官方透明底正脸），**保留 alpha** 输出；
    它缺位时才回落到从立绘卡裁头部。
  · 统一输出 WebP（体积小、DSH 外壳与 Chromium 都原生支持）。
  · 超宽图不裁切，交给 CSS 的 background-size:cover 决定取景；
    竖版图保持原比例，靠右显示。
  · 透明底素材必须先 `flatten()` 再当壁纸用，否则透明区残留 RGB 会变成噪点。
"""

import argparse
import os
import sys
from PIL import Image, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ART = os.path.join(ROOT, 'art')
SRC = os.path.join(os.path.dirname(ROOT), '庄方宜素材')

# 目标宽度上限：4K 屏也够，同时把 20MB 级的原图压到几百 KB
MAX_WIDTH = 2560

# 壁纸定义：输出名 → (源文件相对路径, 取景说明)
WALLPAPERS = {
    'sakura':    ('02-场景原画/樱花树下_4096x1716.webp', '樱花树下（2.39:1 横幅，最干净）'),
    'promo':     ('08-视频抽帧/1_抽帧_宣传CG_绿发双角色.webp', '宣传 CG 绿发双角色'),
    'pool':      ('08-视频抽帧/9_抽帧_宣传CG_樱花池.webp', '樱花池'),
    'ultrawide': ('08-视频抽帧/5_抽帧_超宽横幅_樱花(3840x1116).webp', '超宽横幅'),
    'dark':      ('09-散图与二创/D684AC645F51D3D08668CE19EEB8AC63.png', '暗调水面月影（4K，天然暗色）'),
    'portrait':  ('01-立绘海报/干员立绘卡_E1_1080x1920.webp', '干员立绘卡（竖版，靠右）'),
    'vertical':  ('08-视频抽帧/2_抽帧_竖版立绘循环 CHIZANG.webp', '竖版立绘循环'),
    'contour':   ('08-视频抽帧/14_抽帧_暗调CG_等高线纹理.webp', '等高线纹理'),
}

# 头像：优先用官方透明底头像（15-头像/聊天头像.webp）。
# 它是 156×156 带 alpha 的正脸，直接可用；缺它时才回落到从立绘卡裁头部。
# 头像会出现在侧栏、空白页与助手消息旁，透明底能让它贴在任何底色上而不带方块。
AVATAR = ('15-头像/聊天头像.webp', '头像：官方透明底正脸')
AVATAR_FALLBACK = ('01-立绘海报/干员立绘卡_E1_1080x1920.webp', '头像：立绘卡头部裁切（回落）')

CONTOUR = ('08-视频抽帧/14_抽帧_暗调CG_等高线纹理.webp', '等高线细边框纹理')

# 暗色版参数：亮度 ×0.62、饱和 ×0.85，保留色相与构图
DARK_BRIGHTNESS = 0.62
DARK_SATURATION = 0.85


def load(rel):
    """读取源图（**保留 alpha**）；缺失时返回 None。

    注意不能无条件 `convert('RGB')` —— 透明底素材（头像）一旦丢掉 alpha，
    透明区域的残留 RGB 会变成噪点或黑块。调用方按需自行拍平。
    """
    path = os.path.join(SRC, rel)
    if not os.path.exists(path):
        return None
    return Image.open(path)


def flatten(im, bg=(0, 0, 0)):
    """把带 alpha 的图合成到纯色底上（壁纸不需要透明）。"""
    if im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info):
        rgba = im.convert('RGBA')
        canvas = Image.new('RGB', rgba.size, bg)
        canvas.paste(rgba, (0, 0), rgba)
        return canvas
    return im.convert('RGB')


def fit_width(im, max_width=MAX_WIDTH):
    """等比缩放到目标宽度以内（不放大）。"""
    if im.width <= max_width:
        return im
    height = round(im.height * max_width / im.width)
    return im.resize((max_width, height), Image.LANCZOS)


def darken(im):
    """压暗一版，供深色主题使用。"""
    out = ImageEnhance.Brightness(im).enhance(DARK_BRIGHTNESS)
    return ImageEnhance.Color(out).enhance(DARK_SATURATION)


def save_webp(im, name, quality=86):
    """输出 WebP。带 alpha 的图必须走 `RGBA` 并开 `exact`，否则边缘会发灰。"""
    path = os.path.join(ART, name)
    if im.mode == 'RGBA':
        im.save(path, 'WEBP', quality=quality, method=6, exact=True)
    else:
        im.save(path, 'WEBP', quality=quality, method=6)
    return path, os.path.getsize(path)


def trim_halo(im, lum_threshold=185, sat_threshold=0.18, alpha_keep=0.55, solid=0.92):
    """去掉透明边缘上的白色/浅色残留。

    源头像从浅色背景抠出，半透明像素里残留了背景色：直接贴到深色主题上会
    显出一圈白边。这些像素的特征是「**低饱和 + 高亮度 + alpha 不满**」。

    `solid` 是关键的保险：**alpha 接近 1 的像素一律不动**。否则人物自身的
    浅色（白围巾、白外套、高光）会被误判成背景残留并淡化，在深色底上变成
    一块灰斑 —— 实测踩过这个坑，所以阈值必须同时卡 alpha。

    @param lum_threshold 亮度阈值（0..255），高于它才可能是背景残留
    @param sat_threshold HSV 饱和度阈值（0..1），低于它算「灰白」
    @param alpha_keep    残留像素保留的 alpha 比例
    @param solid         视为「实心人物」的 alpha 下限，达到即跳过
    """
    rgba = im.convert('RGBA')
    import numpy as np
    a = np.array(rgba).astype(np.float32)
    alpha = a[:, :, 3] / 255.0
    rgb = a[:, :, :3]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    lum = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)

    suspect = (lum > lum_threshold) & (sat < sat_threshold) & (alpha < solid)
    # 越亮、越灰 → 越像背景残留
    strength = np.clip((lum - lum_threshold) / max(1.0, 255.0 - lum_threshold), 0, 1)
    fade = np.where(suspect, 1.0 - strength * (1.0 - alpha_keep), 1.0)
    a[:, :, 3] = np.clip(alpha * fade * 255.0, 0, 255)
    return Image.fromarray(a.astype('uint8'), 'RGBA')


def circular_mask(im, feather=0.02, zoom=1.06):
    """把头像裁成圆形并羽化边缘。

    头像在外壳里始终以圆形呈现（侧栏 / 空白页 / 消息旁都是 `border-radius:50%`），
    所以直接输出圆形是最省事的做法：

      · 源图是「抠图后柔化边缘」的方形图，四周残留一圈浅色，贴在深色主题上
        会显出一圈灰边；圆形遮罩把这一圈整个切掉。
      · 羽化 2% 让边缘不生硬，缩放 1.06 保证人物不会被切到（源图四周本来就有留白）。

    @param feather 羽化宽度（相对直径的比例）
    @param zoom    放大系数，>1 表示向内裁一点
    """
    from PIL import ImageDraw, ImageFilter
    rgba = im.convert('RGBA')
    size = min(rgba.size)
    if rgba.size != (size, size):
        rgba = rgba.crop((0, 0, size, size))
    if zoom != 1.0:
        inner = round(size / zoom)
        off = (size - inner) // 2
        rgba = rgba.crop((off, off, off + inner, off + inner)).resize((size, size), Image.LANCZOS)

    # 4× 超采样画遮罩，边缘更平滑
    ss = 4
    mask = Image.new('L', (size * ss, size * ss), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * ss - 1, size * ss - 1), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    if feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(size * feather))

    a = rgba.getchannel('A')
    import numpy as np
    merged = (np.array(a).astype(np.float32) * (np.array(mask).astype(np.float32) / 255.0))
    rgba.putalpha(Image.fromarray(merged.astype('uint8'), 'L'))
    return rgba


def head_crop(im):
    """
    头像裁切：立绘卡的头部区域。

    立绘卡是全身竖图，头部在上方约 4%~26% 高度、水平居中偏左（人物站位）。
    取一个正方形区域，保证脸部完整且留一点肩部。
    """
    side = round(im.width * 0.52)
    left = max(0, round(im.width * 0.24))
    top = round(im.height * 0.045)
    if left + side > im.width:
        left = im.width - side
    box = (left, top, left + side, top + side)
    return im.crop(box).resize((512, 512), Image.LANCZOS)


def main():
    parser = argparse.ArgumentParser(description='从庄方宜素材生成主题 art/')
    parser.add_argument('--only', help='只重建指定的一项（如 sakura）')
    parser.add_argument('--quality', type=int, default=86, help='WebP 质量，默认 86')
    args = parser.parse_args()

    if not os.path.isdir(SRC):
        print('找不到素材目录：%s' % SRC, file=sys.stderr)
        print('请确认 庄方宜素材\\ 与 dsh-zhuang-fangyi\\ 在同一级目录下。', file=sys.stderr)
        return 1

    os.makedirs(ART, exist_ok=True)
    made, skipped = [], []

    # ── 壁纸 ──────────────────────────────────────────────────────────────
    for key, (rel, note) in WALLPAPERS.items():
        if args.only and args.only != key:
            continue
        im = load(rel)
        if im is None:
            skipped.append((key, rel))
            continue
        base = fit_width(flatten(im))
        p1, s1 = save_webp(base, 'wallpaper-%s.webp' % key, args.quality)
        p2, s2 = save_webp(darken(base), 'wallpaper-%s-dark.webp' % key, args.quality)
        made.append(('wallpaper-%s.webp' % key, base.size, s1, note))
        made.append(('wallpaper-%s-dark.webp' % key, base.size, s2, '暗色版'))

    # ── 头像 ──────────────────────────────────────────────────────────────
    if not args.only or args.only == 'avatar':
        # 首选透明底官方头像：直接输出，保留 alpha（CSS 里贴在任何底色上都不带方块）
        im = load(AVATAR[0])
        note = AVATAR[1]
        if im is not None:
            av = im.convert('RGBA')
            if av.width < 256:
                av = av.resize((512, 512), Image.LANCZOS)
            av = circular_mask(trim_halo(av))
            p, s = save_webp(av, 'avatar.webp', 90)
            made.append(('avatar.webp', av.size, s, note))
        else:
            # 回落：从立绘卡裁头部（不透明）
            fb = load(AVATAR_FALLBACK[0])
            if fb is None:
                skipped.append(('avatar', AVATAR[0]))
            else:
                av = head_crop(fit_width(flatten(fb), 1600))
                p, s = save_webp(av, 'avatar.webp', 90)
                made.append(('avatar.webp', av.size, s, AVATAR_FALLBACK[1]))

    # ── 等高线纹理 ────────────────────────────────────────────────────────
    if not args.only or args.only == 'contour':
        im = load(CONTOUR[0])
        if im is None:
            skipped.append(('contour', CONTOUR[0]))
        else:
            # 纹理用较低质量即可（会被叠加与缩放）
            co = fit_width(flatten(im), 1600)
            p, s = save_webp(co, 'contour.webp', 72)
            made.append(('contour.webp', co.size, s, CONTOUR[1]))

    print('产出 %d 个文件到 art/' % len(made))
    for name, size, nbytes, note in made:
        print('  %-34s %5dx%-5d %7.0f KB  %s' % (name, size[0], size[1], nbytes / 1024, note))
    if skipped:
        print('\n跳过 %d 个（源文件缺失）：' % len(skipped))
        for key, rel in skipped:
            print('  %s ← %s' % (key, rel))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
