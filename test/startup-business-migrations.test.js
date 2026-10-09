import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyCommission20Migration } from "../src/services/commission20Migration.js";

test("legacy 20 percent commission migration is permanently fail-closed",async()=>{
  assert.deepEqual(await applyCommission20Migration(),{
    skipped:true,
    reason:"retired"
  });
});

test("normal server startup does not invoke business-data pilot migrations",async()=>{
  const serverSource=await readFile(new URL("../src/server.js",import.meta.url),"utf8");
  for(const forbidden of [
    "applyRealPilotData",
    "applyCommission20Migration",
    "applySeaBreezeCorrection"
  ]){
    assert.equal(serverSource.includes(forbidden),false,`${forbidden} must not run from normal startup`);
  }
});
