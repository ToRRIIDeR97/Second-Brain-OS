"""Render the Tenon Workbench mark into every icon file of the desktop and web app.

Usage, from the repository root: python opencode/packages/desktop/scripts/render-icons.py .
Requires Python 3 with Pillow. Not part of the build; rerun only when the mark changes.
The glyph is defined on a 120-unit grid, matching the canvas artboard SVG.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(sys.argv[1])
SS = 4  # supersampling factor

BLUE = (0x3B, 0x5C, 0xF6)
WHITE = (0xFF, 0xFF, 0xFF)
LIGHT = (0xEC, 0xF1, 0xFE)
CHANNELS = {"dev": (BLUE, WHITE), "prod": (BLUE, WHITE), "beta": (LIGHT, BLUE)}


def mix(fg, bg, a):
    return tuple(round(f * a + b * (1 - a)) for f, b in zip(fg, bg))


# The right half's two tabs sit in matching slots cut into the left half.
# Each tab: centre y, tip x, half-width TAB; the slot leaves a GAP all round it.
TABS = [(45, 47), (71, 43)]
TAB = 4
GAP = 4.5


def glyph(draw, s, ox, oy, tile, fg, knock):
    """Draw the two interlocking halves. s = px per unit, (ox, oy) = origin in px."""
    p = lambda x, y: (ox + x * s, oy + y * s)
    r = 18 * s
    right = mix(fg, tile, 0.6) + (255,)
    draw.rounded_rectangle([p(26, 28), p(58, 88)], r, fill=fg + (255,), corners=(True, False, False, True))
    slot = TAB + GAP
    for c, tip in TABS:
        # Slot: stadium from the tab tip minus the gap, running past the seam so its mouth stays square.
        draw.rounded_rectangle([p(tip - GAP, c - slot), p(58 + 2 * slot, c + slot)], slot * s, fill=knock)
    draw.rounded_rectangle([p(64, 34), p(94, 92)], r, fill=right, corners=(False, True, True, False))
    for c, tip in TABS:
        # Tab: stadium from its tip into the right half's body.
        draw.rounded_rectangle([p(tip, c - TAB), p(66 + 2 * TAB, c + TAB)], TAB * s, fill=right)


def render(size, tile, fg, kind="squircle"):
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    knock = tile + (255,)
    if kind == "squircle":
        s = n / 120
        d.rounded_rectangle([0, 0, n - 1, n - 1], 32 * s, fill=tile + (255,))
        glyph(d, s, 0, 0, tile, fg, knock)
    if kind == "square":
        d.rectangle([0, 0, n, n], fill=tile + (255,))
        glyph(d, n / 120, 0, 0, tile, fg, knock)
    if kind == "round":
        d.ellipse([0, 0, n - 1, n - 1], fill=tile + (255,))
        s = n / 120 * 0.9
        glyph(d, s, n * 0.05, n * 0.05, tile, fg, knock)
    if kind == "mac":
        # Big Sur grid: 824/1024 tile centred, so the Dock shows the expected inset.
        t = n * 824 / 1024
        o = (n - t) / 2
        s = t / 120
        d.rounded_rectangle([o, o, o + t, o + t], 32 * s, fill=tile + (255,))
        glyph(d, s, o, o, tile, fg, knock)
    if kind == "foreground":
        # Android adaptive foreground: glyph inside the 66% safe zone, grooves cut to transparent.
        s = n / 120 * 0.66
        o = n * 0.17
        glyph(d, s, o, o, tile, fg, (0, 0, 0, 0))
    return img.resize((size, size), Image.LANCZOS)


def kind_for(path):
    name = path.name
    if name == "dock.png":
        return "mac"
    if "_round" in name:
        return "round"
    if "_foreground" in name:
        return "foreground"
    if "ios" in path.parts:
        return "square"
    return "squircle"


def channel(folder, tile, fg):
    for png in sorted(folder.rglob("*.png")):
        size = Image.open(png).size[0]
        render(size, tile, fg, kind_for(png)).save(png)
    ico = folder / "icon.ico"
    big = render(256, tile, fg)
    big.save(ico, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)])
    render(1024, tile, fg, "mac").save(folder / "icon.icns", format="ICNS")
    bg = folder / "android" / "values" / "ic_launcher_background.xml"
    if bg.exists():
        hexc = "#%02x%02x%02x" % tile
        bg.write_text(bg.read_text().replace("<color name=\"ic_launcher_background\">#fff</color>",
                                             f"<color name=\"ic_launcher_background\">{hexc}</color>"))


def web(public, tile, fg):
    for name in ["favicon-96x96.png", "favicon-96x96-v3.png", "apple-touch-icon.png", "apple-touch-icon-v3.png",
                 "web-app-manifest-192x192.png", "web-app-manifest-512x512.png"]:
        png = public / name
        size = Image.open(png).size[0]
        kind = "square" if name.startswith("apple-touch") else "squircle"
        render(size, tile, fg, kind).save(png)
    for name in ["favicon.ico", "favicon-v3.ico"]:
        render(256, tile, fg).save(public / name, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])


if __name__ == "__main__":
    icons = ROOT / "opencode" / "packages" / "desktop" / "icons"
    for name, (tile, fg) in CHANNELS.items():
        channel(icons / name, tile, fg)
        print("rendered", name)
    web(ROOT / "opencode" / "packages" / "app" / "public", BLUE, WHITE)
    print("rendered web")
