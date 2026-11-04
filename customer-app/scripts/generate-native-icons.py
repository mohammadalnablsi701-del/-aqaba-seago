#!/usr/bin/env python3
"""Integrate the approved Direction A Customer artwork into Capacitor resources.

The supplied PNGs are the pixel authority. Resize only to required density sizes;
never redraw, extract, pad or transform the separately approved adaptive layers.
"""

from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/logo.svg"
MASTER = ROOT / "assets/icon-master-1024.png"
FOREGROUND = ROOT / "assets/android-adaptive-foreground-432.png"
BACKGROUND = ROOT / "assets/android-adaptive-background-432.png"
SVG = "http://www.w3.org/2000/svg"


def run(args):
    return subprocess.check_output([str(arg) for arg in args], text=True).strip()


def image_tools():
    if shutil.which("magick"):
        return ["magick"], ["magick", "identify"]
    if shutil.which("convert") and shutil.which("identify"):
        return ["convert"], ["identify"]
    raise ValueError("ImageMagick magick or convert/identify is required")


def render(source, target, size, transparent=False, adaptive=False):
    target.parent.mkdir(parents=True, exist_ok=True)
    convert, identify = image_tools()
    original = run(identify + ["-format", "%w %h %[opaque]", source]).split()
    if original[0] != original[1] or size > int(original[0]):
        raise ValueError(f"Square source at sufficient resolution required: {source}")
    if not transparent and original[2].lower() != "true":
        raise ValueError(f"Source artwork must be opaque; refusing to flatten: {source}")
    with tempfile.TemporaryDirectory(prefix="seago-icon-") as directory:
        output = Path(directory) / "output.png"
        if original[:2] == [str(size), str(size)]:
            shutil.copyfile(source, output)
        else:
            options = [] if transparent else ["-alpha", "off"]
            encoding = "PNG32" if transparent else "PNG24"
            # Lanczos2 keeps transparent-edge ringing inside the supplied
            # foreground's safe zone at mdpi, without changing its geometry.
            filter_name = "Lanczos2" if transparent else "Lanczos"
            run(convert + [source, "-filter", filter_name, "-resize", f"{size}x{size}"] +
                options + ["-strip", f"{encoding}:{output}"])
        actual = run(identify + ["-format", "%w %h %[opaque]", output]).split()
        if actual[:2] != [str(size), str(size)]:
            raise ValueError(f"Wrong dimensions for {target}: {actual}")
        if output.read_bytes()[25] != (6 if transparent else 2):
            raise ValueError(f"Expected true-color {'RGBA' if transparent else 'RGB'} PNG: {target}")
        if not transparent and actual[2].lower() != "true":
            raise ValueError(f"Opaque icon required: {target}")
        if adaptive:
            # Measure actual alpha pixels against Android's guaranteed central
            # 66/108 circle. Do not shrink the approved layer to make it pass.
            rgba = subprocess.check_output(convert + [str(output), "-depth", "8", "rgba:-"])
            visible = [index // 4 for index in range(3, len(rgba), 4) if rgba[index]]
            if not visible:
                raise ValueError(f"Adaptive foreground is empty: {target}")
            limit = 33 * size / 108
            if any(((pixel % size + 0.5 - size / 2) ** 2 +
                    (pixel // size + 0.5 - size / 2) ** 2) > limit ** 2
                   for pixel in visible):
                raise ValueError(f"Adaptive foreground exceeds the 33dp safe radius: {target}")
        shutil.copyfile(output, target)
    print(f"Branded {target.relative_to(ROOT)} ({size}x{size})")


def background_color():
    root = ET.parse(ROOT / "assets/android-adaptive-background.svg").getroot()
    rectangles = root.findall(f"{{{SVG}}}rect")
    if (root.attrib.get("viewBox") != "0 0 1024 1024" or len(rectangles) != 1 or
            any(child.tag not in (f"{{{SVG}}}title", f"{{{SVG}}}rect") for child in root)):
        raise ValueError("Adaptive background requires the approved solid SVG layer")
    rectangle = rectangles[0]
    color = rectangle.attrib.get("fill", "")
    if (rectangle.attrib.get("width") != "1024" or rectangle.attrib.get("height") != "1024" or
            not re.fullmatch(r"#[0-9A-Fa-f]{6}", color)):
        raise ValueError("Unsupported adaptive background rectangle")
    convert, identify = image_tools()
    if run(identify + ["-format", "%w %h %[opaque]", BACKGROUND]).lower() != "432 432 true":
        raise ValueError("Expected opaque approved 432x432 background PNG")
    pixels = subprocess.check_output(convert + [str(BACKGROUND), "-depth", "8", "rgb:-"])
    expected = bytes.fromhex(color[1:])
    if pixels != expected * (432 * 432):
        raise ValueError("Adaptive background SVG and supplied PNG colors differ")
    return color


def android():
    res = ROOT / "android/app/src/main/res"
    if not res.is_dir():
        raise ValueError(f"Android resource directory missing: {res}")
    # Refuse qualifiers that could override the v26 resources below. No
    # monochrome design has been approved, so do not add or overwrite one.
    for path in res.glob("*/ic_launcher*.xml"):
        if path.parent.name.startswith("mipmap-anydpi") and path.parent.name != "mipmap-anydpi-v26":
            raise ValueError(f"Review overriding launcher resource first: {path}")
        if path.parent.name == "mipmap-anydpi-v26" and any(
            element.tag.rsplit("}", 1)[-1] == "monochrome"
            for element in ET.parse(path).iter()
        ):
            raise ValueError(f"Existing monochrome icon requires approved artwork review: {path}")
    color = background_color()
    densities = [("mdpi", 48, 108), ("hdpi", 72, 162),
                 ("xhdpi", 96, 216), ("xxhdpi", 144, 324),
                 ("xxxhdpi", 192, 432)]
    for density, legacy, layer in densities:
        folder = res / f"mipmap-{density}"
        render(MASTER, folder / "ic_launcher.png", legacy)
        render(MASTER, folder / "ic_launcher_round.png", legacy)
        render(FOREGROUND, folder / "ic_launcher_foreground.png", layer,
               transparent=True, adaptive=True)
    background = res / "drawable/seago_launcher_background.xml"
    background.parent.mkdir(parents=True, exist_ok=True)
    background.write_text('<?xml version="1.0" encoding="utf-8"?>\n'
                          '<shape xmlns:android="http://schemas.android.com/apk/res/android" '
                          'android:shape="rectangle">\n'
                          f'    <solid android:color="{color}" />\n</shape>\n')
    adaptive = ('<?xml version="1.0" encoding="utf-8"?>\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@drawable/seago_launcher_background" />\n'
                '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
                '</adaptive-icon>\n')
    folder = res / "mipmap-anydpi-v26"
    folder.mkdir(parents=True, exist_ok=True)
    for name in ["ic_launcher.xml", "ic_launcher_round.xml"]:
        (folder / name).write_text(adaptive)


def ios():
    view_box = ET.parse(SOURCE).getroot().attrib.get("viewBox", "").split()
    if len(view_box) != 4:
        raise ValueError("iOS icon master requires a square SVG viewBox")
    bounds = [Decimal(value) for value in view_box]
    if not all(value.is_finite() for value in bounds) or not bounds[2] == bounds[3] > 0:
        raise ValueError("iOS icon master requires a square SVG viewBox")
    icons = ROOT / "ios/App/App/Assets.xcassets/AppIcon.appiconset"
    catalog = json.loads((icons / "Contents.json").read_text())
    outputs = {}
    for image in catalog["images"]:
        filename = image.get("filename")
        if not filename:
            raise ValueError("AppIcon catalog has an unassigned image; review before generating")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._@-]*\.png", filename):
            raise ValueError(f"Unsafe or unsupported AppIcon filename: {filename}")
        match = re.fullmatch(r"([0-9.]+)x([0-9.]+)", image.get("size", ""))
        scale = re.fullmatch(r"([123])x", image.get("scale", "1x"))
        if not match or not scale:
            raise ValueError(f"Unsupported AppIcon size/scale: {image}")
        width, height = (Decimal(value) for value in match.groups())
        pixels = width * int(scale[1])
        if width != height or pixels != int(pixels) or not 1 <= pixels <= 1024:
            raise ValueError(f"Unsupported AppIcon dimensions: {image}")
        if filename in outputs and outputs[filename] != int(pixels):
            raise ValueError(f"Conflicting AppIcon dimensions for {filename}")
        outputs[filename] = int(pixels)
    if 1024 not in outputs.values():
        raise ValueError("AppIcon catalog must declare an opaque 1024x1024 icon")
    for filename, size in outputs.items():
        render(MASTER, icons / filename, size)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in ("android", "ios"):
            raise ValueError("Usage: generate-native-icons.py [android|ios]")
        {"android": android, "ios": ios}[sys.argv[1]]()
    except (ValueError, InvalidOperation, OSError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
