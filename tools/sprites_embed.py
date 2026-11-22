# -*- coding: utf-8 -*-
"""
把量化后的三张精灵表以 data URI 形式注入主文件（单文件交付，不外链）。

为什么单独一个脚本
------------------
三张表合计 ~700KB，base64 后近 1MB。手工粘贴既容易截断，也没法复跑；
这里用固定标记包起来，重跑时整块替换，做到幂等：
    /* __SPRITE_DATA_BEGIN__ */
    window.__SPRITE_DATA__ = { hero: 'data:image/png;base64,...', ... };
    /* __SPRITE_DATA_END__ */

用法：python tools/sprites_embed.py [index_arcane_v2.html]
前提：先跑 tools/sprites_quant.py 生成 sprites/out/q/*.png
"""
import base64
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Q_DIR = os.path.join(ROOT, "sprites", "out", "q")
BEGIN = "/* __SPRITE_DATA_BEGIN__ */"
END = "/* __SPRITE_DATA_END__ */"
ANCHOR = "/* ============================================================\n   v2.2.0 精灵接入"


def build_block():
    """读三张量化表，拼成 window.__SPRITE_DATA__ 赋值语句。"""
    parts = []
    for fam in ("hero", "mech", "rune"):
        path = os.path.join(Q_DIR, fam + "_sheet.png")
        if not os.path.exists(path):
            raise SystemExit("缺少量化图：" + path)
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        parts.append("  %s: 'data:image/png;base64,%s'" % (fam, b64))
    return (
        BEGIN + "\n"
        "/* v2.2.0 精灵贴图数据（base64，A.2 量化）。由 tools/sprites_embed.py 自动生成，勿手改。 */\n"
        "window.__SPRITE_DATA__ = {\n" + ",\n".join(parts) + "\n};\n"
        + END + "\n"
    )


def main():
    """注入 / 替换数据块，打印注入前后字节数。"""
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "index_arcane_v2.html")
    with io.open(target, "r", encoding="utf-8") as f:
        html = f.read()
    before = os.path.getsize(target)
    block = build_block()

    if BEGIN in html and END in html:
        head = html[:html.index(BEGIN)]
        tail = html[html.index(END) + len(END):]
        html = head + block + tail
    else:
        idx = html.index(ANCHOR)
        html = html[:idx] + block + html[idx:]

    with io.open(target, "w", encoding="utf-8", newline="") as f:
        f.write(html)
    after = os.path.getsize(target)
    print("注入完成：%d → %d B（数据块 %d B）" % (before, after, len(block.encode("utf-8"))))


if __name__ == "__main__":
    main()
