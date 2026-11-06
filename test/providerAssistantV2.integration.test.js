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

});
