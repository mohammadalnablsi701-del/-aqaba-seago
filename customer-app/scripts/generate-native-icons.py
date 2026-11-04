#!/usr/bin/env python3
"""Render the existing Customer SVG into generated Capacitor launcher resources.

The adaptive foreground extraction intentionally accepts only the current master
structure. A replacement design needs its own reviewed foreground/background
exports; it must not silently inherit this wheel-specific safe-zone transform.
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
NAVY = "#071F33"
SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)


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
    with tempfile.TemporaryDirectory(prefix="seago-icon-") as directory:
        raster = Path(directory) / "render.png"
        output = Path(directory) / "output.png"
        run(["rsvg-convert", "-w", size, "-h", size, source, "-o", raster])
        if transparent:
            run(convert + [raster, "-strip", f"PNG32:{output}"])
        else:
            if run(identify + ["-format", "%[opaque]", raster]).lower() != "true":
                raise ValueError(f"Source artwork must be opaque; refusing to flatten: {source}")
            run(convert + [raster, "-alpha", "off", "-strip", f"PNG24:{output}"])
        actual = run(identify + ["-format", "%w %h %[opaque]", output]).split()
        if actual[:2] != [str(size), str(size)]:
            raise ValueError(f"Wrong dimensions for {target}: {actual}")
        if not transparent and actual[2].lower() != "true":
            raise ValueError(f"Opaque icon required: {target}")
        if adaptive:
            # Check actual alpha pixels, including antialiasing, rather than
            # assuming future artwork still fits the current wheel's bounds.
            rgba = subprocess.check_output(convert + [str(output), "-depth", "8", "rgba:-"])
            visible = [index // 4 for index in range(3, len(rgba), 4) if rgba[index]]
            if not visible:
                raise ValueError(f"Adaptive foreground is empty: {target}")
            limit = 30 * size / 108 + 1  # one raster pixel for antialiasing
            if any(((pixel % size + 0.5 - size / 2) ** 2 +
                    (pixel // size + 0.5 - size / 2) ** 2) > limit ** 2
                   for pixel in visible):
                raise ValueError(f"Adaptive foreground exceeds the 30dp safe radius: {target}")
        shutil.copyfile(output, target)
    print(f"Branded {target.relative_to(ROOT)} ({size}x{size})")


def adaptive_source(directory):
    tree = ET.parse(SOURCE)
    root = tree.getroot()
    if root.attrib.get("viewBox") != "0 0 1024 1024":
        raise ValueError("Adaptive icon requires reviewed 1024-square SVG artwork")
    rectangles = root.findall(f"{{{SVG}}}rect")
    if len(rectangles) != 1 or rectangles[0].attrib != {
        "width": "1024", "height": "1024", "fill": NAVY
    }:
        raise ValueError("Adaptive master needs a reviewed separate background")
    root.remove(rectangles[0])
    groups = root.findall(f"{{{SVG}}}g")
    # This approved wheel has a 353.6-unit outer radius. At 0.8 scale it
    # occupies <=30dp radius on the 108dp layer (inside Android's 33dp zone).
    if len(groups) != 1 or groups[0].attrib.get("transform") != (
        "translate(512 512) scale(3.4) translate(-128 -128)"
    ):
        raise ValueError("Replacement artwork needs a reviewed adaptive safe zone")
    content = list(root)
    for child in content:
        root.remove(child)
    wrapper = ET.SubElement(root, f"{{{SVG}}}g", {
        "transform": "translate(512 512) scale(0.8) translate(-512 -512)"
    })
    wrapper.extend(content)
    path = directory / "foreground.svg"
    tree.write(path, encoding="utf-8", xml_declaration=True)
    return path


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
    with tempfile.TemporaryDirectory(prefix="seago-adaptive-") as directory:
        foreground = adaptive_source(Path(directory))
        densities = [("mdpi", 48, 108), ("hdpi", 72, 162),
                     ("xhdpi", 96, 216), ("xxhdpi", 144, 324),
                     ("xxxhdpi", 192, 432)]
        for density, legacy, layer in densities:
            folder = res / f"mipmap-{density}"
            render(SOURCE, folder / "ic_launcher.png", legacy)
            render(SOURCE, folder / "ic_launcher_round.png", legacy)
            render(foreground, folder / "ic_launcher_foreground.png", layer,
                   transparent=True, adaptive=True)
    background = res / "drawable/seago_launcher_background.xml"
    background.parent.mkdir(parents=True, exist_ok=True)
    background.write_text('<?xml version="1.0" encoding="utf-8"?>\n'
                          '<shape xmlns:android="http://schemas.android.com/apk/res/android" '
                          'android:shape="rectangle">\n'
                          f'    <solid android:color="{NAVY}" />\n</shape>\n')
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
        render(SOURCE, icons / filename, size)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in ("android", "ios"):
            raise ValueError("Usage: generate-native-icons.py [android|ios]")
        {"android": android, "ios": ios}[sys.argv[1]]()
    except (ValueError, InvalidOperation, OSError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
