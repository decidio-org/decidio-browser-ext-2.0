"""Redraws the toolbar icon as the floating button's mark.

The mark is "d." set in Neue Haas Grotesk Display 75 Bd on a rounded plate —
the same thing the in-page toggle button draws with CSS, so the tab icon and
the button on the page are one mark at two sizes. The glyph is SET, not
constructed: an earlier version drew the bowl and stem as primitives, which
was close but not the typeface.

The shipped font is woff2, which PIL cannot read, so it is converted to ttf
in memory with fontTools (needs the `brotli` module for woff2).
"""
import io as _io
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

BLACK = (0, 0, 0, 255)
BLUE  = (58, 111, 172, 255)     # Decidio Blue, as the original icon used it
GREEN = (81, 145, 75, 255)
WHITE = (255, 255, 255, 255)

FONT_WOFF2 = 'fonts/NHaasGroteskDSStd-75Bd.woff2'

def _ttf_bytes(woff2_path):
    f = TTFont(woff2_path)
    buf = _io.BytesIO()
    f.flags = 0
    f.save(buf)
    return buf.getvalue()

def draw(bg, dot, path, size=512, ss=4, font_ttf=None, scale=0.78):
    S = size * ss
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    # 22% corner — the same proportion the floating button carries.
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(0.22 * S), fill=bg)

    font = ImageFont.truetype(_io.BytesIO(font_ttf), int(S * scale))

    # Measured on the ink, not the em box: a lowercase d is all ascender and
    # no descender, so centring on the em box sits the mark low.
    wD = d.textlength('d', font=font)
    wDot = d.textlength('.', font=font)
    box = d.textbbox((0, 0), 'd.', font=font)
    x = (S - (wD + wDot)) / 2 - box[0]
    y = (S - (box[3] - box[1])) / 2 - box[1]

    d.text((x, y), 'd', font=font, fill=WHITE)
    d.text((x + wD, y), '.', font=font, fill=dot)

    im.resize((size, size), Image.LANCZOS).save(path)

if __name__ == '__main__':
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    src = sys.argv[2] if len(sys.argv) > 2 else FONT_WOFF2
    ttf = _ttf_bytes(src)
    draw(BLACK, BLUE,  out + '/default_logo.png', size=128, font_ttf=ttf)
    draw(BLUE,  GREEN, out + '/active_logo.png',  size=128, font_ttf=ttf)
    print('written')
