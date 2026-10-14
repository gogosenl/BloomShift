from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]


def optimize(relative_path: str, max_size: int) -> None:
    path = ROOT / relative_path
    image = Image.open(path).convert("RGBA")
    image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    image.save(path, optimize=True)


def normalize_alpha(relative_path: str, size: int = 384) -> None:
    path = ROOT / relative_path
    image = Image.open(path).convert("RGBA")
    bounds = image.getchannel("A").getbbox()
    if not bounds:
        return
    subject = image.crop(bounds)
    side = max(subject.width, subject.height)
    padding = max(12, round(side * 0.08))
    canvas = Image.new("RGBA", (side + padding * 2, side + padding * 2))
    canvas.alpha_composite(
        subject,
        (
            (canvas.width - subject.width) // 2,
            (canvas.height - subject.height) // 2,
        ),
    )
    canvas.resize((size, size), Image.Resampling.LANCZOS).save(
        path, optimize=True
    )


for flower_path in (ROOT / "assets" / "art" / "flowers").glob("*.png"):
    optimize(str(flower_path.relative_to(ROOT)), 384)

for medallion_path in (ROOT / "assets" / "art" / "levels").glob("*.png"):
    optimize(str(medallion_path.relative_to(ROOT)), 384)

optimize("assets/art/rewards/reward-bouquet.png", 768)
optimize("assets/art/board/cell-herbarium-frame.png", 512)

for control_icon in (
    "assets/icons/action-settings.png",
    "assets/icons/action-rotate-left.png",
    "assets/icons/action-rotate-right.png",
):
    normalize_alpha(control_icon)

print("Optimized production art assets.")
