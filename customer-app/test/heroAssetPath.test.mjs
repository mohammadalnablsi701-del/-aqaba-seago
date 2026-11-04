import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,statSync} from "node:fs";

test("hero photo uses Vite base-aware public path in both Render and GitHub Pages",()=>{
  const css=readFileSync(new URL("../src/styles.css",import.meta.url),"utf8");
  assert.ok(css.includes('background-image:url("/aqaba-hero.jpg")'));
  assert.ok(!css.includes('url("/-aqaba-seago/aqaba-hero.jpg")'));
  assert.ok(!css.includes('commons.wikimedia.org/wiki/Special:Redirect/file'));
  assert.ok(statSync(new URL("../public/aqaba-hero.jpg",import.meta.url)).size>10000);
});
