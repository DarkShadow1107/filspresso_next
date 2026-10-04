SANDBOX_IMAGE_SCRIPT = """
import base64
import io
import json

from PIL import Image, ImageFilter, ImageStat

try:
    import pillow_heif

    pillow_heif.register_heif_opener()
except Exception:
    pass

raw = base64.b64decode(INPUT["image_b64"])
image = Image.open(io.BytesIO(raw))
image.load()
rgb = image.convert("RGB")
small = rgb.resize((64, 64))
pixels = list(small.getdata())
average = tuple(sum(channel) // len(pixels) for channel in zip(*pixels))
brightness = round(sum(average) / 3 / 255, 3)
stat = ImageStat.Stat(rgb)
edge = rgb.filter(ImageFilter.FIND_EDGES)
edge_ratio = round(sum(edge.convert("L").getdata()) / (255 * edge.width * edge.height), 4)
dominant = sorted(small.getcolors(64 * 64) or [], reverse=True)[:5]
dominant_palette = ["#{:02x}{:02x}{:02x}".format(*color[:3]) for _, color in dominant]
result = {
    "format": str(image.format or INPUT.get("mime", "")),
    "mode": image.mode,
    "width": image.width,
    "height": image.height,
    "aspect_ratio": round(image.width / max(image.height, 1), 3),
    "megapixels": round(image.width * image.height / 1_000_000, 2),
    "mean_rgb": [round(v, 1) for v in stat.mean],
    "stddev_rgb": [round(v, 1) for v in stat.stddev],
    "average_color_hex": "#{:02x}{:02x}{:02x}".format(*average),
    "brightness": brightness,
    "is_dark": brightness < 0.35,
    "edge_density": edge_ratio,
    "palette_dominant": dominant_palette,
    "unique_colors_64px": len(set(pixels)),
}
"""
