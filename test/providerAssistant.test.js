import test from "node:test";
import assert from "node:assert/strict";
import {safeAssistantDate,safeTripDraft,understandAssistant} from "../src/routes/providerAssistant.js";
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


test("assistant rejects recordings above the 1.6M base64 limit without contacting Google",async()=>{
  await assert.rejects(
    understandAssistant({audioBase64:"A".repeat(1600004),audioMimeType:"audio/mp4"},{GEMINI_API_KEY:"test-key"}),
    /صيغة أو حجم التسجيل غير مدعوم/
  );
});

test("assistant classifies general trip facts without exposing typed phone or email to Gemini",async()=>{
  const original=globalThis.fetch;
  let request;
  globalThis.fetch=async(_url,options)=>{
    request=JSON.parse(options.body);
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({
      intent:"trip_info",tripName:"Sunset Cruise",date:"",topic:"",transcript:"",draft:{},reply:""
    })}]}}]})};
  };
  try{
    const result=await understandAssistant({
      text:"What's the price of Sunset Cruise? 0791234567 foo@example.com",
      context:{lang:"en",mode:"",focus:{intent:"trip_info",tripName:"Sunset Cruise",date:"2026-11-06"}}
    },{GEMINI_API_KEY:"test-key"});
    assert.equal(result.intent,"trip_info");
    assert.equal(result.tripName,"Sunset Cruise");
    assert.equal(result.date,"2026-11-06");
    const payload=JSON.stringify(request);
    assert.doesNotMatch(payload,/0791234567|foo@example.com/);
    assert.match(payload,/\[phone\]/);
    assert.match(payload,/\[email\]/);
    assert.equal(result.context.lang,"en");
  }finally{globalThis.fetch=original;}
});
