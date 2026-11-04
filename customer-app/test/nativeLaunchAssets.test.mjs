import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { splashSvg, configureAndroidLaunch, configureIosLaunch } from "../scripts/native-launch-assets.mjs";

test("native splash embeds exact approved artwork and keeps it square in portrait/landscape", () => {
  const approved = readFileSync(new URL("../public/app-customer.svg", import.meta.url));
  for (const [width, height] of [[480, 320], [320, 480], [2732, 2732]]) {
    const svg = splashSvg(width, height);
    const source = svg.match(/base64,([^"]+)/)[1];
    assert.deepEqual(Buffer.from(source, "base64"), approved);
    const size = Math.round(Math.min(width, height) * 0.27);
    assert.ok(svg.includes(`<image x="${(width - size) / 2}" y="${(height - size) / 2}" width="${size}" height="${size}"`));
    assert.ok(svg.includes('fill="#071F33"'));
  }
  assert.throws(() => splashSvg(0, 320));
});

test("Android launch tile fits entirely inside the OS circular safe region", () => {
  const generator = readFileSync(new URL("../scripts/generate-native-assets.sh", import.meta.url), "utf8");
  const fraction = Number(generator.match(/render 1152 1152 ([0-9.]+)/)[1]);
  // Android's 288dp icon drawable has a 192dp safe circle. A square tile
  // must fit by its diagonal, retaining the approved ivory corners as well.
  assert.ok(fraction > 0);
  assert.ok(fraction * Math.SQRT2 < 192 / 288);
  const svg = splashSvg(1152, 1152, fraction);
  const size = Number(svg.match(/<image[^>]*width="([0-9]+)"/)[1]);
  assert.ok(size * Math.SQRT2 < 1152 * (192 / 288));
});

test("Android launch uses its own approved drawable, preserving launcher configuration", () => {
  const root = mkdtempSync(path.join(tmpdir(), "seago-android-launch-"));
  try {
    const values = path.join(root, "app/src/main/res/values");
    mkdirSync(values, { recursive: true });
    const styles = path.join(values, "styles.xml");
    writeFileSync(styles, '<resources><style name="AppTheme"><item name="colorPrimary">#123456</item></style><style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen"><item name="android:background">@drawable/splash</item></style></resources>');
    configureAndroidLaunch(root);
    const first = readFileSync(styles, "utf8");
    assert.ok(first.includes('<item name="windowSplashScreenAnimatedIcon">@drawable/seago_launch_icon</item>'));
    assert.ok(first.includes('<item name="windowSplashScreenBackground">#071F33</item>'));
    assert.ok(first.includes('<style name="AppTheme"><item name="colorPrimary">#123456</item></style>'));
    assert.doesNotMatch(first, /ic_launcher/);
    configureAndroidLaunch(root);
    assert.equal(readFileSync(styles, "utf8"), first);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("iOS launch remains a static, aspect-correct storyboard on navy", () => {
  const root = mkdtempSync(path.join(tmpdir(), "seago-ios-launch-"));
  try {
    const base = path.join(root, "App/App/Base.lproj");
    mkdirSync(base, { recursive: true });
    const storyboard = path.join(base, "LaunchScreen.storyboard");
    writeFileSync(storyboard, '<document launchScreen="YES"><imageView contentMode="scaleAspectFill" image="Splash"><color key="backgroundColor" systemColor="systemBackgroundColor"/></imageView></document>');
    configureIosLaunch(root);
    const first = readFileSync(storyboard, "utf8");
    assert.ok(first.includes('contentMode="scaleAspectFit"'));
    assert.ok(first.includes('red="0.02745098039" green="0.1215686275" blue="0.2"'));
    assert.doesNotMatch(first, /animation/);
    configureIosLaunch(root);
    assert.equal(readFileSync(storyboard, "utf8"), first);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("launcher icon updates and animated native splash remain independent", () => {
  const script = readFileSync(new URL("../scripts/generate-native-assets.sh", import.meta.url), "utf8");
  assert.match(script, /--icons-only/);
  assert.match(script, /--splash-only/);
  assert.match(script, /generate-native-icons\.py.*android/);
  assert.match(script, /generate-native-icons\.py.*ios/);
  assert.match(script, /native-launch-assets\.mjs.*render/);
  const launcher = readFileSync(new URL("../assets/logo.svg", import.meta.url));
  const approved = readFileSync(new URL("../public/app-customer.svg", import.meta.url));
  assert.deepEqual(launcher, approved, "Native launcher source must match approved web logo");
});
