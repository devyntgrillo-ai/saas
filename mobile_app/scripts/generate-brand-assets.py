#!/usr/bin/env python3
"""Generate mobile app icons & splash from official CaseLift brand assets (caselift.io)."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "brand-source"
IMG = ROOT / "assets" / "images"
# caselift.io theme-color / splash background
BRAND_BG = (15, 23, 42, 255)  # #0f172a


def load_mark() -> Image.Image:
    return Image.open(SRC / "favicon.png").convert("RGBA")


def load_wordmark() -> Image.Image:
    return Image.open(SRC / "caselift-logo.png").convert("RGBA")


def square_canvas(image: Image.Image, size: int, bg: tuple[int, int, int, int] | None = None) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
    scale = min(size / image.width, size / image.height)
    w, h = int(image.width * scale), int(image.height * scale)
    resized = image.resize((w, h), Image.Resampling.LANCZOS)
    canvas.paste(resized, ((size - w) // 2, (size - h) // 2), resized)
    return canvas


def compose_on_bg(mark: Image.Image, size: int, padding: float = 0.22) -> Image.Image:
    bg = Image.new("RGBA", (size, size), BRAND_BG)
    inner = int(size * (1 - padding * 2))
    fitted = square_canvas(mark, inner)
    offset = (size - inner) // 2
    bg.paste(fitted, (offset, offset), fitted)
    return bg


def adaptive_foreground(mark: Image.Image, size: int = 1024) -> Image.Image:
    """Android adaptive icon safe zone ~66% diameter."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(size * 0.56)
    fitted = square_canvas(mark, inner)
    offset = (size - inner) // 2
    canvas.paste(fitted, (offset, offset), fitted)
    return canvas


def splash_image(wordmark: Image.Image, width: int = 1284, height: int = 2778) -> Image.Image:
    bg = Image.new("RGBA", (width, height), BRAND_BG)
    target_w = int(width * 0.62)
    scale = target_w / wordmark.width
    target_h = int(wordmark.height * scale)
    logo = wordmark.resize((target_w, target_h), Image.Resampling.LANCZOS)
    x = (width - target_w) // 2
    y = (height - target_h) // 2 - int(height * 0.06)
    bg.paste(logo, (x, y), logo)
    return bg


def save(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG")
    print(f"wrote {path}")


def main() -> None:
    if not (SRC / "favicon.png").exists():
        raise SystemExit(
            "Missing brand-source assets. Download from https://www.caselift.io/ into assets/brand-source/"
        )

    mark = load_mark()
    wordmark = load_wordmark()

    launcher_icon = compose_on_bg(mark, 1024)
    foreground = adaptive_foreground(mark, 1024)
    splash_full = splash_image(wordmark)
    # Android 12+ masks the splash icon in a circle — wide wordmarks get cropped.
    # Use the square app mark (same as launcher icon) for the native splash asset.
    splash_icon = compose_on_bg(mark, 1024, padding=0.18)

    save(IMG / "icon.png", launcher_icon)
    save(IMG / "android-icon-foreground.png", foreground)
    save(IMG / "adaptive-icon.png", launcher_icon)
    save(IMG / "android-icon-monochrome.png", foreground.convert("L").convert("RGBA"))
    save(IMG / "android-icon-background.png", Image.new("RGBA", (1024, 1024), BRAND_BG))
    save(IMG / "splash-icon.png", splash_icon)
    save(IMG / "splash-full.png", splash_full)
    save(IMG / "favicon.png", mark)

    save(ROOT / "assets" / "icon.png", launcher_icon)
    save(ROOT / "assets" / "splash-icon.png", splash_icon)
    save(ROOT / "assets" / "favicon.png", mark)
    save(ROOT / "assets" / "adaptive-icon.png", launcher_icon)


if __name__ == "__main__":
    main()
