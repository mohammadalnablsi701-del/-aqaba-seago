import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const navy = "#071F33";

// Embed the approved SVG bytes intact. Native PNGs are compositions of this
// source, never a second drawing of the helm or wave.
export function splashSvg(width, height, logoFraction = 0.27) {
  if (![width, height].every(value => Number.isInteger(value) && value > 0)) {
    throw new Error("Splash dimensions must be positive integers");
  }
  const logo = readFileSync(path.join(root, "public/app-customer.svg")).toString("base64");
  const size = Math.round(Math.min(width, height) * logoFraction);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${navy}"/><image x="${(width - size) / 2}" y="${(height - size) / 2}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/svg+xml;base64,${logo}"/></svg>`;
}

export function configureAndroidLaunch(androidRoot) {
  const styles = path.join(androidRoot, "app/src/main/res/values/styles.xml");
  let xml = readFileSync(styles, "utf8");
  const launch = /(<style name="AppTheme\.NoActionBarLaunch"[^>]*>)([\s\S]*?)(<\/style>)/;
  if (!launch.test(xml)) throw new Error("Android launch theme not found");
  xml = xml.replace(launch, (_, open, body, close) => {
    const items = {
      windowSplashScreenBackground: navy,
      windowSplashScreenAnimatedIcon: "@drawable/seago_launch_icon",
      windowSplashScreenAnimationDuration: "0",
      postSplashScreenTheme: "@style/AppTheme.NoActionBar",
      "android:statusBarColor": navy,
      "android:navigationBarColor": navy,
      "android:windowLightStatusBar": "false",
      "android:windowLightNavigationBar": "false"
    };
    for (const name of Object.keys(items)) {
      const previous = new RegExp(`\\s*<item name="${name}">[^<]*<\\/item>`, "g");
      body = body.replace(previous, "");
    }
    const launchItems = Object.entries(items).map(([name, value]) => `        <item name="${name}">${value}</item>`).join("\n");
    return `${open}${body.trimEnd()}\n${launchItems}\n    ${close}`;
  });
  writeFileSync(styles, xml);
}

export function configureIosLaunch(iosRoot) {
  const storyboard = path.join(iosRoot, "App/App/Base.lproj/LaunchScreen.storyboard");
  let xml = readFileSync(storyboard, "utf8");
  if (!/<imageView[^>]*image="Splash"/.test(xml)) throw new Error("iOS launch image not found");
  xml = xml.replace(/(<imageView\b[^>]*\bcontentMode=")[^"]*("[^>]*image="Splash")/, "$1scaleAspectFit$2");
  xml = xml.replace(/<color key="backgroundColor"[^>]*\/>/, '<color key="backgroundColor" red="0.02745098039" green="0.1215686275" blue="0.2" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>');
  writeFileSync(storyboard, xml);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "render") {
    process.stdout.write(splashSvg(Number(args[0]), Number(args[1]), args[2] ? Number(args[2]) : undefined));
  } else if (command === "android") {
    configureAndroidLaunch(path.join(root, "android"));
  } else if (command === "ios") {
    configureIosLaunch(path.join(root, "ios"));
  } else {
    throw new Error("Usage: native-launch-assets.mjs render <width> <height> [logoFraction] | android | ios");
  }
}
