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

test("spoken language command and list-all trip intent override previous focus",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{
    text:JSON.stringify({intent:"trip_info",date:"",tripName:"",listAllTrips:true,replyLanguage:"en",transcript:"Show all my trips in English",draft:{}})
  }]}}]})});
  try{
    const result=await understandAssistant({
      audioBase64:"A".repeat(400),audioMimeType:"audio/mp4",
      context:{lang:"ar",focus:{intent:"trip_info",tripName:"Old Trip",date:"2026-11-06"}}
    },{GEMINI_API_KEY:"test-key"});
    assert.equal(result.intent,"trip_info");
    assert.equal(result.context.lang,"en");
    assert.equal(result.tripName,"");
    assert.equal(result.transcript,"Show all my trips in English");
  }finally{globalThis.fetch=original;}
});

test("V2 model fixtures: Arabic/English intent and operational topic contract",async()=>{
  const original=globalThis.fetch;
  let reply={};
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),request:JSON.parse(options.body)});
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(reply)}]}}]})};
  };
  try{
    const cases=[
      {utterance:"ليش رحلتي مش ظاهرة؟",intent:"trip_visibility",name:"رحلة الغروب"},
      {utterance:"What's the buffet price?",intent:"trip_info",name:"Sunset Cruise"},
      {utterance:"كم مقعد متاح بكرا؟",intent:"seats",name:""},
      {utterance:"QR scanner ما عم يشتغل",intent:"troubleshoot",topic:"qr_checkin",name:""},
      {utterance:"بدي ألغي مسودة الرحلة",intent:"cancel",name:""},
      {utterance:"شو خطوات حفظ الرحلة؟",intent:"help",name:""}
    ];
    for(const c of cases){
      reply={intent:c.intent,tripName:c.name,topic:c.topic||"general",transcript:"",draft:{},date:""};
      const result=await understandAssistant({text:c.utterance,context:{lang:"ar"}},{GEMINI_API_KEY:"fake-test-key"});
      assert.equal(result.intent,c.intent,c.utterance);
      assert.equal(result.tripName,c.name,c.utterance);
      assert.equal(result.topic,c.topic||"general",c.utterance);
    }
    assert.equal(calls.length,cases.length);
    assert.ok(calls.every(x=>x.url.startsWith("https://generativelanguage.googleapis.com/")));
  }finally{globalThis.fetch=original;}
});

test("V2 unclear audio, invalid dates, malformed JSON and null model outputs fail closed",async()=>{
  const original=globalThis.fetch;
  let body="null";
  globalThis.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:body}]}}]})});
  try{
    await assert.rejects(understandAssistant({text:"hello"},{GEMINI_API_KEY:"fake"}),e=>e.status===422);
    body="not-json";
    await assert.rejects(understandAssistant({text:"hello"},{GEMINI_API_KEY:"fake"}),e=>e.status===422);
    body=JSON.stringify({intent:"seats",date:"2026-02-30",transcript:"",draft:{}});
    await assert.rejects(understandAssistant({text:"How many seats?"},{GEMINI_API_KEY:"fake"}),e=>e.status===422);
    body=JSON.stringify({intent:"create_trip",date:"",transcript:"",draft:{titleAr:"Misheard"}});
    await assert.rejects(understandAssistant({
      audioBase64:"A".repeat(400),audioMimeType:"audio/mp4"
    },{GEMINI_API_KEY:"fake"}),e=>e.status===422);
  }finally{globalThis.fetch=original;}
});

test("V2 follow-up dates are reused only for seats questions within seat context",async()=>{
  const original=globalThis.fetch;
  let intent="seats";
  globalThis.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{
    text:JSON.stringify({intent,date:"",tripName:"",topic:"general",draft:{},transcript:""})
  }]}}]})});
  try{
    const context={lang:"en",focus:{intent:"seats",date:"2027-05-11",tripName:"Sunset Cruise"}};
    const seats=await understandAssistant({text:"What about that trip?",context},{GEMINI_API_KEY:"fake"});
    assert.equal(seats.date,"2027-05-11");
    assert.equal(seats.tripName,"Sunset Cruise");
    intent="trip_info";
    const trip=await understandAssistant({text:"Tell me about prices",context},{GEMINI_API_KEY:"fake"});
    assert.equal(trip.date,safeAssistantDate(null));
    assert.equal(trip.tripName,"Sunset Cruise");
    intent="help";
    const help=await understandAssistant({text:"How to reset the app?",context},{GEMINI_API_KEY:"fake"});
    assert.equal(help.tripName,"");
  }finally{globalThis.fetch=original;}
});
