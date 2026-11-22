# -*- coding: utf-8 -*-
"""
三族精灵表量化（A.2 方案）：把 320 格 RGBA 精灵表压成 256 色调色板 PNG。

背景与偏差声明
--------------
定案 A.2 用的是 pngquant（quality 82–96、speed 1、Floyd–Steinberg）；
本机没有 pngquant（`Get-Command pngquant` 为空，也无法联网装），
因此改用 Pillow 的 4D（RGBA）八叉树量化 + Floyd–Steinberg 抖动：
  · 同为 256 色调色板、同为误差扩散抖动，属于同一类算法；
  · Pillow 会把 alpha 一并量化，实测保留 30 级 alpha（原图 206 级），
    抗锯齿边缘不会被砍成硬边；
  · 没有 pngquant 的 quality 下限保护，所以本脚本额外用「1× 下的 PSNR / alpha RMSE」
    作为量化是否伤画质的判据（见 main() 输出）。

用法：python tools/sprites_quant.py
输出：sprites/out/q/<族>_sheet.png + 控制台报告
"""
import os
import math
import warnings

from PIL import Image, ImageChops

warnings.filterwarnings("ignore")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "sprites", "out")
DST_DIR = os.path.join(SRC_DIR, "q")

# 每个族在 1× 屏幕上的基准缩放（用于把 320 格表缩到实际观看尺寸再比画质）
# 取 §3.7.2b / §3.8.1 / §3.10.2 里 E 朝向的 k320 × 相机 zoom 0.85
ONE_X_SCALE = {
    "hero": 0.3517 * 0.85,
    "mech": 0.1341 * 0.85,
    "rune": 0.2436 * 0.85,
}


def quantize_sheet(src_path, dst_path, colors=256):
    """把一张 RGBA 精灵表量化为 256 色调色板 PNG 并落盘，返回 (原字节, 新字节)。"""
    im = Image.open(src_path).convert("RGBA")
    q = im.quantize(colors=colors, method=Image.FASTOCTREE, dither=Image.FLOYDSTEINBERG)
    q.save(dst_path, optimize=True)
    return os.path.getsize(src_path), os.path.getsize(dst_path)


def psnr_1x(src_path, quant_path, scale):
    """
    在「实际观看尺寸」上比画质：
    把原图与量化图都缩到 320×scale 的格位大小（LANCZOS），
    只统计 alpha>8 的像素，返回 (RGB PSNR dB, alpha RMSE)。
    """
    a = Image.open(src_path).convert("RGBA")
    b = Image.open(quant_path).convert("RGBA")
    cell = 160
    w = max(1, int(round(a.width / 2 * scale)))
    h = max(1, int(round(a.height / 2 * scale)))
    a1 = a.resize((w, h), Image.LANCZOS)
    b1 = b.resize((w, h), Image.LANCZOS)

    pa, pb = a1.load(), b1.load()
    sq = 0.0
    n = 0
    asq = 0.0
    for y in range(h):
        for x in range(w):
            ra, ga, ba, aa = pa[x, y]
            if aa <= 8:
                continue
            rb, gb, bb, ab = pb[x, y]
            sq += (ra - rb) ** 2 + (ga - gb) ** 2 + (ba - bb) ** 2
            asq += (aa - ab) ** 2
            n += 3
    if n == 0:
        return 99.0, 0.0
    mse = sq / n
    psnr = 99.0 if mse <= 1e-9 else 10 * math.log10(255 * 255 / mse)
    alpha_rmse = math.sqrt(asq / max(1, n / 3))
    return psnr, alpha_rmse


def main():
    """逐族量化、报字节与 1× 画质，并给出总计与预估嵌入后体积。"""
    os.makedirs(DST_DIR, exist_ok=True)
    total_before = 0
    total_after = 0
    print("%-6s %10s %10s %8s %8s %8s" % ("族", "原字节", "量化后", "降幅", "PSNR", "αRMSE"))
    for fam in ("hero", "mech", "rune"):
        src = os.path.join(SRC_DIR, fam + "_sheet.png")
        dst = os.path.join(DST_DIR, fam + "_sheet.png")
        before, after = quantize_sheet(src, dst)
        psnr, armse = psnr_1x(src, dst, ONE_X_SCALE[fam])
        total_before += before
        total_after += after
        print("%-6s %10d %10d %7.1f%% %7.1f %8.2f" % (
            fam, before, after, (1 - after / before) * 100, psnr, armse))
    base64_len = math.ceil(total_after / 3) * 4
    print("\n合计 %d → %d B（%.1f%%），base64 后约 %d B" % (
        total_before, total_after, (1 - total_after / total_before) * 100, base64_len))


if __name__ == "__main__":
    main()
