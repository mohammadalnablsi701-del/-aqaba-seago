import test from "node:test";
import assert from "node:assert/strict";
import { heroAssetUrl, shouldPlayHeroVideo } from "../src/heroVideoPolicy.js";

test("hero URLs work on Pages and root-hosted staging, without remote video dependency", () => {
  assert.equal(heroAssetUrl("/-aqaba-seago/", "hero-seago.mp4"), "/-aqaba-seago/hero-seago.mp4");
  assert.equal(heroAssetUrl("/", "hero-seago.mp4"), "/hero-seago.mp4");
  assert.equal(heroAssetUrl("/-aqaba-seago", "aqaba-hero.jpg"), "/-aqaba-seago/aqaba-hero.jpg");
  assert.equal(heroAssetUrl("https://untrusted.example/path", "hero-seago.mp4"), "/hero-seago.mp4");
  assert.equal(heroAssetUrl("/", "../something.mp4"), "");
});

test("reduce motion, save-data, hidden tab and 2G never autoplay", () => {
  for (const constraints of [
    { reducedMotion: true }, { saveData: true }, { isHidden: true },
    { effectiveType: "2g" }, { effectiveType: "slow-2g" }
  ]) assert.equal(shouldPlayHeroVideo(constraints), false);
});

test("normal mobile connections can autoplay a muted inline clip", () => {
  assert.equal(shouldPlayHeroVideo({ effectiveType: "4g" }), true);
  assert.equal(shouldPlayHeroVideo({ effectiveType: "3g" }), true);
  assert.equal(shouldPlayHeroVideo({}), true);
});
