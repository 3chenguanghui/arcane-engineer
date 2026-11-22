"""把 fx123_demo.js 抓到的 JPEG 帧序列合成 GIF 与接触表。

用法：
    python tools/fx123_gif.py lab/fx123/demo

输入：<dir>/frame_0001.jpg ... frame_0100.jpg
输出：<dir>/demo.gif（720 宽、8fps 循环）
      <dir>/contact.png（5x4 抽样接触表，每 2 秒一格）
"""
import sys
import os
from PIL import Image

def build_gif(frames, out_path, width=720, duration=125):
    """按顺序把帧缩放到统一宽度后合成为循环 GIF。"""
    images = []
    for path in frames:
        img = Image.open(path).convert("RGB")
        h = int(img.height * width / img.width)
        images.append(img.resize((width, h), Image.LANCZOS))
    first, rest = images[0], images[1:]
    first.save(
        out_path,
        save_all=True,
        append_images=rest,
        duration=duration,
        loop=0,
        optimize=True,
        disposal=2,
    )
    return os.path.getsize(out_path)

def build_contact(frames, out_path, cols=5, rows=4, cell=360):
    """从全序列里均匀抽 cols*rows 张，拼成接触表（看整体节奏用）。"""
    need = cols * rows
    step = max(1, len(frames) // need)
    picked = frames[::step][:need]
    thumbs = []
    for path in picked:
        img = Image.open(path).convert("RGB")
        h = int(img.height * cell / img.width)
        thumbs.append(img.resize((cell, h), Image.LANCZOS))
    ch = thumbs[0].height
    sheet = Image.new("RGB", (cols * cell, rows * ch), (12, 14, 20))
    for i, thumb in enumerate(thumbs):
        sheet.paste(thumb, ((i % cols) * cell, (i // cols) * ch))
    sheet.save(out_path, optimize=True)
    return len(picked), os.path.getsize(out_path)

def main():
    """入口：定位帧序列并产出两种证据图。"""
    base = sys.argv[1] if len(sys.argv) > 1 else "lab/fx123/demo"
    frames = sorted(
        os.path.join(base, name)
        for name in os.listdir(base)
        if name.startswith("frame_") and name.endswith(".jpg")
    )
    if not frames:
        print("no frames in", base)
        return 1
    gif_size = build_gif(frames, os.path.join(base, "demo.gif"))
    picked, sheet_size = build_contact(frames, os.path.join(base, "contact.png"))
    print("frames=%d  gif=%dB  contact=%d格/%dB" % (len(frames), gif_size, picked, sheet_size))
    return 0

if __name__ == "__main__":
    sys.exit(main())
