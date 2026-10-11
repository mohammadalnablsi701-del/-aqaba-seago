import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("settlement admin UI uses the Sensitive Action contract without client-authoritative financial fields",()=>{
  const api=fs.readFileSync(new URL("../admin-app/src/api.js",import.meta.url),"utf8");
  const app=fs.readFileSync(new URL("../admin-app/src/App.jsx",import.meta.url),"utf8");
  const history=fs.readFileSync(new URL("../admin-app/src/SettlementHistoryRow.jsx",import.meta.url),"utf8");
  assert.match(api,/title:"Mark settlement paid"/);
  assert.match(api,/This action records that the provider has actually been paid\./);
  assert.match(api,/reasonRequired:true/);
  assert.match(api,/Payment reason/);
  assert.match(api,/Current status/);
  assert.match(api,/New status/);
  assert.match(api,/JSON\.stringify\(\{providerId,from,to,reason\}\)/);
  assert.doesNotMatch(api,/JSON\.stringify\(\{providerId,from,to,reason,amount/);
  assert.doesNotMatch(app,/window\.confirm\(`Mark /);
  assert.match(app,/row\.payableNow/);
  assert.match(app,/Re-payment flow required/);
  assert.match(history,/effectiveAmountPaid/);
  assert.match(history,/Reverse payment record/);
  assert.match(history,/Original payment record preserved; correction is append-only\./);
  assert.doesNotMatch(history,/dangerouslySetInnerHTML/);
});
