import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");

test("Customer keeps a branded static recovery with a retry link when JavaScript is unavailable",()=>{
  assert.match(html,/<div id="root" inert aria-hidden="true"><\/div>/);
  assert.match(html,/<div id="seago-boot-recovery" role="status"/);
  assert.match(html,/src="%BASE_URL%app-customer\.svg"/);
  assert.match(html,/>Reload App<\/a>/);
  assert.match(html,/href="" aria-label="Reload Aqaba SeaGo if loading is taking too long"/);
  assert.match(html,/prefers-reduced-motion:reduce/);
  assert.match(html,/#seago-boot-recovery\[hidden\]\{display:none\}/);
  assert.doesNotMatch(html,/#root:not\(:empty\)/,"Partial React output is not proof that initialization succeeded");
  assert.match(html,/Still opening SeaGo/);
});
