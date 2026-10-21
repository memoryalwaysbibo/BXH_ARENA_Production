#!/usr/bin/env python3
"""Split existing 3x3 BXH ladder sprite into nine transparent lightweight WebP badges."""
from collections import deque
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/ladder-gods-trial-transparent.png"
DEST = ROOT / "assets/rank-badges"
NAMES = ("unranked", "bronze", "silver", "gold", "platinum",
         "diamond", "master", "grandmaster", "legend")

def remove_exterior_white(image):
    image = image.convert("RGBA")
    # Keep all existing alpha if the source already has a transparent exterior.
    if image.getpixel((0, 0))[3] < 64:
        return image
    w, h = image.size
    pixels = image.load()
    visited = bytearray(w * h)
    queue = deque()
    def is_white(x, y):
        r, g, b, a = pixels[x, y]
        return a > 0 and min(r, g, b) >= 239 and max(r, g, b) - min(r, g, b) <= 15
    for x in range(w):
        for y in (0, h - 1):
            if is_white(x, y): queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_white(x, y): queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        idx = y * w + x
        if visited[idx] or not is_white(x, y): continue
        visited[idx] = 1
        r, g, b, _ = pixels[x, y]
        pixels[x, y] = (r, g, b, 0)
        if x: queue.append((x - 1, y))
        if x + 1 < w: queue.append((x + 1, y))
        if y: queue.append((x, y - 1))
        if y + 1 < h: queue.append((x, y + 1))
    return image

def main():
    image = Image.open(SOURCE).convert("RGBA")
    w, h = image.size
    assert w % 3 == 0 and h % 3 == 0, f"Expected exact 3x3 sprite, got {image.size}"
    cell_w, cell_h = w // 3, h // 3
    DEST.mkdir(parents=True, exist_ok=True)
    for n, name in enumerate(NAMES):
        x, y = n % 3, n // 3
        icon = image.crop((x * cell_w, y * cell_h,
                           (x + 1) * cell_w, (y + 1) * cell_h))
        icon = remove_exterior_white(icon)
        bounds = icon.getchannel("A").getbbox()
        assert bounds, f"Empty badge {name}"
        icon = icon.crop(bounds)
        icon.thumbnail((236, 236), Image.Resampling.LANCZOS)
        output = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        output.alpha_composite(icon, ((256 - icon.width) // 2,
                                       (256 - icon.height) // 2))
        target = DEST / f"rank-{name}.webp"
        output.save(target, "WEBP", quality=86, method=6)
        assert Image.open(target).size == (256, 256)
        print(f"{name}: {target.stat().st_size} bytes")
if __name__ == "__main__":
    main()
