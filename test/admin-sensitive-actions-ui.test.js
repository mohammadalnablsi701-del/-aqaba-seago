import test from"node:test";
import assert from"node:assert/strict";
import fs from"node:fs";
import{validateSensitiveReason,runLockedSensitiveAction}from"../admin-app/src/sensitiveActionDialog.js";

const apiSource=fs.readFileSync(new URL("../admin-app/src/api.js",import.meta.url),"utf8");
const dialogSource=fs.readFileSync(new URL("../admin-app/src/sensitiveActionDialog.js",import.meta.url),"utf8");
const accessSource=fs.readFileSync(new URL("../admin-app/src/ProviderAccessManager.jsx",import.meta.url),"utf8");

test("A: suspend uses an explicit high-risk confirmation with a required reason",()=>{
  assert.match(apiSource,/suspended:\{title:"Suspend provider"/);
  assert.match(apiSource,/reason:true,impact:"This will stop new sales for this provider and release open checkout holds/);
  assert.match(apiSource,/runSensitiveAction\(/);
});

test("C: whitespace-only sensitive reasons are rejected",()=>{
  const result=validateSensitiveReason("   ",{required:true});
  assert.equal(result.ok,false);assert.match(result.error,/at least 4 characters/);
});

test("D: action lock collapses rapid duplicate submits to one execution",async()=>{
  let calls=0;let release;
  const gate=new Promise(resolve=>{release=resolve});
  const factory=async()=>{calls++;await gate;return"ok"};
  const first=runLockedSensitiveAction("same-action",factory);
  const second=runLockedSensitiveAction("same-action",factory);
  assert.strictEqual(second,first);assert.equal(calls,0);
  await Promise.resolve();assert.equal(calls,1);
  release();assert.equal(await first,"ok");assert.equal(await second,"ok");assert.equal(calls,1);
});

test("E: failed modal execution remains in the dialog error path instead of optimistic success",()=>{
  assert.match(dialogSource,/try\{const result=await execute\(checked\.value\);cleanup\(\);resolve\(result\)\}catch\(err\)\{locked=false/);
  assert.match(dialogSource,/showError\(err\?\.message\|\|"Action failed\. Nothing was changed\."\)/);
});

test("I: commission confirmation shows old/new and future-only snapshot wording",()=>{
  assert.match(apiSource,/title:"Change trip commission"/);
  assert.match(apiSource,/\{label:"Old",value:/);assert.match(apiSource,/\{label:"New",value:/);
  assert.match(apiSource,/This affects future bookings only\. Existing booking pricing snapshots will not change\./);
});

test("J: Manage Access has a lifecycle-neutral credential reset confirmation",()=>{
  assert.match(accessSource,/SensitiveActionModal/);
  assert.match(accessSource,/invalidate existing provider sessions\. The provider lifecycle status will not change\./);
  assert.match(accessSource,/reasonRequired/);
});

test("L: admin-entered text is rendered through textContent, never innerHTML",()=>{
  assert.doesNotMatch(dialogSource,/innerHTML/);
  assert.match(dialogSource,/textContent/);
  const payload='<img src=x onerror="alert(1)">';
  const checked=validateSensitiveReason(payload,{required:true});assert.equal(checked.ok,true);assert.equal(checked.value,payload);
});
