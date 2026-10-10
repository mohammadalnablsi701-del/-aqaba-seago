import test from "node:test";
import assert from "node:assert/strict";
import{readFile}from"node:fs/promises";

const panel=await readFile(new URL("../admin-app/src/AdminActivityPanel.jsx",import.meta.url),"utf8");
const api=await readFile(new URL("../admin-app/src/adminAuditApi.js",import.meta.url),"utf8");

test("Admin Activity renders audit text safely with human-readable labels",()=>{
  assert.match(panel,/Admin Activity/);
  assert.match(panel,/Suspended provider/);
  assert.match(panel,/Paused trip on platform/);
  assert.match(panel,/Updated commission/);
  assert.match(panel,/item\.reason/);
  assert.doesNotMatch(panel,/dangerouslySetInnerHTML/);
  assert.doesNotMatch(panel,/innerHTML\s*=/);
});

test("Admin Activity reads only the admin audit endpoint",()=>{
  assert.match(api,/\/api\/admin\/audit/);
  assert.match(api,/Bearer/);
  assert.doesNotMatch(api,/PATCH|DELETE|PUT/);
});
