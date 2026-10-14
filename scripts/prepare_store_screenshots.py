from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter


TARGETS = {
    "iphone": (1242, 2688),
    "ipad": (2048, 2732),
    "android": (1080, 1920),
}


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_w, target_h = size
    scale = max(target_w / image.width, target_h / image.height)
    resized = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - target_w) // 2
    top = (resized.height - target_h) // 2
    return resized.crop((left, top, left + target_w, top + target_h))


def contain_with_background(
    image: Image.Image, size: tuple[int, int]
) -> Image.Image:
    target_w, target_h = size
    background = cover(image, size).filter(
        ImageFilter.GaussianBlur(radius=max(22, target_w // 32))
    )
    background = ImageEnhance.Brightness(background).enhance(0.78)

    scale = min(target_w / image.width, target_h / image.height)
    foreground = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    x = (target_w - foreground.width) // 2
    y = (target_h - foreground.height) // 2

    shadow_width = max(8, target_w // 120)
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    shadow_band = Image.new(
        "RGBA",
        (foreground.width + shadow_width * 2, foreground.height),
        (0, 0, 0, 72),
    ).filter(ImageFilter.GaussianBlur(radius=shadow_width))
    shadow.alpha_composite(shadow_band, (x - shadow_width, y))

    canvas = background.convert("RGBA")
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(foreground.convert("RGBA"), (x, y))
    return canvas.convert("RGB")


def save_under_limit(image: Image.Image, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, format="PNG", optimize=True, compress_level=9)
    if destination.stat().st_size <= 8_000_000:
        return destination

    jpeg_destination = destination.with_suffix(".jpg")
    image.save(
        jpeg_destination,
        format="JPEG",
        quality=95,
        optimize=True,
        progressive=True,
        subsampling=0,
    )
    destination.unlink()
    return jpeg_destination


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    source = args.source.resolve()

    files = sorted(
        (path for path in source.glob("*.png") if path.stem.isdigit()),
        key=lambda path: int(path.stem),
    )
    if not files:
        raise SystemExit(f"No numbered PNG screenshots found in {source}")

    for platform, size in TARGETS.items():
        destination_dir = source / platform
        for path in files:
            with Image.open(path) as opened:
                original = opened.convert("RGB")
                if platform == "iphone":
                    result = cover(original, size)
                else:
                    result = contain_with_background(original, size)
                saved = save_under_limit(
                    result, destination_dir / f"{path.stem}.png"
                )
                print(
                    f"{platform}/{saved.name}: "
                    f"{result.width}x{result.height}, "
                    f"{saved.stat().st_size / 1_000_000:.2f} MB"
                )


if __name__ == "__main__":
    main()
