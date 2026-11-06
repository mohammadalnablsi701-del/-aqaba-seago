import test from "node:test";
import assert from "node:assert/strict";
import {normalizeAssistantBookingCounts,formatAssistantBookingDiagnosis} from "../src/services/providerAssistantDiagnostics.js";
import {localProviderFactQuery} from "../src/services/providerAssistantConversation.js";

test("V3 counts only whitelisted aggregate statuses, no raw booking or customer fields",()=>{
  const counts=normalizeAssistantBookingCounts([
    {_id:"confirmed",bookings:3,seats:6,customer:{name:"Private Client"}},
    {_id:"pending_payment",bookings:2,seats:4},
    {_id:"expired",bookings:1,seats:1},
    {_id:"unknown",bookings:5000,seats:5000}
  ]);
  assert.deepEqual(Object.keys(counts).sort(),["cancelled","confirmed","expired","pending_payment","refunded"].sort());
  assert.equal(counts.confirmed.bookings,3);
  assert.equal(counts.pending_payment.bookings,2);
  assert.equal(counts.unknown,undefined);
  const txt=formatAssistantBookingDiagnosis({
    date:"2026-11-10",tripName:"Sunset",topic:"booking_missing",departureCount:2,counts,lang:"en"
  });
  assert.match(txt,/Confirmed: 3/);
  assert.match(txt,/Pending payment: 2/);
  assert.match(txt,/Expired: 1/);
  assert.match(txt,/payment verification/);
  assert.doesNotMatch(txt,/Private Client|customer|phone|5000/);
});
test("V3 QR diagnosis does not validate a ticket or perform check-in",()=>{
  const txt=formatAssistantBookingDiagnosis({
    date:"2026-11-10",topic:"qr_checkin",departureCount:1,
    counts:normalizeAssistantBookingCounts([{_id:"confirmed",bookings:4,seats:10}]),
    checkedIn:2,lang:"en"
  });
  assert.match(txt,/Checked in: 2 of 4 confirmed bookings/);
  assert.match(txt,/does not validate an individual QR code/);
  assert.doesNotMatch(txt,/ticket valid|checked in successfully/i);
});
test("V3 capacity diagnosis distinguishes confirmed seats from reserved inventory",()=>{
  const txt=formatAssistantBookingDiagnosis({
    date:"2026-11-10",topic:"seats_mismatch",departureCount:2,
    counts:normalizeAssistantBookingCounts([{_id:"confirmed",bookings:2,seats:3}]),
    confirmedSeats:3,reservedSeats:5,capacity:20
  });
  assert.match(txt,/مقاعد مؤكدة: 3/);
  assert.match(txt,/مقاعد محجوزة في المخزون: 5/);
  assert.match(txt,/حجز دفع مؤقت/);
});
test("V3 written diagnostic intent and dates are scoped to safe focus",()=>{
  const a=localProviderFactQuery("ليش الحجز مش ظاهر؟",{lang:"ar"});
  assert.equal(a.intent,"troubleshoot");
  assert.equal(a.topic,"booking_missing");
  assert.equal(a.dateProvided,false);
  assert.equal(a.tripName,"");
  assert.equal(localProviderFactQuery("الحجز مش مؤكد؟",{}).topic,"booking_missing");
  assert.equal(localProviderFactQuery("المقاعد مش مطابقة",{}).topic,"seats_mismatch");
  assert.equal(localProviderFactQuery("عندي مشكلة QR",{}).topic,"qr_checkin");
  assert.equal(localProviderFactQuery("بكرا",{focus:{intent:"troubleshoot",topic:"booking_missing"}}).dateProvided,true);
  const follow=localProviderFactQuery("2026-11-10",{lang:"en",focus:{intent:"troubleshoot",topic:"booking_missing",tripName:"Sunset",date:""}});
  assert.equal(follow.date,"2026-11-10");
  assert.equal(follow.tripName,"Sunset");
  assert.equal(follow.context.lang,"en");
  assert.equal(localProviderFactQuery("بدي أضيف رحلة",{}),null);
  const safe=localProviderFactQuery("ليش الحجز مش ظاهر؟",{providerId:"other",phone:"0799999999"});
  assert.equal("providerId" in safe.context,false);
  assert.equal("phone" in safe.context,false);
});
