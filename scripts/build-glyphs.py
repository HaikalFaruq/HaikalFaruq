"""Extract Geist and Geist Mono outlines into scripts/glyphs.json.

The profile graphics are loaded by GitHub as <img>, where web fonts are not
reliable, so render.mjs draws text from these outlines instead. Run this only
when the character set or weights change:

    pip install fonttools uharfbuzz
    curl -LO "https://raw.githubusercontent.com/google/fonts/main/ofl/geist/Geist%5Bwght%5D.ttf"
    curl -LO "https://raw.githubusercontent.com/google/fonts/main/ofl/geistmono/GeistMono%5Bwght%5D.ttf"
    python scripts/build-glyphs.py Geist[wght].ttf GeistMono[wght].ttf

Geist is licensed under the SIL Open Font License 1.1 (scripts/OFL.txt).
"""

import json
import sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

CHARS = "".join(chr(c) for c in range(32, 127)) + "·→↗•×…–’“”●↑↓°"
STYLES = [
    ("sans-400", 0, 400, True),
    ("sans-500", 0, 500, True),
    ("sans-600", 0, 600, True),
    ("mono-400", 1, 400, False),
    ("mono-500", 1, 500, False),
]
MIN_KERN = 4  # font units; smaller adjustments are invisible at card sizes


def outline(glyph_set, name):
    pen = SVGPathPen(glyph_set, ntos=lambda v: str(round(v)))
    glyph_set[name].draw(TransformPen(pen, (1, 0, 0, -1, 0, 0)))
    return pen.getCommands()


def build_style(path, weight, with_kerning):
    font = instancer.instantiateVariableFont(TTFont(path), {"wght": weight})
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    names = {c: cmap[ord(c)] for c in CHARS}
    advance = {c: hmtx[names[c]][0] for c in CHARS}

    style = {
        "upm": font["head"].unitsPerEm,
        "cap": font["OS/2"].sCapHeight,
        "xh": font["OS/2"].sxHeight,
        "glyphs": {c: [advance[c], outline(glyph_set, names[c])] for c in CHARS},
        "kern": {},
    }

    if with_kerning:
        hb_font = hb.Font(hb.Face(hb.Blob.from_file_path(path)))
        hb_font.set_variations({"wght": weight})
        for a in CHARS:
            for b in CHARS:
                buf = hb.Buffer()
                buf.add_str(a + b)
                buf.guess_segment_properties()
                hb.shape(hb_font, buf, {"liga": False, "calt": False})
                if len(buf.glyph_infos) != 2:
                    continue
                k = buf.glyph_positions[0].x_advance - advance[a]
                if abs(k) >= MIN_KERN:
                    style["kern"][a + b] = k
    return style


def main():
    fonts = sys.argv[1:3]
    out = {name: build_style(fonts[idx], weight, kern) for name, idx, weight, kern in STYLES}
    target = Path(__file__).with_name("glyphs.json")
    target.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {target} ({target.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
