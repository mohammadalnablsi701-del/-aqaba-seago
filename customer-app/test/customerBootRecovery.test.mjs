import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");

test("Customer shows a branded static recovery instead of blank while JavaScript is unavailable",()=>{
  assert.match(html,/<div id="root"><\/div>/);
  assert.match(html,/<div id="seago-boot-recovery" role="status"/);
  assert.match(html,/#root:not\(:empty\)\+#seago-boot-recovery\{display:none\}/);
  assert.match(html,/src="\.\/app-customer\.svg"/);
  assert.match(html,/>Reload App<\/a>/);
  assert.match(html,/prefers-reduced-motion:reduce/);
});
