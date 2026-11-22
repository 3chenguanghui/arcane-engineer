# -*- coding: utf-8 -*-
"""
压缩复核：定案 A.2（pngquant 2.17.0，quality 82-96） vs 现在这版（Pillow 八叉树 256 色 + FS 抖动）

为什么要有这个脚本：
  v2.2.0 的贴图是用 Pillow 量化出来的，而不是定案的 pngquant。体积更小、PSNR 更低，
  所以必须做一次"同一位置、同一裁剪框"的 200% 并排对照，用眼睛判断能不能接受。
  判据以 200% 目视为准，不以体积为准。

产出（落在 lab\\sprite_size，不碰主文件）：
  · cmp_pillow_<fam>_200pct.png  三列并排（原图 / pngquant / Pillow）+ 深底 + 浅底 + 误差热力图
  · cmp_pillow_quality.json      每族 PSNR / alpha 误差 / >8 像素占比的精确数字

用法：python tools\\sprites_cmp_pngquant.py
"""

import json
import math
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageStat

ROOT = r"D:\其他\TRAE宝\奥术工程师"
SRC = os.path.join(ROOT, "sprites", "out")          # 原始未量化 sheet
CUR = os.path.join(SRC, "q")                        # 现在这版（Pillow 八叉树）
BIN = os.path.join(ROOT, "lab", "sprite_size", "bin")   # 定案 A.2（pngquant 产物）
OUT = os.path.join(ROOT, "lab", "sprite_size")
FAMILIES = ["hero", "mech", "rune"]

# 与 measure_sprites.py 完全相同的裁剪框（同位置才有可比性）
CROPS = {
    "hero": (90, 2323, 310, 2543),
    "mech": (1623, 993, 1843, 1213),
    "rune": (1069, 418, 1289, 638),
}


def alpha_mask(img, floor=16):
    """生成 alpha>=floor 的二值掩膜（白=参与统计），和 A.2 的统计口径一致"""
    return img.getchannel("A").point(lambda v: 255 if v >= floor else 0)


def quality(a, b, floor=16):
    """
    算 a（原图）与 b（压缩后）的 RGB PSNR、最大误差、alpha 误差、>8 像素占比。
    只在 a 的 alpha>=floor 区域统计——透明区的 RGB 变化玩家看不见，不该拉低分数。
    """
    mask = alpha_mask(a, floor)
    count = mask.histogram()[255]
    if count == 0:
        return None
    diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
    stat = ImageStat.Stat(diff, mask=mask)
    mse = sum(stat.sum2) / (3.0 * count)
    psnr = 99.0 if mse == 0 else 10 * math.log10(255.0 * 255.0 / mse)
    over = None
    for ch in diff.split():
        b8 = ch.point(lambda v: 255 if v > 8 else 0)
        over = b8 if over is None else ImageChops.lighter(over, b8)
    da = ImageChops.difference(a.getchannel("A"), b.getchannel("A"))
    a_stat = ImageStat.Stat(da, mask=mask)
    a_rms = math.sqrt(sum(x * x for x in a_stat.sum2) / count)
    return {
        "psnr_rgb": round(psnr, 2),
        "max_abs_rgb": int(max(e[1] for e in stat.extrema)),
        "mean_abs_rgb": round(sum(stat.mean) / 3.0, 3),
        "alpha_max_abs": int(a_stat.extrema[0][1]),
        "alpha_rmse": round(a_rms, 2),
        "px_over_8_pct": round(100.0 * over.histogram(mask)[255] / count, 3),
    }


def compose_on_bg(crop, bg):
    """把带透明的裁剪贴到纯色底上：深底看描边、浅底看 alpha 断阶"""
    canvas = Image.new("RGBA", crop.size, bg)
    canvas.alpha_composite(crop.convert("RGBA"))
    return canvas.convert("RGB")


def diff_map(a, b, scale=2, gain=8):
    """误差热力图：|A-B| 取三通道最大，乘原图 alpha（只显示看得见的差异），再放大 gain 倍"""
    d = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
    r, g, bl = d.split()
    d = ImageChops.lighter(ImageChops.lighter(r, g), bl)
    d = ImageChops.multiply(d, a.getchannel("A"))
    d = d.point(lambda v: min(255, v * gain)).convert("RGB")
    return d.resize((d.width * scale, d.height * scale), Image.NEAREST)


def edge_point(img, box):
    """
    在裁剪框内找 alpha 梯度最大的点（轮廓最陡处），用作 400% 局部放大的中心。
    这样三族都自动取到"最容易被抖点污染"的轮廓边缘，而不是我手动挑一个好看的区域。
    """
    alpha = img.getchannel("A").crop(box)
    left = alpha.transform(alpha.size, Image.AFFINE, (1, 0, -1, 0, 1, 0))
    up = alpha.transform(alpha.size, Image.AFFINE, (1, 0, 0, 0, 1, -1))
    g = ImageChops.lighter(ImageChops.difference(alpha, left), ImageChops.difference(alpha, up))
    px = list(g.getdata())
    i = max(range(len(px)), key=lambda k: px[k])
    return box[0] + i % g.width, box[1] + i // g.width


def zoom_box(center, size=120, w=None, h=None):
    """以 center 为中心取 size×size 的框，并夹回图内"""
    x = max(0, min(center[0] - size // 2, w - size))
    y = max(0, min(center[1] - size // 2, h - size))
    return (x, y, x + size, y + size)


def flat_noise(orig, comp, floor=16, detail_max=2):
    """
    只在不透明且"本来就没有细节"的平面区统计误差，量化抖动麻点的强度。
    做法：原图 L 通道减去 BoxBlur(2) 得到局部细节量，细节 <=detail_max 且 alpha>=floor
    的像素算平面区；在这些像素上量 |压缩-原图| 的均值与标准差。
    平面区标准差大 = 整片在抖，就是肉眼看到的"麻点"；pngquant 与 Pillow 用同一口径比。
    """
    L = orig.convert("L")
    detail = ImageChops.difference(L, L.filter(ImageFilter.BoxBlur(2)))
    flat = detail.point(lambda v: 255 if v <= detail_max else 0)
    mask = ImageChops.multiply(flat, alpha_mask(orig, floor))
    n = mask.histogram()[255]
    if n == 0:
        return None
    diff = ImageChops.difference(orig.convert("RGB"), comp.convert("RGB"))
    st = ImageStat.Stat(diff, mask=mask)
    return {
        "px_total": int(n),
        "mean_abs": round(sum(st.mean) / 3.0, 2),
        "sigma": round(sum(st.stddev) / 3.0, 2),
        "max_abs": int(max(e[1] for e in st.extrema)),
    }


def strip(columns, title, note="", scale=2):
    """
    把若干列（每列 = 一张同尺寸图 + 两行文字）拼成一条对照条，NEAREST 放大保留像素差。
    columns: [(image, headline, subline), ...]
    """
    w, h = columns[0][0].size
    pad, head, foot = 8, 26, 30
    W = len(columns) * (w * scale + pad) + pad
    H = head + h * scale + foot + pad
    strip_img = Image.new("RGB", (W, H), (18, 22, 28))
    draw = ImageDraw.Draw(strip_img)
    font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 16)
    for i, (im, head_txt, sub_txt) in enumerate(columns):
        big = im.resize((w * scale, h * scale), Image.NEAREST)
        x = pad + i * (w * scale + pad)
        strip_img.paste(big, (x, head))
        draw.text((x + 2, 5), head_txt, fill=(220, 235, 245), font=font)
        if sub_txt:
            draw.text((x + 2, head + h * scale + 4), sub_txt, fill=(150, 175, 195), font=font)
    if title:
        draw.text((pad, head + h * scale + 18), title, fill=(240, 200, 120), font=font)
    if note:
        draw.text((pad, H - 16), note, fill=(140, 160, 175), font=font)
    return strip_img


def main():
    """对三族各出一张 200% 并排复核图，并把数字写进 json"""
    result = {"crops": CROPS, "families": {}}
    dark = (19, 26, 34, 255)
    light = (232, 238, 245, 255)

    for fam in FAMILIES:
        orig = Image.open(os.path.join(SRC, f"{fam}_sheet.png")).convert("RGBA")
        pq = Image.open(os.path.join(BIN, f"{fam}_sheet.pngquant.png")).convert("RGBA")
        cur = Image.open(os.path.join(CUR, f"{fam}_sheet.png")).convert("RGBA")
        box = CROPS[fam]
        c_orig, c_pq, c_cur = orig.crop(box), pq.crop(box), cur.crop(box)

        q_pq = quality(orig, pq)
        q_cur = quality(orig, cur)
        q_pq_vs_cur = quality(pq, cur)
        result["families"][fam] = {
            "bytes_original": os.path.getsize(os.path.join(SRC, f"{fam}_sheet.png")),
            "bytes_pngquant": os.path.getsize(os.path.join(BIN, f"{fam}_sheet.pngquant.png")),
            "bytes_pillow": os.path.getsize(os.path.join(CUR, f"{fam}_sheet.png")),
            "vs_original_pngquant": q_pq,
            "vs_original_pillow": q_cur,
            "pillow_vs_pngquant": q_pq_vs_cur,
        }

        row_dark = strip(
            [(compose_on_bg(c_orig, dark), "ORIGINAL", "未压缩 PNG"),
             (compose_on_bg(c_pq, dark), "PNGQUANT 82-96", f"PSNR {q_pq['psnr_rgb']}dB"),
             (compose_on_bg(c_cur, dark), "PILLOW OCTREE+FS", f"PSNR {q_cur['psnr_rgb']}dB")],
            f"{fam} / 200% / dark bg / crop {box}")
        row_light = strip(
            [(compose_on_bg(c_orig, light), "ORIGINAL", "未压缩 PNG"),
             (compose_on_bg(c_pq, light), "PNGQUANT 82-96", f"alpha max {q_pq['alpha_max_abs']}"),
             (compose_on_bg(c_cur, light), "PILLOW OCTREE+FS", f"alpha max {q_cur['alpha_max_abs']}")],
            f"{fam} / 200% / light bg")
        row_diff = strip(
            [(diff_map(c_orig, c_pq), "DIFF x8 PNGQUANT", f"mean {q_pq['mean_abs_rgb']}"),
             (diff_map(c_orig, c_cur), "DIFF x8 PILLOW", f"mean {q_cur['mean_abs_rgb']}")],
            f"{fam} / abs diff amplified 8x (white = difference)")

        combo = Image.new("RGB", (max(row_dark.width, row_light.width, row_diff.width),
                                  row_dark.height + row_light.height + row_diff.height), (10, 12, 16))
        y = 0
        for part in (row_dark, row_light, row_diff):
            combo.paste(part, (0, y))
            y += part.height
        out_path = os.path.join(OUT, f"cmp_pillow_{fam}_200pct.png")
        combo.save(out_path)
        print(f"{fam}: {out_path}  ({combo.width}x{combo.height})")

        # 400% 轮廓边缘局部放大：只看"最陡的 alpha 边缘"，抖点在浅底上最刺眼
        ctr = edge_point(orig, box)
        zb = zoom_box(ctr, 120, orig.width, orig.height)
        e_orig, e_pq, e_cur = orig.crop(zb), pq.crop(zb), cur.crop(zb)
        edge_rows = []
        for bg, tag in ((dark, "dark"), (light, "light")):
            edge_rows.append(strip(
                [(compose_on_bg(e_orig, bg), "ORIGINAL", f"edge @ {ctr}"),
                 (compose_on_bg(e_pq, bg), "PNGQUANT 82-96", "alpha max 66/127/7"),
                 (compose_on_bg(e_cur, bg), "PILLOW OCTREE+FS", f"alpha max {q_cur['alpha_max_abs']}")],
                f"{fam} / 400% / {tag} bg / zoom box {zb}", scale=4))
        edge_rows.append(strip(
            [(diff_map(e_orig, e_pq, scale=4), "DIFF x8 PNGQUANT", f"mean {q_pq['mean_abs_rgb']}"),
             (diff_map(e_orig, e_cur, scale=4), "DIFF x8 PILLOW", f"mean {q_cur['mean_abs_rgb']}")],
            f"{fam} / 400% edge diff x8", scale=1))
        ec = Image.new("RGB", (max(r.width for r in edge_rows), sum(r.height for r in edge_rows)), (10, 12, 16))
        y = 0
        for part in edge_rows:
            ec.paste(part, (0, y))
            y += part.height
        edge_path = os.path.join(OUT, f"cmp_pillow_{fam}_edge400.png")
        ec.save(edge_path)
        print(f"{fam}: {edge_path}  ({ec.width}x{ec.height})  edge center {ctr}")

    # 标出 PSNR 最低的那族（按现在这版 vs 原图算）
    lows = {f: result["families"][f]["vs_original_pillow"]["psnr_rgb"] for f in FAMILIES}
    worst = min(lows, key=lows.get)
    result["pillow_psnr_by_family"] = lows
    result["lowest_psnr_family"] = worst
    with open(os.path.join(OUT, "cmp_pillow_quality.json"), "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)

    print("\n族     原图 B    pngquant B   Pillow B   PSNR(pq)  PSNR(cur)  当前缩小")
    for fam in FAMILIES:
        d = result["families"][fam]
        red = 1 - d["bytes_pillow"] / d["bytes_original"]
        print(f"{fam:6s} {d['bytes_original']:9d} {d['bytes_pngquant']:11d} {d['bytes_pillow']:10d}"
              f" {d['vs_original_pngquant']['psnr_rgb']:9.2f} {d['vs_original_pillow']['psnr_rgb']:10.2f}"
              f" {red:9.1%}")
    print(f"\nPSNR 最低族 = {worst}（{lows[worst]} dB）")


if __name__ == "__main__":
    main()
