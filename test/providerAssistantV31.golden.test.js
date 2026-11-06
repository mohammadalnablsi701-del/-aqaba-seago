import test from "node:test";
import assert from "node:assert/strict";
import {assistantLanguageSwitch,localProviderFactQuery,redactAssistantText} from "../src/services/providerAssistantConversation.js";
import {normalizeAssistantBookingCounts} from "../src/services/providerAssistantDiagnostics.js";
import {recordAssistantRequest,assistantMetricsSnapshot} from "../src/services/assistantMetrics.js";

// 150 deterministic regression fixture variations, not 150 live model evaluations.
// Distinct coverage groups: dialect commands, queries, ambiguity, safe context,
// synthetic sensitive-data redaction, booking aggregates and HTTP telemetry.
const starters=["بدنا نحكي","بدي احكي","خلينا نتكلم","ممكن نحكي","نقدر نتحدث","حابب احكي","يلا نحكي","اريد التحدث"];
const noLanguage=["English cruise price","اسم الرحلة الإنجليزية","سعر التذكرة العربية","موقعنا بالانجليزي","سعر رحلاتنا","The Arabic trip list"];
const visibility=["ليش رحلاتنا مش مبينة للعملاء","ليش رحلاتي ما بتظهر","لماذا الرحلات مش ظاهرة","الرحلات مش مبينة للعملاء","شو السبب رحلاتنا غير ظاهرة","Why are my trips not visible","Why are our trips not showing","all trips not visible","show all trips to customers","رحلاتكم مش ظاهرة"];
const prices=["شو أسعار رحلاتي؟","كم سعر رحلاتنا","اسعار الرحلات","all trips prices","my trips cost","our trips price","هل اسعار الرحلات صح","سعر الرحلات اليوم"];
const missing=["الحجز مش ظاهر","الحجز مش مؤكد","الحجز مو مؤكد","الحجوزات غير ظاهرة","حجز مفقود","ليش حجزي مش موجود","booking not confirmed","booking missing","booking not showing","booking not found","حجز ما بظهر","حجوزات ما بيبين","حجوزات مش مبينة","حجز غير مؤكد"];
const seats=["المقاعد مش مطابقة","مقاعد مش صح","مقعد مش مطابق","مقاعد مختلفة","المقاعد غلط","فرق المقاعد","capacity mismatch","seats mismatch","wrong seats","مقاعد غير مطابقة"];
const qr=["QR مش شغال","QR مشكلة","ماسح مش شغال","سكانر فشل","scanner not working","qr error","qr problem","QR مرفوض","ماسح ما بفتح","QR رفض","scanner fail","سكانر عطل"];
const negatives=["شو طقس العقبة بكرا","كم تكلفة الإيجار","مين مالك المنصة","احكيلي نكتة","سعر رحلة الغروب","الرحلة مش ظاهرة","تاريخ رحلة الغروب","How is the weather","I want to create a trip","كم قيمة الشيك","ما هي سياسة الإلغاء","كيف أغير كلمة السر"];
const followInputs=["اليوم","بكرا","غدا","today","tomorrow","2026-11-10"];
const followTopics=["booking_missing","seats_mismatch","qr_checkin"];
const redact=[
["foo@example.com","[email]"],["guest@seago.test","[email]"],["one.two@sample.org","[email]"],["operator+qa@fake.example","[email]"],
["qa_user@test.net","[email]"],["CONTACT@PRIVATE.CO","[email]"],["0791234567","[phone]"],["0790000001","[phone]"],
["+962791234567","[phone]"],["00962791234567","[phone]"],["111111111111","[number]"],["987654321098765","[number]"]];
const cases=[
...starters.flatMap(x=>[x+" بالانجليزي",x+" English"]).map(input=>({group:"language-en",input,expected:"en"})),
...starters.flatMap(x=>[x+" بالعربي",x+" Arabic"]).map(input=>({group:"language-ar",input,expected:"ar"})),
...noLanguage.map(input=>({group:"language-negative",input,expected:""})),
...visibility.map(input=>({group:"visibility",input,expected:"trip_visibility"})),
...prices.map(input=>({group:"prices",input,expected:"trip_info"})),
...missing.map(input=>({group:"bookings",input,expected:"booking_missing"})),
...seats.map(input=>({group:"seats",input,expected:"seats_mismatch"})),
...qr.map(input=>({group:"qr",input,expected:"qr_checkin"})),
...negatives.map(input=>({group:"negative",input,expected:null})),
...followTopics.flatMap(topic=>followInputs.map(input=>({group:"follow-up",input,expected:topic,topic}))),
...redact.map(([input,expected])=>({group:"redaction",input,expected})),
...["pending_payment","confirmed","cancelled","expired","refunded"].map((input,i)=>({group:"status",input,expected:i+1})),
...[200,201,204,206,400,401,403,422,429,500,503].map(input=>({group:"http-metric",input,
  expected:input<400?"successfulRequests":input===429?"rateLimited":input>=500?"serverErrors":"clientErrors"}))
];
assert.equal(cases.length,150,"V3.1 CI gate requires exactly 150 fixture cases");
for(const [index,fixture] of cases.entries()){
  test("V3.1 golden "+String(index+1).padStart(3,"0")+" "+fixture.group+" / "+fixture.input,()=>{
    let actual;
    switch(fixture.group){
      case "language-en":case "language-ar":case "language-negative":
        assert.equal(assistantLanguageSwitch(fixture.input),fixture.expected);break;
      case "visibility":case "prices":
        actual=localProviderFactQuery(fixture.input,{});
        assert.equal(actual?.intent||null,fixture.expected);
        assert.equal(actual?.source,"local_intent");break;
      case "bookings":case "seats":case "qr":
        actual=localProviderFactQuery(fixture.input,{});
        assert.equal(actual?.intent,"troubleshoot");
        assert.equal(actual.topic,fixture.expected);break;
      case "negative":
        assert.equal(localProviderFactQuery(fixture.input,{}),null);break;
      case "follow-up":
        actual=localProviderFactQuery(fixture.input,{lang:"en",focus:{
          intent:"troubleshoot",topic:fixture.topic,tripName:"Sunset"}});
        assert.equal(actual?.topic,fixture.expected);
        assert.equal(actual.dateProvided,true);
        assert.equal(actual.tripName,"Sunset");
        assert.equal(actual.context.lang,"en");break;
      case "redaction":
        actual=redactAssistantText("Contact "+fixture.input);
        assert.ok(actual.includes(fixture.expected));
        assert.ok(!actual.includes(fixture.input));break;
      case "status":
        actual=normalizeAssistantBookingCounts([{_id:fixture.input,bookings:fixture.expected,
          seats:2*fixture.expected,customerId:"never echoed"}]);
        assert.equal(actual[fixture.input].bookings,fixture.expected);
        assert.equal(actual[fixture.input].seats,2*fixture.expected);
        assert.doesNotMatch(JSON.stringify(actual),/customerId/);break;
      case "http-metric":
        const before=assistantMetricsSnapshot();
        recordAssistantRequest({status:fixture.input,mode:"text",source:"local",latencyMs:100});
        const after=assistantMetricsSnapshot();
        assert.equal(after[fixture.expected],before[fixture.expected]+1);
        assert.equal(after.totalRequests,before.totalRequests+1);break;
      default:throw Error("Unexpected fixture group: "+fixture.group);
    }
  });
}
