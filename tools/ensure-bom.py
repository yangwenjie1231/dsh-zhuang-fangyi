#!/usr/bin/env python3
"""确保 tools/*.ps1 带 UTF-8 BOM（幂等）。

── 为什么需要这个 ──────────────────────────────────────────────────────

Windows PowerShell 5.1 把**无 BOM 的 UTF-8 `.ps1`** 当 ANSI/GBK 解码，
中文注释会变成乱码、甚至因解出引号/反引号而**语法失败**。
PowerShell 7 没这个问题（按 UTF-8 读）。

麻烦在于：`edit`/`write` 一类编辑工具**会剥掉 BOM**。
所以每次用它们改过 `.ps1` 之后，跑一下本脚本就能恢复 5.1 兼容性。

    python tools/ensure-bom.py          # 补 BOM
    python tools/ensure-bom.py --check  # 只检查，缺 BOM 时退出码 1

PS7 下即使不补也能正常跑 —— 本脚本只是让两个版本都能用。
"""

import io
import os
import sys

BOM = b"\xef\xbb\xbf"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 仓库根
TOOLS = os.path.join(ROOT, "tools")


def main() -> int:
    check_only = "--check" in sys.argv
    # 仓库根（install.ps1 / uninstall.ps1 等用户面脚本）与 tools/ 都扫
    targets = []
    for directory in (ROOT, TOOLS):
        targets += sorted(
            os.path.join(directory, n)
            for n in os.listdir(directory)
            if n.lower().endswith(".ps1") and os.path.isfile(os.path.join(directory, n))
        )
    if not targets:
        print("  没有 .ps1 文件")
        return 0

    missing = []
    for path in targets:
        raw = io.open(path, "rb").read()
        name = os.path.basename(path)
        if raw.startswith(BOM):
            print(f"  {name:22} 已带 BOM")
            continue
        missing.append(name)
        if check_only:
            print(f"  {name:22} **缺 BOM**（PS 5.1 下中文会乱码）")
            continue
        io.open(path, "wb").write(BOM + raw)
        print(f"  {name:22} 已补 BOM")

    if check_only and missing:
        print(f"\n  {len(missing)} 个文件缺 BOM：{', '.join(missing)}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
