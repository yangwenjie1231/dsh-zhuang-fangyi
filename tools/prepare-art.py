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
import json
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
# ⚠ 这张表由 `tools/gen-wallpapers.mjs` 从 `src/wallpaperCatalog.js` 生成（0.8.0 起）。
#   不要手改 —— 会被下次生成覆盖。加/改壁纸请改目录文件后重跑该脚本。
# >>> generated: wallpapers (do not edit) >>>
# ⚠ 本节由 `tools/gen-wallpapers.mjs` 从 `src/wallpaperCatalog.js` 自动生成。
#   不要手改 —— 改了下次生成会被覆盖，且会与插件侧不一致。
#   要加/改壁纸请改目录文件后重跑：node tools/gen-wallpapers.mjs
WALLPAPERS = {
    'sakura': ('02-场景原画/樱花树下_4096x1716.webp', '樱花树下'),
    'promo': ('08-视频抽帧/1_抽帧_宣传CG_绿发双角色.webp', '宣传 CG · 双人'),
    'pool': ('08-视频抽帧/9_抽帧_宣传CG_樱花池.webp', '樱花池'),
    'ultrawide': ('08-视频抽帧/5_抽帧_超宽横幅_樱花(3840x1116).webp', '超宽横幅 · 樱花'),
    'dark': ('09-散图与二创/D684AC645F51D3D08668CE19EEB8AC63.png', '暗调水面月影'),
    'portrait': ('01-立绘海报/干员立绘卡_E1_1080x1920.webp', '干员立绘卡'),
    'vertical': ('08-视频抽帧/2_抽帧_竖版立绘循环 CHIZANG.webp', '竖版立绘循环'),
    'contour': ('08-视频抽帧/14_抽帧_暗调CG_等高线纹理.webp', '等高线纹理'),
    'off01': ('04-官方通用/游戏插画-2-我很喜欢.jpg', '田野淡彩'),
    'off02': ('04-官方通用/官图/官图_24_荷塘古树.jpeg', '荷塘古树'),
    'off03': ('04-官方通用/官图/官图_17_仙鹤云海.jpeg', '仙鹤云海'),
    'off04': ('04-官方通用/官图/官图_05_水墨长枪.jpeg', '水墨长枪'),
    'off05': ('04-官方通用/官图/官图_01_溪谷气泡.png', '溪谷气泡'),
    'off06': ('06-商店与平台图/appstore/bb646c60e3075289cbf5632d54380646201266157.jpg', '白蝶环绕'),
    'off07': ('04-官方通用/官图/官图_02_白底全身立绘.jpeg', '白底立绘 · 全身'),
    'off08': ('04-官方通用/官图/官图_16_蓝天梨树.jpeg', '蓝天梨树'),
    'off09': ('04-官方通用/官图/官图_08_几何纹样.jpeg', '几何纹样 · 小兽'),
    'sce01': ('16-二创收集/横幅全景/NR8AVjViQ2dBeE1EQTVOekF3TnpReTYuZ2lhdHJYQXkwIQUAcXVuZ3o!.jpeg', '霓虹星空'),
    'sce02': ('16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReU83UWZhcS5NTURFIQUAcXVuZ3o!.png', '樱花回眸'),
    'sce03': ('16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReWxqczVhaXBNQ2lvIQUAcXVuZ3o!.png', '花枝云海'),
    'sce04': ('08-视频抽帧/15_抽帧_莲花池场景.webp', '莲花池'),
    'sce05': ('16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReVBMUWZhdmQ4TVRFIQUAcXVuZ3o!.png', '白花逆光'),
    'sce06': ('02-场景原画/横版_卧姿立绘_2048x1152.webp', '卧姿立绘'),
    'sce07': ('16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReUliVWZhajMuMGpZIQUAcXVuZ3o!.jpeg', '水墨淡彩'),
    'sce08': ('16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReTZVMGxhc2VkeVNnIQUAcXVuZ3o!.png', '绘本光斑'),
    'sce09': ('16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReWRiTWZhcUJ6N3lBIQUAcXVuZ3o!.png', '樱花远景'),
    'sce10': ('16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReWNiTWZhaVZZNGlBIQUAcXVuZ3o!.jpeg', '荷塘绿调'),
    'sce11': ('16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReWJMUWZhaFZNa3pNIQUAcXVuZ3o!.jpeg', '林间逆光'),
    'sce12': ('09-散图与二创/52AC523AA50527A6D2712D373F45B658.jpg', '红墙竹林'),
    'sce13': ('08-视频抽帧/7_抽帧_3D模型实机_室内(331s).webp', '实机 · 室内'),
    'sce14': ('16-二创收集/方形构图/NR8AVjViQ2dBeE1EQTVOekF3TnpReTBmMG5hZ1NaUnk0IQUAcXVuZ3o!.jpeg', '月洞门庭院'),
    'sce15': ('16-二创收集/方形构图/NR8AVjViQ2dBeE1EQTVOekF3TnpReXkycDlhdXhBU0JJIQUAcXVuZ3o!.png', '拔刀动作'),
    'sce16': ('02-场景原画/黄绿涂鸦横图_2048x1152.webp', '黄绿涂鸦'),
    'sce17': ('16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReW43UWZhdlNya1RJIQUAcXVuZ3o!.jpeg', '暖木长廊'),
    'sce18': ('16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReWNwVmJhZ3NHRlRnIQUAcXVuZ3o!.png', '湖畔灰绿'),
    'sce19': ('16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReWY3UWZhcU1jUXpNIQUAcXVuZ3o!.jpeg', '白花枝头'),
    'sce20': ('08-视频抽帧/6_抽帧_宽幅_雪景.webp', '宽幅雪景'),
    'sce21': ('16-二创收集/横版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReUQ3UWZhaWIuZlMwIQUAcXVuZ3o!.jpeg', '朦胧厚涂'),
    'cha01': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReUhMVWZhc2s5NERZIQUAcXVuZ3o!.jpeg', '雾中执器'),
    'cha02': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReUtEZzZhcHBhTkJZIQUAcXVuZ3o!.png', '夜樱双人'),
    'cha03': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReVlyUWZhbW8xa3lvIQUAcXVuZ3o!.jpeg', '双人立绘'),
    'cha04': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReXdMTWZhcHFWSkNnIQUAcXVuZ3o!.jpeg', '樱花林半身'),
    'cha05': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReXdiTWZhaWNESENnIQUAcXVuZ3o!.jpeg', '绿调全身'),
    'cha06': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReXpXcDlhcElvU2hJIQUAcXVuZ3o!.png', '深底礼服'),
    'cha07': ('16-二创收集/条漫长图/NR8AVjViQ2dBeE1EQTVOekF3TnpReXkzOHlhdlkydlJrIQUAcXVuZ3o!.jpeg', '暗青飘带'),
    'cha08': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReSpoLlphbSowY3dZIQUAcXVuZ3o!.jpeg', '夜色长裙'),
    'cha09': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReSpCLlphdkY4Z2dZIQUAcXVuZ3o!.jpeg', '夜巷侠客'),
    'cha10': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReUZiUWZhdlJlV1MwIQUAcXVuZ3o!.jpeg', '白底单体'),
    'cha11': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReVZZQXRhdnlSTlRRIQUAcXVuZ3o!.jpeg', '光效飘带'),
    'cha12': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReW0wRTFhdjNXSndZIQUAcXVuZ3o!.jpeg', '蓝天白云'),
    'cha13': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReW1SbW9hdFdwc1I4IQUAcXVuZ3o!.jpeg', '侧颜特写'),
    'cha14': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReWRCbW9hczZXb3lBIQUAcXVuZ3o!.jpeg', '暖光坐姿'),
    'cha15': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReW03UWZhczM1aGkwIQUAcXVuZ3o!.jpeg', '便服半身'),
    'cha16': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReW5yTWZhdkh2dXg4IQUAcXVuZ3o!.png', '黄昏逆光'),
    'cha17': ('16-二创收集/竖版插画/NR8AVjViQ2dBeE1EQTVOekF3TnpReXpDY2hhdDlxYlM0IQUAcXVuZ3o!.jpeg', '黑裙暖光'),
    'cha18': ('09-散图与二创/DB418AB53D401EF64E45CE09C76367A8.jpg', '白花散落'),
    'cha19': ('09-散图与二创/853f7ed9809bbbc2e38a4b772b8c3d8c170193073.jpg', '樱花覆水'),
    'cha20': ('09-散图与二创/076392915FA932997DF87E98A723484A.jpg', '暗蓝全身'),
}
# <<< generated: wallpapers <<<

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


def mean_luma(im):
    """整图平均亮度（0~1）。用于让暗色版的压暗系数**随图自适应**。

    固定系数 `DARK_BRIGHTNESS=0.62` 的问题（用户评估反馈）：对本身就是暗调
    的图（如「暗调水面月影」）再乘 0.62 会压得漆黑一片，细节全丢。
    """
    small = im.convert('L').resize((64, 64))
    px = list(small.getdata())
    return sum(px) / (len(px) * 255.0)


def darken(im):
    """压暗一版，供深色主题使用。

    系数按**源图平均亮度**自适应：
      · 天然暗图（luma ≤ 0.28）→ 基本不压（0.92），只微降饱和；
      · 中等亮度 → 线性过渡到 0.62；
      · 亮图（luma ≥ 0.60）→ 全额 0.62。
    这样每张图暗色版的目标亮度大致落在同一区间，而不是被同一个系数
    压成深浅不一。
    """
    luma = mean_luma(im)
    lo, hi = 0.28, 0.60
    if luma <= lo:
        factor = 0.92
    elif luma >= hi:
        factor = DARK_BRIGHTNESS
    else:
        t = (luma - lo) / (hi - lo)
        factor = 0.92 + (DARK_BRIGHTNESS - 0.92) * t
    out = ImageEnhance.Brightness(im).enhance(factor)
    # 饱和度也反向自适应：已经很暗的图再降饱和会更脏，轻一点
    sat = DARK_SATURATION if luma > lo else 0.94
    return ImageEnhance.Color(out).enhance(sat)


def save_webp(im, name, quality=86):
    """输出 WebP。带 alpha 的图必须走 `RGBA` 并开 `exact`，否则边缘会发灰。"""
    path = os.path.join(ART, name)
    if im.mode == 'RGBA':
        im.save(path, 'WEBP', quality=quality, method=6, exact=True)
    else:
        im.save(path, 'WEBP', quality=quality, method=6)
    return path, os.path.getsize(path)


def save_thumb(im, name, size=(128, 80), quality=70):
    """设置页壁纸缩略图 → `art/thumbs/<name>`。

    中心 cover 裁剪到 `size`（UI 里显示 64×40，这里给 2x 保证高 DPI 不糊）。
    只有十几 KB，可以随包分发、也可以提交进 git（与大图不同，不靠生成）。
    """
    tw, th = size
    w, h = im.size
    scale = max(tw / w, th / h)
    nw, nh = max(tw, int(w * scale + 0.5)), max(th, int(h * scale + 0.5))
    im2 = im.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - tw) // 2, (nh - th) // 2
    im2 = im2.crop((left, top, left + tw, top + th))
    os.makedirs(os.path.join(ART, 'thumbs'), exist_ok=True)
    path = os.path.join(ART, 'thumbs', name)
    im2.convert('RGB').save(path, 'WEBP', quality=quality, method=6)
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



# ── 逐图取景（B8）──────────────────────────────────────────────────────────
#
# 清单里的 `focus` 会成为 CSS 的 `background-position`，**只在画面被裁切时才
# 起作用**（窗口宽高比 ≠ 图片宽高比）：宽窗口横向裁、窄窗口纵向裁。
# 16:9 图铺在 16:9 窗口里没有裁切，写什么值都一样 —— 值真正救场的是
# 「主体偏在一侧」的图 + 超宽屏窗口。
#
# 这些值怎么来的：视觉测量（主体包围盒 + 面部水平位置），**只采纳多次测量
# 一致的结论**。同一张图两次问出来的包围盒差别很大（pool 一次 43–96、
# 一次 20–78），所以只认大信号，不把噪声写进清单。
#
# 值的语法就是 `background-position` 的百分比写法（`x% y%`）。
ART_FOCUS = {
    # 主体在右半（两次测量 50–98 / 43–93，且左侧留白明显更多）→ 取景右移，
    # 让 21:9 这类窗口裁切后仍完整包住主体（居中会切掉伸出的手臂末端）
    'contour': '65% 50%',
}


def focus_of(base):
    """`wallpaper-contour-dark.webp` → `ART_FOCUS['contour']`；没有则 None。"""
    name = base
    if name.startswith('wallpaper-'):
        name = name[len('wallpaper-'):]
    if name.endswith('.webp'):
        name = name[:-len('.webp')]
    if name.endswith('-dark'):
        name = name[:-len('-dark')]
    return ART_FOCUS.get(name)


def main():
    parser = argparse.ArgumentParser(description='从庄方宜素材生成主题 art/')
    parser.add_argument('--only', help='只重建指定的一项（如 sakura）')
    parser.add_argument('--quality', type=int, default=86, help='WebP 质量，默认 86')
    parser.add_argument('--keep-dark', action='store_true',
                        help='同时产出暗色版。0.8.0 起默认**不产**（产品决定：一张图明暗共用，'
                             '每张省约 236KB）；0.7.x 的复刻才需要这个参数')
    args = parser.parse_args()

    if not os.path.isdir(SRC):
        print('找不到素材目录：%s' % SRC, file=sys.stderr)
        print('请确认 庄方宜素材\\ 与 dsh-zhuang-fangyi\\ 在同一级目录下。', file=sys.stderr)
        return 1

    os.makedirs(ART, exist_ok=True)
    made, skipped = [], []

    # ── 壁纸 ──────────────────────────────────────────────────────────────
    #
    # 0.8.0：默认只产出亮色版。原来每张都压暗出 `-dark`，但壁纸默认 14% 不透明、
    # 正文可读性靠纱层 + 观测栏 backdrop-filter 兜底，压暗的实际收益很小，
    # 成本却是每张多一个文件、两个 CSS 变量、一张缩略图（58 张时尤其明显）。
    # `darken()` 保留 —— `--keep-dark` 复刻 0.7.x 时还要用。
    for key, (rel, note) in WALLPAPERS.items():
        if args.only and args.only != key:
            continue
        im = load(rel)
        if im is None:
            skipped.append((key, rel))
            continue
        base = fit_width(flatten(im))
        p1, s1 = save_webp(base, 'wallpaper-%s.webp' % key, args.quality)
        made.append(('wallpaper-%s.webp' % key, base.size, s1, note))
        tp1, ts1 = save_thumb(base, 'wallpaper-%s.webp' % key)
        made.append(('thumbs/wallpaper-%s.webp' % key, (128, 80), ts1, '缩略图'))
        if args.keep_dark:
            dark = darken(base)                   # 只压暗一次，全图与缩略图共用
            p2, s2 = save_webp(dark, 'wallpaper-%s-dark.webp' % key, args.quality)
            made.append(('wallpaper-%s-dark.webp' % key, dark.size, s2, '暗色版'))
            tp2, ts2 = save_thumb(dark, 'wallpaper-%s-dark.webp' % key)
            made.append(('thumbs/wallpaper-%s-dark.webp' % key, (128, 80), ts2, '缩略图·暗'))

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

    # ── 清单：记录每张壁纸的尺寸与「该用 cover 还是 contain」────────────────
    #
    # 为什么让生成器算，而不是在插件代码里硬编码图名：
    # 竖图（宽高比 < 0.87）用 `cover` 铺横屏会把人物裁成一条 —— 1080×1920 的
    # 立绘在 1337×947 里只剩中间 40% 的高度（实测）。这类图必须 `contain`
    # 完整显示，两侧用同图模糊垫底（见 index.js 的 `::after` 层）。
    # 把判断写进清单后，**以后新增任何图都自动正确**，不用回来改代码。
    manifest = {
        'version': 1,
        'wallpapers': {},
    }
    for name, size, nbytes, note in made:
        base = os.path.basename(name)
        if not base.startswith('wallpaper-') or not base.endswith('.webp'):
            continue
        if '/thumbs/' in name or name.startswith('thumbs/'):
            continue
        w, h = size
        ratio = w / h if h else 1.0
        entry = {
            'width': w,
            'height': h,
            'ratio': round(ratio, 3),
            # 竖图/近方图用 contain（完整显示），横图用 cover（铺满）
            'fit': 'contain' if ratio < 0.87 else 'cover',
        }
        focus = focus_of(base)
        if focus:
            entry['focus'] = focus
        manifest['wallpapers'][base] = entry
    mpath = os.path.join(ART, 'wallpapers.json')
    with open(mpath, 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write('\n')
    print('\n清单 art/wallpapers.json：%d 张（竖图用 contain）' % len(manifest['wallpapers']))
    for k, v in sorted(manifest['wallpapers'].items()):
        if v['fit'] == 'contain':
            print('  contain  %-32s %dx%d' % (k, v['width'], v['height']))

    if skipped:
        print('\n跳过 %d 个（源文件缺失）：' % len(skipped))
        for key, rel in skipped:
            print('  %s ← %s' % (key, rel))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
