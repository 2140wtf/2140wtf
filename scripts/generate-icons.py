#!/usr/bin/env python3
"""Generate 2140.wtf branded app icons from the source logo.

This replaces the old Ditto/2140 two-color wordmark workflow that relied on
`public/logo.svg` and ImageMagick. It uses Pillow to rasterize the source logo
(`public/logo.png`, RGBA with transparency) onto the 2140 dark theme palette.

Outputs:
  - public/logo.jpg
  - public/icon-192.png
  - public/icon-512.png
  - public/apple-touch-icon.png
  - public/favicon.ico
  - Android mipmap icons (legacy + adaptive foreground)
  - iOS AppIcon-512@2x.png (when the asset catalog exists)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError as exc:  # pragma: no cover
    print("Error: Pillow is required to generate icons.")
    print("Install it with: python3 -m pip install Pillow")
    raise SystemExit(1) from exc

ROOT = Path(__file__).resolve().parents[1]

# Source logo must be an RGBA PNG with transparency.
SOURCE_LOGO = ROOT / "public" / "logo.png"

# 2140.wtf brand palette.
BACKGROUND = (0, 0, 0)  # black

# Output directories.
PUBLIC_DIR = ROOT / "public"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
IOS_ICON_DIR = ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset"

# Android density -> launcher pixel size.
ANDROID_DENSITIES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}


def load_source() -> Image.Image:
    if not SOURCE_LOGO.exists():
        print(f"Error: source logo not found at {SOURCE_LOGO}", file=sys.stderr)
        raise SystemExit(1)

    src = Image.open(SOURCE_LOGO).convert("RGBA")
    # Ensure we have a true alpha channel; anything fully transparent stays transparent.
    return src


def center_paste(canvas: Image.Image, asset: Image.Image, scale: float) -> Image.Image:
    """Resize `asset` to `scale` fraction of canvas width and paste centered."""
    size = canvas.size[0]
    target = int(size * scale)
    resized = asset.resize((target, target), Image.LANCZOS)
    x = (size - target) // 2
    y = (size - target) // 2
    canvas.paste(resized, (x, y), resized)
    return canvas


def make_square_icon(size: int, scale: float = 0.6, background: tuple[int, int, int] = BACKGROUND) -> Image.Image:
    img = Image.new("RGBA", (size, size), (*background, 255))
    center_paste(img, SOURCE, scale)
    return img


def make_round_icon(size: int, scale: float = 0.6, background: tuple[int, int, int] = BACKGROUND) -> Image.Image:
    square = make_square_icon(size, scale, background)
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size, size), fill=255)
    rounded = Image.new("RGBA", (size, size), (*background, 255))
    rounded.paste(square, (0, 0), mask)
    return rounded


def make_foreground(size: int, scale: float = 0.47) -> Image.Image:
    """Adaptive icon foreground: transparent bg, logo within safe zone."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    center_paste(img, SOURCE, scale)
    return img


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")
    print(f"  ✓ {path.relative_to(ROOT)}")


def save_jpeg(img: Image.Image, path: Path, quality: int = 95) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Flatten onto black for JPEG.
    bg = Image.new("RGB", img.size, BACKGROUND)
    bg.paste(img, mask=img.split()[3])
    bg.save(path, "JPEG", quality=quality)
    print(f"  ✓ {path.relative_to(ROOT)}")


def save_ico(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Build a multi-resolution icon.
    sizes = [16, 32, 48]
    frames: list[Image.Image] = []
    for s in sizes:
        frame = make_square_icon(s, scale=0.75 if s <= 32 else 0.65)
        # ICO wants RGB or PNG-encoded frames; paste on black for compatibility.
        rgb = Image.new("RGB", frame.size, BACKGROUND)
        rgb.paste(frame, mask=frame.split()[3])
        frames.append(rgb)
    frames[0].save(path, format="ICO", sizes=[(s, s) for s in sizes])
    print(f"  ✓ {path.relative_to(ROOT)}")


def generate_web_icons() -> None:
    print("Generating web icons...")
    save_jpeg(make_square_icon(200, scale=0.75), PUBLIC_DIR / "logo.jpg")
    save_png(make_square_icon(180, scale=0.55), PUBLIC_DIR / "apple-touch-icon.png")
    save_png(make_square_icon(192, scale=0.47), PUBLIC_DIR / "icon-192.png")
    save_png(make_square_icon(512, scale=0.47), PUBLIC_DIR / "icon-512.png")
    save_ico(SOURCE, PUBLIC_DIR / "favicon.ico")


def generate_android_icons() -> None:
    print("Generating Android launcher icons...")
    for density, size in ANDROID_DENSITIES.items():
        mipmap = ANDROID_RES / f"mipmap-{density}"
        save_png(make_foreground(size, scale=0.47), mipmap / "ic_launcher_foreground.png")
        save_png(make_square_icon(size, scale=0.60), mipmap / "ic_launcher.png")
        save_png(make_round_icon(size, scale=0.60), mipmap / "ic_launcher_round.png")

    # Adaptive icon XML points to this color as the background layer.
    values_dir = ANDROID_RES / "values"
    values_dir.mkdir(parents=True, exist_ok=True)
    bg_file = values_dir / "ic_launcher_background.xml"
    bg_file.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        '    <color name="ic_launcher_background">#000000</color>\n'
        '</resources>\n',
        encoding="utf-8",
    )
    print(f"  ✓ {bg_file.relative_to(ROOT)}")


def generate_ios_icon() -> None:
    if not IOS_ICON_DIR.exists():
        print("Skipping iOS icon (asset catalog not found).")
        return

    print("Generating iOS app icon...")
    icon = IOS_ICON_DIR / "AppIcon-512@2x.png"
    save_png(make_square_icon(1024, scale=0.60), icon)


def main() -> int:
    global SOURCE
    SOURCE = load_source()
    print(f"Source logo: {SOURCE_LOGO} ({SOURCE.size[0]}x{SOURCE.size[1]})\n")

    generate_web_icons()
    generate_android_icons()
    generate_ios_icon()

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
