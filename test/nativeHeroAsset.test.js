import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { customerHeroAssetUrl } from "../customer-app/src/homeParity.js";

const main=fs.readFileSync(new URL("../customer-app/src/main.jsx",import.meta.url),"utf8");
const sharedCss=fs.readFileSync(new URL("../customer-app/src/customer-parity.css",import.meta.url),"utf8");
const nativeCss=fs.readFileSync(new URL("../customer-app/src/native-parity.css",import.meta.url),"utf8");
const heroUrl=new URL("../customer-app/public/aqaba-hero.jpg",import.meta.url);

test("shared hero resolves through the active Vite BASE_URL and current document",()=>{
  assert.equal(customerHeroAssetUrl("/-aqaba-seago/","https://example.test/-aqaba-seago/"),"https://example.test/-aqaba-seago/aqaba-hero.jpg");
  assert.equal(customerHeroAssetUrl("./","https://localhost/"),"https://localhost/aqaba-hero.jpg");
  assert.equal(customerHeroAssetUrl("./","capacitor://localhost/"),"capacitor://localhost/aqaba-hero.jpg");
  assert.match(main,/--seago-hero-image/);
  assert.match(main,/customerHeroAssetUrl\(import\.meta\.env\.BASE_URL,window\.location\.href\)/);
});

test("one authoritative local hero rule is shared by Web and Android",()=>{
  assert.match(sharedCss,/background-image:var\(--seago-hero-image\)!important/);
  assert.ok(main.indexOf('".\/styles.css"') < main.indexOf('".\/customer-parity.css"'),"shared parity CSS must load after legacy styles");
  assert.doesNotMatch(main,/--seago-native-hero-image/);
  assert.doesNotMatch(nativeCss,/\.hero-scene/);
  assert.doesNotMatch(sharedCss,/commons\.wikimedia\.org/);
  assert.ok(fs.statSync(heroUrl).size>0,"local aqaba-hero.jpg must exist");
});
