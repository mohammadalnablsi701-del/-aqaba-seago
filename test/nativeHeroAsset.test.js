import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main=fs.readFileSync(new URL("../customer-app/src/main.jsx",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../customer-app/src/native-parity.css",import.meta.url),"utf8");

test("native hero resolves through Vite BASE_URL",()=>{
  assert.match(main,/import\.meta\.env\.BASE_URL\}aqaba-hero\.jpg/);
  assert.match(main,/--seago-native-hero-image/);
  assert.match(css,/background-image:var\(--seago-native-hero-image\)!important/);
});

test("native hero override is scoped to native app",()=>{
  assert.match(css,/html\[data-seago-native="1"\] \.hero-scene/);
});
