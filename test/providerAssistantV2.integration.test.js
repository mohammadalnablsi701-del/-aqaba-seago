import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import {createApp} from "../src/app.js";
import User from "../src/models/User.js";
import Provider from "../src/models/Provider.js";
import ProviderMember from "../src/models/ProviderMember.js";
import Trip from "../src/models/Trip.js";
import Departure from "../src/models/Departure.js";
import Booking from "../src/models/Booking.js";

// This acceptance test runs ONLY on the disposable localhost replica set provisioned by CI.
// All Gemini replies/audio transcriptions are fixtures: no provider data or audio reaches Google.
const uri=process.env.SEAGO_TEST_MONGODB_URI;
const secret="seago-assistant-v2-integration-test-secret-32";
const dateJordan=d=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Amman",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
const hold=new Date(Date.now()+300_000);

test("SeaGo Provider Assistant V2: authenticated two-provider HTTP and mocked speech acceptance",{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,"A disposable localhost MongoDB is required");
  const oldEnv=Object.fromEntries(["JWT_SECRET","PROVIDER_AI_ENABLED","GEMINI_API_KEY"].map(k=>[k,process.env[k]]));
  process.env.JWT_SECRET=secret;
  process.env.PROVIDER_AI_ENABLED="true";
  process.env.GEMINI_API_KEY="unit-test-only";
  await mongoose.connect(uri,{dbName:"seago_assistant_v2_"+crypto.randomUUID().replaceAll("-","")});
  const originalFetch=globalThis.fetch;
  const captured=[];
  let responseFixture={intent:"help",reply:"Helpful guidance",draft:{},transcript:""};
  globalThis.fetch=(url,options={})=>{
    if(String(url).startsWith("https://generativelanguage.googleapis.com/")){
      const request=JSON.parse(options.body);
      captured.push(request);
      return Promise.resolve(new Response(JSON.stringify({
        candidates:[{content:{parts:[{text:JSON.stringify(responseFixture)}]}}]
      }),{status:200,headers:{"content-type":"application/json"}}));
    }
    return originalFetch(url,options);
  };
  t.after(async()=>{
    globalThis.fetch=originalFetch;
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    for(const [key,value] of Object.entries(oldEnv)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });

  await Promise.all([User,Provider,ProviderMember,Trip,Departure,Booking].map(m=>m.init()));
  const [ownerA,ownerB,staffA,customer]=await User.create([
    {name:"Operator A",phone:"+962790050101",role:"provider"},
    {name:"Operator B",phone:"+962790050102",role:"provider"},
    {name:"Staff A",phone:"+962790050103",role:"provider"},
    {name:"Customer",phone:"+962790050104",role:"customer"}
  ]);
  const [providerA,providerB]=await Provider.create([
    {ownerUserId:ownerA._id,businessName:"Alpha Tours",status:"approved"},
    {ownerUserId:ownerB._id,businessName:"Bravo Marine",status:"approved"}
  ]);
  await ProviderMember.create({providerId:providerA._id,userId:staffA._id,role:"staff",createdBy:ownerA._id});
  const trip=(providerId,titleAr,titleEn,adultPrice)=>({
    providerId,titleAr,titleEn,category:"sunset",durationMinutes:90,active:true,platformStatus:"allowed",
    pricing:{currency:"JOD",pricePerPerson:adultPrice,adultPrice,childPrice:12,
      buffetEnabled:true,buffetDescription:"Tea and snacks",buffetAdultPrice:adultPrice+5,
      buffetChildPrice:15,commissionType:"percentage",commissionValue:19},
    departureLocation:{name:"Ayla Marina",googleMapsUrl:"https://maps.app.goo.gl/abc"}
  });
  const [east,west,bravo]=await Trip.create([
    trip(providerA._id,"رحلة غروب الشرق","Alpha Sunset East",20),
    trip(providerA._id,"رحلة غروب الغرب","Alpha Sunset West",30),
    trip(providerB._id,"رحلة خاصة برافو","Bravo Secret Cruise",99)
  ]);
  const day=dateJordan(new Date(Date.now()+2*86400000));
  const time=hour=>new Date(day+"T"+hour+":00:00+03:00");
  const [open,closed,cancelled,foreign]=await Departure.create([
    {tripId:east._id,startsAt:time("10"),capacity:10,reservedSeats:3,status:"scheduled"},
    {tripId:east._id,startsAt:time("11"),capacity:10,reservedSeats:2,salesClosed:true,status:"scheduled"},
    {tripId:east._id,startsAt:time("12"),capacity:10,reservedSeats:0,status:"cancelled"},
    {tripId:bravo._id,startsAt:time("13"),capacity:12,reservedSeats:2,status:"scheduled"}
  ]);
  const booking=(providerId,tripId,departureId,seats)=>({
    customerId:customer._id,providerId,tripId,departureId,seats,adults:seats,children:0,
    status:"confirmed",holdExpiresAt:hold,idempotencyKey:crypto.randomUUID()
  });
  await Booking.create([
    booking(providerA._id,east._id,open._id,2),
    booking(providerA._id,east._id,closed._id,1),
    booking(providerB._id,bravo._id,foreign._id,2)
  ]);

  const app=createApp();
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base="http://127.0.0.1:"+server.address().port+"/api/providers/me/assistant";
  const token=u=>jwt.sign({sub:String(u._id)},secret,{expiresIn:"1h"});
  async function ask(user,fixture,body={text:"Test the assistant"},providedToken){
    responseFixture=fixture;
    const response=await originalFetch(base,{
      method:"POST",headers:{"content-type":"application/json",
        ...(providedToken===null?{}:{authorization:"Bearer "+(providedToken||token(user))})},
      body:JSON.stringify(body)
    });
    return {status:response.status,data:await response.json()};
  }
  const context=(lang="en",focus={})=>({lang,focus});

  await t.test("authentication, role and no unauthorized trip creation",async()=>{
    const fixture={intent:"create_trip",draft:{titleAr:"No permission"}};
    assert.equal((await ask(staffA,fixture,{text:"Create a new trip",context:context()})).status,403);
    assert.equal((await ask(customer,fixture,{text:"Create a new trip",context:context()})).status,403);
    assert.equal((await ask(ownerA,fixture,{text:"Create a new trip",context:context()},null)).status,401);
  });

  await t.test("real saved trip price, buffet and departure: strictly company-scoped",async()=>{
    let answer=await ask(ownerA,{intent:"trip_info",tripName:"Alpha Sunset East"},{text:"What does Alpha Sunset East cost?",context:context()});
    assert.equal(answer.status,200);
    assert.match(answer.data.text,/Adult price: 20 JOD/);
    assert.match(answer.data.text,/Tea and snacks/);
    assert.doesNotMatch(JSON.stringify(answer.data),/Bravo Secret|commissionValue|customerPhone|0999/);

    answer=await ask(ownerA,{intent:"trip_info",tripName:"Bravo Secret Cruise"},
      {text:"Show Bravo Secret Cruise",context:context("en",{intent:"trip_info",tripName:"Bravo Secret Cruise"})});
    assert.equal(answer.status,200);
    assert.doesNotMatch(JSON.stringify(answer.data),/99 JOD|Bravo Secret Cruise.*Adult price/);
    answer=await ask(ownerB,{intent:"trip_info",tripName:"Alpha Sunset East"},{text:"Alpha Sunset East",context:context()});
    assert.equal(answer.status,200);
    assert.doesNotMatch(answer.data.text,/20 JOD|Tea and snacks/);
    answer=await ask(staffA,{intent:"trip_info",tripName:"Alpha Sunset East"},{text:"Alpha Sunset East",context:context()});
    assert.equal(answer.status,200,"Staff with booking access may read public trip facts");
  });

  await t.test("daily confirmed vs truly bookable seats excludes closed/cancelled and other provider",async()=>{
    const reply={intent:"seats",tripName:"Alpha Sunset East",date:day,transcript:""};
    const answer=await ask(ownerA,reply,{text:"Available seats on "+day+" for Alpha Sunset East",context:context()});
    assert.equal(answer.status,200);
    assert.equal(answer.data.rows.length,3);
    assert.equal(answer.data.rows.reduce((n,r)=>n+r.confirmedSeats,0),3);
    assert.equal(answer.data.rows.reduce((n,r)=>n+r.availableSeats,0),7);
    assert.equal(answer.data.rows.find(r=>r.status==="cancelled").availableSeats,0);
    assert.equal(answer.data.rows.find(r=>r.startsAt.startsWith(time("11").toISOString().slice(0,13))).availableSeats,0);
    assert.equal(answer.data.source,"provider_data");
    assert.doesNotMatch(JSON.stringify(answer.data),/Bravo Secret|99 JOD/);

    const other=await ask(ownerB,{intent:"seats",tripName:"Bravo Secret Cruise",date:day},
      {text:"Bravo Secret Cruise seats",context:context()});
    assert.equal(other.status,200);
    assert.equal(other.data.rows.length,1);
    assert.equal(other.data.rows[0].confirmedSeats,2);
    assert.equal(other.data.rows[0].availableSeats,10);
    assert.equal((await ask(customer,reply,{text:"seats",context:context()})).status,403);
  });

  await t.test("ambiguous trip name is not silently aggregated",async()=>{
    const answer=await ask(ownerA,{intent:"seats",tripName:"Alpha Sunset",date:day},
      {text:"How many seats for Alpha Sunset?",context:context()});
    assert.equal(answer.status,200);
    assert.equal(answer.data.rows.length,0);
    assert.match(answer.data.text,/Several trips match/);
  });

  await t.test("spoken English/audio routing is mocked, never sent to a real Google endpoint",async()=>{
    const transcript="How many seats for Alpha Sunset East on "+day;
    const answer=await ask(ownerA,{intent:"seats",tripName:"Alpha Sunset East",date:day,
      transcript,replyLanguage:"en"},{
      audioBase64:"A".repeat(400),audioMimeType:"audio/mp4",context:context("ar")
    });
    assert.equal(answer.status,200);
    assert.equal(answer.data.transcript,transcript);
    assert.equal(answer.data.lang,"en");
    assert.equal(answer.data.rows.length,3);
    assert.equal(answer.data.rows[0].availableSeats,7);
    assert.ok(captured.at(-1).contents[0].parts.some(p=>p.inlineData&&p.inlineData.data==="A".repeat(400)));
  });

  await t.test("unclear speech and invalid dates fail without fabricated answers",async()=>{
    let answer=await ask(ownerA,{intent:"seats",date:day,transcript:""},
      {audioBase64:"A".repeat(400),audioMimeType:"audio/mp4",context:context()});
    assert.equal(answer.status,422);
    assert.match(answer.data.error,/التسجيل/);
    answer=await ask(ownerA,{intent:"seats",date:"2026-02-30",tripName:"Alpha Sunset East"},
      {text:"How many seats on 30 Feb?",context:context()});
    assert.equal(answer.status,422);
  });

  await t.test("QR/camera diagnosis guides safely without pretending a ticket was checked in",async()=>{
    const answer=await ask(ownerA,{intent:"troubleshoot",topic:"qr_checkin"},
      {text:"My QR scanner doesn't read the ticket",context:context()});
    assert.equal(answer.status,200);
    assert.equal(answer.data.source,"guide");
    assert.match(answer.data.text,/camera|QR/i);
    assert.doesNotMatch(JSON.stringify(answer.data),/checkedInAt|customerSnapshot/);
    const follow=await ask(ownerA,{intent:"troubleshoot",topic:"general"},
      {text:"It opens but doesn't read",context:context("en",{intent:"troubleshoot",topic:"qr_checkin"})});
    assert.equal(follow.status,200);
    assert.match(follow.data.text,/camera fail to open/i);
  });


  await t.test("iPhone voice language switch survives wrong Gemini intent and preserves unfinished draft",async()=>{
    const draft={titleAr:"رحلة بحرية"};
    const answer=await ask(ownerA,{
      intent:"help",replyLanguage:"ar",reply:"Manage trips in the Trips page",
      transcript:"بدنا نحكي بالإنجليزية",needsClarification:false
    },{audioBase64:"A".repeat(400),audioMimeType:"audio/mp4",
      context:{lang:"ar",mode:"create_trip",draft}});
    assert.equal(answer.status,200);
    assert.equal(answer.data.lang,"en");
    assert.equal(answer.data.mode,"create_trip");
    assert.equal(answer.data.draft.titleAr,"رحلة بحرية");
    assert.equal(answer.data.askFor,"durationMinutes");
    assert.match(answer.data.text,/how long/i);
    assert.equal(answer.data.transcript,"بدنا نحكي بالإنجليزية");
  });

  await t.test("plural visibility voice question reads only own trips, never generic model help",async()=>{
    const question="ليش رحلاتنا مش مبينة للعملاء؟";
    let answer=await ask(ownerA,{
      intent:"help",reply:"افتح صفحة الرحلات",transcript:question,
      tripName:"",needsClarification:false
    },{audioBase64:"A".repeat(400),audioMimeType:"audio/mp4",
      context:context("ar",{intent:"trip_info",tripName:"رحلة قديمة"})});
    assert.equal(answer.status,200);
    assert.equal(answer.data.intent,"trip_visibility");
    assert.equal(answer.data.source,"provider_data");
    assert.equal(answer.data.transcript,question);
    assert.match(answer.data.text,/رحلة غروب الشرق/);
    assert.match(answer.data.text,/رحلة غروب الغرب/);
    assert.match(answer.data.text,/لا توجد مغادرات مستقبلية مجدولة/);
    assert.doesNotMatch(answer.data.text,/رحلة خاصة برافو|99 JOD|افتح صفحة الرحلات/);

    answer=await ask(ownerB,{intent:"help",reply:"Use Trips",transcript:question},
      {audioBase64:"A".repeat(400),audioMimeType:"audio/mp4",context:context("ar")});
    assert.equal(answer.status,200);
    assert.match(answer.data.text,/رحلة خاصة برافو/);
    assert.doesNotMatch(answer.data.text,/رحلة غروب الشرق|رحلة غروب الغرب/);
  });

  await t.test("uncertain iPhone audio asks for correction rather than fabricated navigation",async()=>{
    const answer=await ask(ownerA,{
      intent:"help",reply:"افتح صفحة الرحلات",transcript:"فان شو كابتن وليلة آر",
      needsClarification:true
    },{audioBase64:"A".repeat(400),audioMimeType:"audio/mp4",context:context("ar")});
    assert.equal(answer.status,200);
    assert.match(answer.data.text,/ما قدرت أفهم التسجيل/);
    assert.doesNotMatch(answer.data.text,/افتح صفحة الرحلات/);
    assert.equal(answer.data.transcript,"فان شو كابتن وليلة آر");
  });


  await t.test("text fallback during Gemini overload reads only own trip facts without calling Google",async()=>{
    const callsBefore=captured.length;
    let answer=await ask(ownerA,{intent:"help",reply:"No model should be called"},{
      text:"شو أسعار رحلاتي؟",context:context("ar",{intent:"trip_info",tripName:"Bravo Secret Cruise"})
    });
    assert.equal(answer.status,200);
    assert.equal(answer.data.source,"provider_data");
    assert.match(answer.data.text,/رحلة غروب الشرق/);
    assert.match(answer.data.text,/رحلة غروب الغرب/);
    assert.doesNotMatch(answer.data.text,/رحلة خاصة برافو|99 JOD/);

    answer=await ask(ownerB,{intent:"help",reply:"No model should be called"},{
      text:"ليش رحلاتنا مش مبينة للعملاء؟",context:context("ar")
    });
    assert.equal(answer.status,200);
    assert.equal(answer.data.intent,"trip_visibility");
    assert.match(answer.data.text,/رحلة خاصة برافو/);
    assert.doesNotMatch(answer.data.text,/رحلة غروب الشرق|رحلة غروب الغرب/);
    assert.equal(captured.length,callsBefore,"Neither text query should call Gemini");
  });


  await t.test("V3.1 admin metrics are role-protected, anonymous and sourced from live request outcomes",async()=>{
    const admin=await User.create({name:"Assistant Quality Admin",phone:"+962790050109",role:"admin"});
    const endpoint="http://127.0.0.1:"+server.address().port+"/api/admin/assistant/metrics";
    let response=await originalFetch(endpoint);
    assert.equal(response.status,401);
    response=await originalFetch(endpoint,{headers:{authorization:"Bearer "+token(ownerA)}});
    assert.equal(response.status,403);
    response=await originalFetch(endpoint,{headers:{authorization:"Bearer "+token(customer)}});
    assert.equal(response.status,403);
    response=await originalFetch(endpoint,{headers:{authorization:"Bearer "+token(admin)}});
    assert.equal(response.status,200);
    assert.equal(response.headers.get("cache-control"),"no-store");
    const result=await response.json();
    assert.equal(result.scope,"single_process");
    assert.equal(result.retentionHours,24);
    assert.equal(result.hourly.length,24);
    assert.ok(result.totalRequests>0);
    const serialized=JSON.stringify(result);
    assert.doesNotMatch(serialized,/Alpha Tours|Bravo Marine|Operator A|Sunset Cruise|079005010|customerId|providerId|bookingId|audioBase64|transcript/);
    assert.equal(result.byMode.audio>0,true);
    assert.equal(result.bySource.local>0,true);
  });

  await t.test("AI requests never changed trips, bookings or ticket states",async()=>{
    assert.equal(await Trip.countDocuments({providerId:providerA._id}),2);
    assert.equal(await Trip.countDocuments({providerId:providerB._id}),1);
    assert.equal(await Booking.countDocuments(),3);
    assert.equal(await Booking.countDocuments({checkedInAt:{$exists:true}}),0);
    assert.equal((await Trip.findById(east._id)).pricing.adultPrice,20);
  });

  await t.test("V3 asks for a departure date instead of inventing which booking is missing",async()=>{
    const before=captured.length;
    const answer=await ask(ownerA,{intent:"help",reply:"generic advice"},
      {text:"ليش الحجز مش ظاهر؟",context:context("ar")});
    assert.equal(answer.status,200);
    assert.equal(answer.data.intent,"troubleshoot");
    assert.equal(answer.data.source,"guide");
    assert.match(answer.data.text,/تاريخ المغادرة/);
    assert.equal(answer.data.focus.topic,"booking_missing");
    assert.equal(answer.data.summary,undefined);
    assert.equal(captured.length,before,"Simple written diagnostic questions bypass Gemini");
  });

  await t.test("V3 booking status checks use only authorized provider dates and counts",async()=>{
    for(const status of ["pending_payment","cancelled","expired","refunded"]){
      await Booking.create({...booking(providerA._id,east._id,open._id,1),status});
    }
    const before=captured.length;
    const answer=await ask(ownerA,{intent:"help",reply:"not used"},
      {text:day,context:context("en",{intent:"troubleshoot",topic:"booking_missing"})});
    assert.equal(answer.status,200);
    assert.equal(answer.data.source,"provider_data");
    assert.equal(answer.data.summary.date,day);
    assert.equal(answer.data.summary.confirmed,2);
    assert.equal(answer.data.summary.pendingPayment,1);
    assert.equal(answer.data.summary.cancelled,1);
    assert.equal(answer.data.summary.expired,1);
    assert.equal(answer.data.summary.refunded,1);
    assert.match(answer.data.text,/Pending payment: 1/);
    assert.doesNotMatch(JSON.stringify(answer.data),/Bravo Secret Cruise|99 JOD|Operator A|Operator B|0790050104|commissionAmount/);
    assert.equal(captured.length,before);
  });

  await t.test("V3 foreign trip search and unauthorized roles never return other provider booking data",async()=>{
    const foreign=await ask(ownerA,{intent:"troubleshoot",topic:"booking_missing",date:day},
      {text:day,context:context("en",{intent:"troubleshoot",topic:"booking_missing",tripName:"Bravo Secret Cruise"})});
    assert.equal(foreign.status,200);
    assert.match(foreign.data.text,/could not find that trip/);
    assert.equal(foreign.data.summary,undefined);
    const own=await ask(ownerB,{intent:"troubleshoot",topic:"booking_missing",date:day},
      {text:day,context:context("en",{intent:"troubleshoot",topic:"booking_missing"})});
    assert.equal(own.status,200);
    assert.equal(own.data.summary.confirmed,1);
    assert.equal(own.data.summary.pendingPayment,0);
    assert.doesNotMatch(own.data.text,/Pending payment: 1/);
    const member=await ask(staffA,{intent:"troubleshoot",topic:"booking_missing",date:day},
      {text:day,context:context("en",{intent:"troubleshoot",topic:"booking_missing"})});
    assert.equal(member.status,200);
    assert.equal(member.data.summary.confirmed,2);
    const unauthorized=await ask(customer,{intent:"troubleshoot",topic:"booking_missing",date:day},
      {text:day,context:context("en",{intent:"troubleshoot",topic:"booking_missing"})});
    assert.equal(unauthorized.status,403);
    assert.equal(unauthorized.data.summary,undefined);
  });

  await t.test("V3 QR and seat mismatch diagnostics are aggregate-only and never check in tickets",async()=>{
    const before=await Booking.countDocuments({checkedInAt:{$exists:true}});
    let answer=await ask(ownerA,{intent:"troubleshoot",topic:"qr_checkin",date:day},
      {text:day,context:context("en",{intent:"troubleshoot",topic:"qr_checkin"})});
    assert.equal(answer.status,200);
    assert.equal(answer.data.source,"provider_data");
    assert.match(answer.data.text,/does not validate an individual QR code/);
    assert.match(answer.data.text,/Checked in: 0 of 2 confirmed bookings/);
    assert.doesNotMatch(JSON.stringify(answer.data),/customerId|customerSnapshot|checkedInBy|bookingId/);

    answer=await ask(ownerA,{intent:"troubleshoot",topic:"seats_mismatch",date:day},
      {text:day,context:context("en",{intent:"troubleshoot",topic:"seats_mismatch"})});
    assert.equal(answer.status,200);
    assert.match(answer.data.text,/Confirmed seats: 3/);
    assert.match(answer.data.text,/reserved seats in departure inventory: 5/);
    assert.equal(await Booking.countDocuments({checkedInAt:{$exists:true}}),before);
  });


  await t.test("V3.1 pilot: 20 typed questions on two providers, no Gemini cost or cross-provider disclosure",async()=>{
    const textCases=[
      ["A","شو أسعار رحلاتي؟","trip_info"],
      ["A","كم سعر رحلاتنا","trip_info"],
      ["A","اسعار الرحلات","trip_info"],
      ["A","هل اسعار الرحلات صح","trip_info"],
      ["A","سعر الرحلات اليوم","trip_info"],
      ["A","ليش رحلاتنا مش مبينة للعملاء","trip_visibility"],
      ["A","ليش رحلاتي ما بتظهر","trip_visibility"],
      ["A","الرحلات مش مبينة للعملاء","trip_visibility"],
      ["A","شو السبب رحلاتنا غير ظاهرة","trip_visibility"],
      ["A","لماذا الرحلات مش ظاهرة","trip_visibility"],
      ["A","الحجز مش ظاهر","troubleshoot"],
      ["A","الحجز مش مؤكد","troubleshoot"],
      ["B","شو أسعار رحلاتي؟","trip_info"],
      ["B","my trips cost","trip_info"],
      ["B","our trips price","trip_info"],
      ["B","all trips prices","trip_info"],
      ["B","Why are our trips not showing","trip_visibility"],
      ["B","all trips not visible","trip_visibility"],
      ["B","رحلاتكم مش ظاهرة","trip_visibility"],
      ["B","Why are my trips not visible","trip_visibility"]
    ];
    assert.equal(textCases.length,20);
    const before=captured.length;
    for(const [company,text,intent] of textCases){
      // Separate authorized users avoid crossing the production-like 25/15min per-user limit.
      const user=company==="A"?staffA:ownerB;
      const answer=await ask(user,{intent:"help",reply:"Unexpected Gemini invocation"},
        {text,context:context("ar")});
      assert.equal(answer.status,200,company+" / "+text+" status "+answer.status);
      assert.equal(answer.data.intent,intent,company+" / "+text+" intent");
      assert.equal(answer.data.source,intent==="troubleshoot"?"guide":"provider_data",company+" / "+text+" source");
      const raw=JSON.stringify(answer.data);
      if(intent==="troubleshoot"){
        assert.match(answer.data.text,/تاريخ المغادرة/,text);
        assert.equal(answer.data.summary,undefined,text);
      }else if(company==="A"){
        assert.match(raw,/رحلة غروب الشرق/,text);
        assert.doesNotMatch(raw,/رحلة خاصة برافو|Bravo Secret Cruise|99 JOD/,text);
      }else{
        assert.match(raw,/رحلة خاصة برافو/,text);
        assert.doesNotMatch(raw,/رحلة غروب الشرق|رحلة غروب الغرب|Alpha Sunset/,text);
      }
      assert.doesNotMatch(raw,/customerId|customerSnapshot|customerPhone|idempotencyKey|commissionValue|audioBase64|apiKey/i,text);
    }
    assert.equal(captured.length,before,"The 20 typed local questions must not contact Gemini");
  });

  await t.test("V3.1 pilot: 10 mocked voice flows use authorized facts, correction prompts and no writes",async()=>{
    const beforeCalls=captured.length;
    const beforeBookings=await Booking.countDocuments();
    const beforeTripA=await Trip.countDocuments({providerId:providerA._id});
    const beforeTripB=await Trip.countDocuments({providerId:providerB._id});
    const beforeCheckin=await Booking.countDocuments({checkedInAt:{$exists:true}});
    const audio={audioBase64:"A".repeat(400),audioMimeType:"audio/mp4"};
    const cases=[
      {company:"A",transcript:"How many seats on "+day,fixture:{intent:"seats",tripName:"Alpha Sunset East",date:day},
        lang:"en",intent:"seats",verify:r=>{assert.equal(r.data.source,"provider_data");assert.equal(r.data.rows.reduce((n,x)=>n+x.confirmedSeats,0),3);}},
      {company:"A",transcript:"بدنا نحكي بالإنجليزية",fixture:{intent:"help",replyLanguage:"ar",reply:"Use the menu"},lang:"ar",
        intent:"help",verify:r=>{assert.equal(r.data.lang,"en");assert.doesNotMatch(r.data.text,/Use the menu/);}},
      {company:"A",transcript:"ليش رحلاتنا مش مبينة للعملاء",fixture:{intent:"help",reply:"Open Trips"},lang:"ar",
        intent:"trip_visibility",verify:r=>{assert.equal(r.data.source,"provider_data");assert.match(r.data.text,/رحلة غروب الشرق/);}},
      {company:"A",transcript:"Scanner QR rejected on "+day,fixture:{intent:"troubleshoot",topic:"qr_checkin",date:day},
        lang:"en",intent:"troubleshoot",verify:r=>{assert.match(r.data.text,/does not validate an individual QR code/);}},
      {company:"A",transcript:"فان شو كابتن وليلة آر",fixture:{intent:"help",reply:"Open Trips",needsClarification:true},
        lang:"ar",intent:"help",verify:r=>{assert.match(r.data.text,/ما قدرت أفهم التسجيل/);assert.doesNotMatch(r.data.text,/Open Trips/);}},
      {company:"A",transcript:"Price of Bravo Secret Cruise",fixture:{intent:"trip_info",tripName:"Bravo Secret Cruise"},
        lang:"en",intent:"trip_info",verify:r=>{assert.doesNotMatch(r.data.text,/99 JOD|Bravo Secret Cruise.*Adult price/);}},
      {company:"B",transcript:"What is the price of Bravo Secret Cruise",fixture:{intent:"trip_info",tripName:"Bravo Secret Cruise"},
        lang:"en",intent:"trip_info",verify:r=>{assert.match(r.data.text,/99 JOD/);}},
      {company:"B",transcript:"My booking is missing for "+day,fixture:{intent:"troubleshoot",topic:"booking_missing",date:day},
        lang:"en",intent:"troubleshoot",verify:r=>{assert.equal(r.data.summary.confirmed,1);assert.equal(r.data.summary.pendingPayment,0);}},
      {company:"B",transcript:"ليش رحلاتنا مش مبينة للعملاء",fixture:{intent:"help",reply:"Open Trips"},lang:"ar",
        intent:"trip_visibility",verify:r=>{assert.match(r.data.text,/رحلة خاصة برافو/);assert.doesNotMatch(r.data.text,/رحلة غروب الشرق/);}},
      {company:"B",transcript:"How many seats today on "+day,fixture:{intent:"seats",date:day,tripName:"Bravo Secret Cruise"},
        lang:"en",intent:"seats",verify:r=>{assert.equal(r.data.rows.length,1);assert.equal(r.data.rows[0].confirmedSeats,2);}}
    ];
    assert.equal(cases.length,10);
    for(const [index,entry] of cases.entries()){
      const user=entry.company==="A"?staffA:ownerB;
      const answer=await ask(user,{...entry.fixture,transcript:entry.transcript,needsClarification:entry.fixture.needsClarification===true},
        {...audio,context:context(entry.lang)});
      assert.equal(answer.status,200,"voice case "+(index+1)+" / "+entry.transcript+" status");
      assert.equal(answer.data.intent,entry.intent,"voice case "+(index+1)+" intent");
      assert.equal(answer.data.transcript,entry.transcript,"voice case "+(index+1)+" transcript");
      entry.verify(answer);
      const raw=JSON.stringify(answer.data);
      assert.doesNotMatch(raw,/customerId|customerSnapshot|customerPhone|idempotencyKey|commissionValue|audioBase64|apiKey/i);
      if(entry.company==="A")assert.doesNotMatch(raw,/99 JOD/,"A must not access B's prices");
      else assert.doesNotMatch(raw,/رحلة غروب الشرق|رحلة غروب الغرب|Alpha Sunset/,"B must not access A's trips");
    }
    assert.equal(captured.length-beforeCalls,10,"Exactly ten mocked voice requests should reach the Gemini stub");
    assert.equal(await Booking.countDocuments(),beforeBookings);
    assert.equal(await Trip.countDocuments({providerId:providerA._id}),beforeTripA);
    assert.equal(await Trip.countDocuments({providerId:providerB._id}),beforeTripB);
    assert.equal(await Booking.countDocuments({checkedInAt:{$exists:true}}),beforeCheckin);
  });

});
