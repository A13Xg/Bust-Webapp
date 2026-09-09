#!/usr/bin/env python3
"""
Derive every shipped icon from the two master images in art/.

    python scripts/generate-icons.py

Two masters, two destinations, deliberately independent:

  art/Favicon.png  -> public/icons/favicon-*.png   (browser tabs only)
  art/PWA-icon.png -> public/icons/icon-*.png,     (installed app, every OS:
                      apple-touch-icon.png          Android, desktop and iOS)

Alpha is preserved wherever the platform honours it. The two exceptions are
forced opaque on purpose, not by accident:

  * maskable  - Android scales the art up and applies its OWN mask, so any
                transparent region shows the launcher background through the
                icon. Maskable art must be full-bleed, with its content inside
                the inner 80% safe circle or the edges get cropped away.
  * apple-touch-icon - iOS ignores alpha entirely and composites onto black,
                then rounds the corners itself.

Both are flattened onto APP_BG (the manifest background_color), which is within
a hair of the black iOS would have used anyway.

badge-96.png is NOT generated here: it is the monochrome notification badge,
a different job from the app icon.
"""

import pathlib
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: python -m pip install Pillow")

ROOT = pathlib.Path(__file__).resolve().parent.parent
ART = ROOT / "art"
ICONS = ROOT / "public" / "icons"

APP_BG = (10, 10, 11, 255)  # --bg, and manifest background_color
FAVICON_SIZES = (16, 32, 48, 192)
MASKABLE_SAFE = 0.8  # content occupies the inner 80% circle


def load(name):
    path = ART / name
    if not path.exists():
        sys.exit(f"missing master: {path.relative_to(ROOT)}")
    image = Image.open(path).convert("RGBA")
    if image.width != image.height:
        print(f"  ! {name} is {image.width}x{image.height}, not square — it will be squashed")
    return image


def scaled(image, size):
    return image.resize((size, size), Image.LANCZOS)


def flattened(image):
    base = Image.new("RGBA", image.size, APP_BG)
    base.alpha_composite(image)
    return base.convert("RGB")


def save(image, name):
    out = ICONS / name
    image.save(out, optimize=True)
    kb = out.stat().st_size / 1024
    alpha = "alpha" if "A" in image.getbands() else "opaque"
    print(f"  {name:26} {image.width:>4}px  {alpha:6} {kb:7.1f} KB")


def main():
    ICONS.mkdir(parents=True, exist_ok=True)

    print("browser favicons  <- art/Favicon.png")
    favicon = load("Favicon.png")
    for size in FAVICON_SIZES:
        save(scaled(favicon, size), f"favicon-{size}.png")

    print("installed app     <- art/PWA-icon.png")
    pwa = load("PWA-icon.png")
    save(scaled(pwa, 192), "icon-192.png")
    save(scaled(pwa, 512), "icon-512.png")

    inner = round(512 * MASKABLE_SAFE)
    canvas = Image.new("RGBA", (512, 512), APP_BG)
    canvas.alpha_composite(scaled(pwa, inner), ((512 - inner) // 2, (512 - inner) // 2))
    save(flattened(canvas), "icon-maskable-512.png")

    save(flattened(scaled(pwa, 180)), "apple-touch-icon.png")


if __name__ == "__main__":
    main()
