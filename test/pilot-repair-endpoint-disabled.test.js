import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

test("pilot repair endpoint is fail-closed unless explicitly enabled",async()=>{
  const previous=process.env.PILOT_REPAIR_STAGE2A_ENABLED;
  delete process.env.PILOT_REPAIR_STAGE2A_ENABLED;
  const app=createApp();
  const server=app.listen(0);
  try{
    await new Promise(resolve=>server.once("listening",resolve));
    const address=server.address();
    const response=await fetch(`http://127.0.0.1:${address.port}/internal/pilot-repair-stage2a`,{method:"POST",headers:{"content-type":"application/json"},body:'{"mode":"preview"}'});
    assert.equal(response.status,404);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    if(previous===undefined)delete process.env.PILOT_REPAIR_STAGE2A_ENABLED;else process.env.PILOT_REPAIR_STAGE2A_ENABLED=previous;
  }
});
