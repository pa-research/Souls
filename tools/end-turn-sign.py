"""The wooden End Turn sign of both game clients in another language.

Paints the letters of Content/Images/endturn.png (and endturn_disabled.png) off the planks, then letters the sign
again in Archivo Black (the classic client's font): green when it is the player's turn, grey-green when not, with
the planks' seams across the letters like the original. The clients load the image named by `art.endTurn` /
`art.endTurnDisabled` in the string tables (Souls.Model/Localization/game.{language}.json).

    python3 tools/end-turn-sign.py nb "Avslutt tur"
"""
import random
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / "src/Souls.Web/wwwroot/Content/Images"
FONT = ROOT / "src/Souls.Web/wwwroot/Content/ArchivoBlack-Regular.otf"
BOX = (22, 16, 478, 168)  # where the letters go


def letter_mask(on: Image.Image, off: Image.Image) -> Image.Image:
    """The old letters: where the two images differ (the fill) or are dark (the outline), inside the lettering box."""
    differ = ImageChops.difference(on.convert("RGB"), off.convert("RGB")).convert("L").point(lambda v: 255 if v > 24 else 0)
    dark = on.convert("L").point(lambda v: 255 if v < 70 else 0)
    mask = ImageChops.lighter(differ, dark)
    box = Image.new("L", on.size, 0)
    ImageDraw.Draw(box).rectangle(BOX, fill=255)
    return ImageChops.multiply(mask, box).filter(ImageFilter.MaxFilter(7))


def blank(sign: Image.Image, mask: Image.Image, seed: int) -> Image.Image:
    """Fills the letters with wood from the same row (the grain runs along the planks), then smooths it along the row."""
    rng = random.Random(seed)
    px, m = sign.load(), mask.load()
    w, h = sign.size
    out = sign.copy()
    o = out.load()
    for y in range(h):
        wood = [px[x, y] for x in range(w) if not m[x, y] and px[x, y][3] == 255]
        if not wood:
            continue
        start = rng.randrange(len(wood))
        for i, x in enumerate(x for x in range(w) if m[x, y]):
            o[x, y] = (*wood[(start + i) % len(wood)][:3], px[x, y][3])
    smooth = out.filter(ImageFilter.BoxBlur(2))
    return Image.composite(smooth, out, mask)


def seams(plank: Image.Image) -> list[float]:
    """How much darker each row is than the rows around it: the gaps between the planks."""
    gray = plank.convert("L")
    w, h = gray.size
    rows = [sum(gray.getpixel((x, y)) for x in range(60, w - 60)) / (w - 120) for y in range(h)]
    out = []
    for y in range(h):
        around = rows[max(0, y - 8):y + 9]
        out.append(min(1.0, rows[y] / (sum(around) / len(around))))
    return out


def lettering(text: str, size: tuple[int, int], fill: tuple, stroke: tuple, seed: int) -> Image.Image:
    """The text, a little wobbly like painted letters, scaled into the box."""
    rng = random.Random(seed)
    font = ImageFont.truetype(str(FONT), 120)
    letters = []
    for ch in text:
        if ch == " ":
            letters.append(None)
            continue
        l, t, r, b = font.getbbox(ch, stroke_width=14)
        img = Image.new("RGBA", (r - l + 20, 200), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.text((10 - l, 30), ch, font=font, fill=fill[0], stroke_width=14, stroke_fill=stroke)
        # A lighter top half, like the original's painted highlight.
        top = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(top).text((10 - l, 30), ch, font=font, fill=fill[1])
        cut = Image.new("L", img.size, 0)
        ImageDraw.Draw(cut).rectangle((0, 0, img.size[0], 30 + (t + b) // 2), fill=255)
        img.alpha_composite(Image.composite(top, Image.new("RGBA", img.size), cut))
        letters.append(img.rotate(rng.uniform(-5, 5), resample=Image.BICUBIC))
    space = 30
    width = sum(i.size[0] - 40 if i else space for i in letters) + 40
    height = max(i.size[1] for i in letters if i)
    line = Image.new("RGBA", (width + 40, height + 40), (0, 0, 0, 0))
    x = 20
    for img in letters:
        if img is None:
            x += space
            continue
        line.alpha_composite(img, (x, 20 + (height - img.size[1]) // 2 + rng.randint(-6, 6)))
        x += img.size[0] - 40
    line = line.crop(line.getbbox())
    bw, bh = size
    scale = min(bw / line.size[0], bh / line.size[1])
    # Squeeze long words sideways rather than shrink them (down to 70 % of their width).
    sx, sy = scale, scale
    if bh / line.size[1] > scale:
        sy = min(bh / line.size[1], scale / 0.7)
    return line.resize((round(line.size[0] * sx), round(line.size[1] * sy)), Image.LANCZOS)


def sign(source: str, target: str, text: str, fill: tuple, stroke: tuple) -> None:
    on = Image.open(IMAGES / "endturn.png").convert("RGBA")
    off = Image.open(IMAGES / "endturn_disabled.png").convert("RGBA")
    base = on if source == "endturn.png" else off
    plank = blank(base, letter_mask(on, off), seed=7)
    letters = lettering(text, (BOX[2] - BOX[0], BOX[3] - BOX[1]), fill, stroke, seed=11)
    layer = Image.new("RGBA", plank.size, (0, 0, 0, 0))
    x = (plank.size[0] - letters.size[0]) // 2
    y = BOX[1] + (BOX[3] - BOX[1] - letters.size[1]) // 2
    shadow = Image.new("RGBA", letters.size, (20, 10, 0, 0))
    shadow.putalpha(letters.getchannel("A").point(lambda a: a * 0.45))
    layer.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(3)), (x + 3, y + 4))
    layer.alpha_composite(letters, (x, y))
    # The planks' seams run across the letters.
    dark = seams(plank)
    pl = layer.load()
    for yy in range(layer.size[1]):
        k = dark[yy]
        if k < 0.97:
            for xx in range(layer.size[0]):
                r, g, b, a = pl[xx, yy]
                if a:
                    pl[xx, yy] = (int(r * k), int(g * k), int(b * k), a)
    plank.alpha_composite(layer)
    plank.save(IMAGES / target, optimize=True)
    print("wrote", IMAGES / target)


if __name__ == "__main__":
    language, text = sys.argv[1], sys.argv[2]
    sign("endturn.png", f"endturn.{language}.png", text, ((84, 190, 40, 255), (126, 222, 70, 255)), (38, 24, 12, 255))
    sign("endturn_disabled.png", f"endturn_disabled.{language}.png", text, ((96, 120, 92, 255), (124, 146, 118, 255)), (38, 24, 12, 255))
