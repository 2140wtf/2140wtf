#!/usr/bin/env python3
"""Generate themed background images for Ditto theme presets."""

import os
import random
import math
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'themes')
WIDTH, HEIGHT = 1920, 1080
FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'


def save(img: Image.Image, name: str) -> str:
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f'{name}.png')
    img.save(path, 'PNG')
    return path


def hacker() -> Image.Image:
    img = Image.new('RGB', (WIDTH, HEIGHT), '#050a05')
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype(FONT_PATH, 18)
        big_font = ImageFont.truetype(FONT_PATH, 120)
    except Exception:
        font = ImageFont.load_default()
        big_font = font

    # Matrix-like characters
    chars = '01abc{}[]<>/\\$#@%&*'
    random.seed(42)
    for col in range(0, WIDTH, 22):
        for row in range(0, HEIGHT, 28):
            if random.random() < 0.18:
                ch = random.choice(chars)
                alpha = random.choice(['#0f2a0f', '#1a4a1a', '#2eff2e', '#00ff00'])
                draw.text((col, row), ch, fill=alpha, font=font)

    # Terminal prompt
    prompt = '> ./enter_the_matrix'
    draw.text((80, HEIGHT - 180), prompt, fill='#00ff41', font=big_font)
    cursor_x = 80 + draw.textlength(prompt, font=big_font) + 8
    draw.rectangle([cursor_x, HEIGHT - 180, cursor_x + 24, HEIGHT - 70], fill='#00ff41')
    return img


def space() -> Image.Image:
    img = Image.new('RGB', (WIDTH, HEIGHT), '#07020d')
    draw = ImageDraw.Draw(img)

    # Deep gradient
    for y in range(HEIGHT):
        t = y / HEIGHT
        r = int(7 + (40 - 7) * t)
        g = int(2 + (10 - 2) * t)
        b = int(13 + (50 - 13) * t)
        draw.line([(0, y), (WIDTH, y)], fill=(r, g, b))

    random.seed(99)
    # Stars
    for _ in range(400):
        x = random.randint(0, WIDTH)
        y = random.randint(0, HEIGHT)
        size = random.choice([1, 1, 2, 2, 3])
        brightness = random.choice(['#ffffff', '#fffacd', '#e0ffff', '#dda0dd', '#87cefa'])
        draw.ellipse([x, y, x + size, y + size], fill=brightness)

    # Nebula clouds
    for _ in range(8):
        cx = random.randint(0, WIDTH)
        cy = random.randint(0, HEIGHT)
        r = random.randint(150, 400)
        color = random.choice([(80, 20, 120, 30), (20, 60, 120, 30), (120, 20, 80, 30)])
        for i in range(r, 0, -4):
            alpha = int(30 * (i / r))
            draw.ellipse([cx - i, cy - i, cx + i, cy + i], fill=(color[0], color[1], color[2], alpha))
    return img


def banana() -> Image.Image:
    img = Image.new('RGB', (WIDTH, HEIGHT), '#fff176')
    draw = ImageDraw.Draw(img)

    # Subtle radial burst
    cx, cy = WIDTH // 2, HEIGHT // 2
    max_r = int(math.hypot(WIDTH, HEIGHT) / 2)
    for r in range(max_r, 0, -4):
        t = r / max_r
        yellow = (255, int(235 - 40 * t), int(100 + 40 * t))
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=yellow)

    random.seed(123)
    # Banana shapes
    for _ in range(30):
        x = random.randint(0, WIDTH)
        y = random.randint(0, HEIGHT)
        length = random.randint(80, 200)
        # Crescent using arc
        bbox = [x, y, x + length, y + length // 2]
        draw.arc(bbox, start=20, end=160, fill='#6d4c41', width=14)
        draw.arc(bbox, start=25, end=155, fill='#ffeb3b', width=10)

    return img


def main():
    print('Generating theme backgrounds...')
    print(save(hacker(), 'hacker'))
    print(save(space(), 'space'))
    print(save(banana(), 'banana'))
    print('Done.')


if __name__ == '__main__':
    main()
