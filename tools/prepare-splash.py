"""把启动动效用的干员立绘转成插件素材。

源文件在仓库**上一级**（`仿通行证/干员立绘.jpeg`），不在 `庄方宜素材/` 里 ——
它是用户单独放进来的，所以本脚本单独处理，不混进 `prepare-art.py` 的素材库流程。

用法：
    python tools/prepare-splash.py

产出：
    art/splash.webp      启动动效前景（黑底保留，用 mix-blend-mode:screen 融掉）
    art/splash-sm.webp   小尺寸兜底（窄屏/低性能）
"""

import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                 # dsh-zhuang-fangyi/
PARENT = os.path.dirname(ROOT)               # 仿通行证/
ART = os.path.join(ROOT, "art")

SRC_CANDIDATES = [
    os.path.join(PARENT, "干员立绘.jpeg"),
    os.path.join(PARENT, "干员立绘.jpg"),
    os.path.join(PARENT, "干员立绘.png"),
]

# 输出宽度：源图 1644×1600。全屏展示不需要更大，1600 够 2K 屏；
# 再大只是浪费解码时间（启动动效最忌首帧卡）。
OUT_WIDTH = 1600
SMALL_WIDTH = 800


def find_source():
    for p in SRC_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


def save_webp(im, name, quality=82):
    path = os.path.join(ART, name)
    im.save(path, "WEBP", quality=quality, method=6)
    return path, os.path.getsize(path)


def main():
    src = find_source()
    if src is None:
        print("找不到源文件。期望以下之一：", file=sys.stderr)
        for p in SRC_CANDIDATES:
            print("  " + p, file=sys.stderr)
        return 1

    os.makedirs(ART, exist_ok=True)
    im = Image.open(src).convert("RGB")
    print("源: %s  %dx%d" % (src, im.size[0], im.size[1]))

    made = []
    big = im
    if big.width > OUT_WIDTH:
        h = round(big.height * OUT_WIDTH / big.width)
        big = big.resize((OUT_WIDTH, h), Image.LANCZOS)
    p1, s1 = save_webp(big, "splash.webp")
    made.append(("splash.webp", big.size, s1))

    small = im
    if small.width > SMALL_WIDTH:
        h = round(small.height * SMALL_WIDTH / small.width)
        small = small.resize((SMALL_WIDTH, h), Image.LANCZOS)
    p2, s2 = save_webp(small, "splash-sm.webp")
    made.append(("splash-sm.webp", small.size, s2))

    print("产出 %d 个文件到 art/：" % len(made))
    for name, size, nbytes in made:
        print("  %-20s %5dx%-5d %7.0f KB" % (name, size[0], size[1], nbytes / 1024))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
