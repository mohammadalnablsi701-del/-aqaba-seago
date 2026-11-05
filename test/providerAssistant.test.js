import test from "node:test";
import assert from "node:assert/strict";
import {safeAssistantDate,safeTripDraft} from "../src/routes/providerAssistant.js";
import {createApp} from "../src/app.js";

test("assistant accepts valid Aqaba dates and rejects impossible dates",()=>{
  assert.equal(safeAssistantDate("2026-11-05"),"2026-11-05");
  assert.notEqual(safeAssistantDate("2026-02-30"),"2026-02-30");
  assert.match(safeAssistantDate("../admin"),/^\d{4}-\d{2}-\d{2}$/);
});

test("assistant only returns allowed trip draft fields and safe numbers",()=>{
  const result=safeTripDraft({titleAr:"  رحلة غروب  ",category:"__proto__",durationMinutes:-10,adultPrice:-25,childPrice:12,vesselName:"Blue Boat",providerId:"malicious",active:true,pricing:{commissionValue:0}});
  assert.equal(result.titleAr,"رحلة غروب");
  assert.equal(result.category,"group_boat");
  assert.equal(result.durationMinutes,undefined);
  assert.equal(result.adultPrice,undefined);
  assert.equal(result.childPrice,12);
  assert.equal(result.vesselName,"Blue Boat");
  assert.equal("providerId" in result,false);
  assert.equal("active" in result,false);
  assert.equal("pricing" in result,false);
});

test("assistant is inaccessible without provider authentication",async()=>{
  const server=createApp().listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  try{
    const port=server.address().port;
    const response=await fetch("http://127.0.0.1:"+port+"/api/providers/me/assistant",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:"كم مقعد محجوز؟"})});
    assert.equal(response.status,401);
    assert.match((await response.json()).error,/Authentication/i);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
