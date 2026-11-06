import test from "node:test";
import assert from "node:assert/strict";
import {assistantConversationContext,mergeTripConversationDraft,sanitizeTripConversationDraft,tripConversationStep,assistantSuggestionList,localGuidedTripTurn,safeGoogleMapsUrl,safeAssistantFocus,matchAssistantTrip,assistantTripSummary,assistantVisibilityDiagnosis,assistantTroubleshooting} from "../src/services/providerAssistantConversation.js";

test("Arabic guided creation asks for missing details one at a time and never autosaves",()=>{
  const first=tripConversationStep({});
  assert.deepEqual({progress:first.progress,askFor:first.askFor,ready:first.ready},{progress:0,askFor:"title",ready:false});
  assert.match(first.text,/شو بدك تسمّيها/);
  assert.equal(first.suggestions.length,3);
  const title=mergeTripConversationDraft({}, {titleAr:" رحلة غروب "});
  const second=tripConversationStep(title);
  assert.equal(second.askFor,"durationMinutes");
  assert.equal(second.progress,1);
  const third=tripConversationStep(mergeTripConversationDraft(title,{durationMinutes:120}));
  assert.equal(third.askFor,"adultPrice");
  const fourth=tripConversationStep(mergeTripConversationDraft(third.draft,{adultPrice:20}));
  assert.equal(fourth.askFor,"childPrice");
  const ready=tripConversationStep(mergeTripConversationDraft(fourth.draft,{childPrice:10}));
  assert.equal(ready.ready,false);
  assert.equal(ready.askFor,"buffetEnabled");
  assert.equal(ready.progress,4);
  assert.equal(ready.total,7);
  assert.match(ready.text,/بوفيه/);
});

test("context is untrusted and never transports provider IDs, customer info or payment fields",()=>{
  const ctx=assistantConversationContext({mode:"create_trip",draft:{
    titleAr:"  رحلة الغروب  ", adultPrice:25,childPrice:10,customerPhone:"0799999999",
    providerId:"someone-else",pricing:{commission:0},imageUrl:"https://x",active:true
  },customer:{name:"Should not leave browser"}});
  assert.deepEqual(ctx,{mode:"create_trip",draft:{titleAr:"رحلة الغروب",adultPrice:25,childPrice:10},pendingField:"",lang:"ar",focus:{intent:"",tripName:"",date:""}});
  assert.deepEqual(assistantConversationContext({mode:"admin",draft:null}),{mode:"",draft:{},pendingField:"",lang:"ar",focus:{intent:"",tripName:"",date:""}});
});

test("revised prices replace old ones without erasing earlier trip details",()=>{
  const first={titleAr:"سفينة الأبيض",durationMinutes:90,adultPrice:20,childPrice:10};
  const revised=mergeTripConversationDraft(first,{adultPrice:25,childPrice:null,durationMinutes:""});
  assert.deepEqual(revised,{...first,adultPrice:25});
  assert.equal(tripConversationStep(revised).askFor,"buffetEnabled");
});

test("invalid fields and impossible prices never become part of a saved draft",()=>{
  assert.deepEqual(sanitizeTripConversationDraft({category:"prototype",durationMinutes:-15,adultPrice:-20,childPrice:"hello",titleAr:43}),{});
  assert.equal(sanitizeTripConversationDraft({adultPrice:0,childPrice:0}).adultPrice,0);
  assert.deepEqual(assistantSuggestionList(["hi",false,"",123,"ok","later"]),["hi","ok","later"]);
});


test("written trip creation completes even when Gemini cannot be called",()=>{
  const start=localGuidedTripTurn("بدي أضيف رحلة",{});
  assert.equal(start.intent,"create_trip");
  assert.equal(start.askFor,"title");
  const titled=localGuidedTripTurn("رحلة غروب",{mode:"create_trip",draft:start.draft});
  assert.equal(titled.draft.titleAr,"رحلة غروب");
  assert.equal(titled.askFor,"durationMinutes");
  const duration=localGuidedTripTurn("ساعتين",{mode:"create_trip",draft:titled.draft});
  assert.equal(duration.draft.durationMinutes,120);
  assert.equal(duration.askFor,"adultPrice");
  const price=localGuidedTripTurn("10 دنانير",{mode:"create_trip",draft:duration.draft});
  assert.equal(price.draft.adultPrice,10);
  assert.equal(price.askFor,"childPrice");
  const child=localGuidedTripTurn("8",{mode:"create_trip",draft:price.draft});
  assert.equal(child.draft.childPrice,8);
  assert.equal(child.ready,false);
  assert.equal(child.askFor,"buffetEnabled");
  assert.equal(child.progress,4);
});

test("Arabic numeral characters, guided edits, and cancellation are safe",()=>{
  const draft={titleAr:"رحلة سنوركلينغ",durationMinutes:90,adultPrice:10,childPrice:8};
  const edit=localGuidedTripTurn("بدي أغير السعر",{mode:"create_trip",draft});
  assert.equal(edit.pendingField,"adultPrice");
  assert.equal(edit.ready,false);
  const revised=localGuidedTripTurn("٢٥ دينار",{mode:"create_trip",draft,pendingField:edit.pendingField});
  assert.equal(revised.draft.adultPrice,25);
  assert.equal(revised.draft.childPrice,8);
  assert.equal(revised.askFor,"buffetEnabled");
  const cancelled=localGuidedTripTurn("إلغاء المسودة",{mode:"create_trip",draft});
  assert.equal(cancelled.intent,"cancel");
  assert.equal(cancelled.mode,"");
});

test("guided trip flow cannot turn seat inquiries into trip changes",()=>{
  assert.equal(localGuidedTripTurn("كم مقعد محجوز بكرا؟",{mode:"create_trip",draft:{titleAr:"رحلة الغروب"}}),null);
  assert.equal(localGuidedTripTurn("كم مقعد محجوز اليوم؟",{}),null);
  const complete=localGuidedTripTurn("كيف أضيف رحلة؟",{});
  assert.equal(complete.askFor,"title");
});

test("no arbitrary context fields propagate through local trips",()=>{
  const ctx={mode:"create_trip",draft:{titleAr:"رحلة غروب",customerName:"Sensitive",providerId:"other-company",adultPrice:20},pendingField:"childPrice",apiKey:"not allowed"};
  const result=localGuidedTripTurn("٨",ctx);
  assert.deepEqual(result.draft,{titleAr:"رحلة غروب",adultPrice:20,childPrice:8});
  assert.equal("apiKey" in result,false);
  assert.equal("providerId" in result.draft,false);
});

test("switching to English during trip creation preserves the draft and pending question",()=>{
  const draft={titleAr:"رحلة غروب"};
  const start=localGuidedTripTurn("رد علي بالانجليزي",{mode:"create_trip",draft});
  assert.equal(start.lang,"en");
  assert.equal(start.askFor,"durationMinutes");
  assert.deepEqual(start.draft,draft);
  assert.match(start.text,/how long/i);
  const next=localGuidedTripTurn("2 hours",{mode:"create_trip",draft:start.draft,lang:start.lang});
  assert.equal(next.lang,"en");
  assert.equal(next.draft.durationMinutes,120);
  assert.equal(next.askFor,"adultPrice");
  assert.match(next.text,/adult price/i);
  const arabic=localGuidedTripTurn("رد علي بالعربي",{mode:"create_trip",draft:next.draft,lang:"en"});
  assert.equal(arabic.lang,"ar");
  assert.equal(arabic.draft.durationMinutes,120);
  assert.match(arabic.text,/سعر الشخص/);
});
test("English trip creation and suggestions work without Gemini or accidental field values",()=>{
  const start=localGuidedTripTurn("I want add trip",{});
  assert.equal(start.lang,"en");
  assert.equal(start.askFor,"title");
  assert.match(start.text,/call it/i);
  const named=localGuidedTripTurn("Sunset Cruise",{mode:"create_trip",draft:start.draft,lang:"en"});
  assert.equal(named.draft.titleAr,"Sunset Cruise");
  const duration=localGuidedTripTurn("3 hours",{mode:"create_trip",draft:named.draft,lang:"en"});
  assert.equal(duration.draft.durationMinutes,180);
  const adult=localGuidedTripTurn("20 JOD",{mode:"create_trip",draft:duration.draft,lang:"en"});
  const child=localGuidedTripTurn("Same as adult",{mode:"create_trip",draft:adult.draft,lang:"en"});
  assert.equal(child.draft.childPrice,20);
  const buffet=localGuidedTripTurn("No, without buffet",{mode:"create_trip",draft:child.draft,lang:"en"});
  assert.equal(buffet.draft.buffetEnabled,false);
  assert.match(buffet.text,/depart from/i);
  const edit=localGuidedTripTurn("Edit price",{mode:"create_trip",draft:buffet.draft,lang:"en"});
  assert.equal(edit.askFor,"adultPrice");
  assert.deepEqual(edit.draft,buffet.draft);
});


test("standalone language names switch provider help without Gemini or trip mutations",()=>{
  for(const term of ["انجليزي","إنجليزي","بالانجليزي","English","english!"]){
    const result=localGuidedTripTurn(term,{mode:"",lang:"ar",draft:{providerId:"secret"}});
    assert.equal(result.intent,"help",term);
    assert.equal(result.mode,"",term);
    assert.equal(result.lang,"en",term);
    assert.match(result.text,/reply in English/i,term);
    assert.equal("draft" in result,false,term);
  }
  for(const term of ["عربي","بالعربي","Arabic","ARABIC"]){
    const result=localGuidedTripTurn(term,{mode:"",lang:"en"});
    assert.equal(result.lang,"ar",term);
    assert.match(result.text,/العربي/);
  }
});

test("language commands preserve existing trip draft and seat-query context",()=>{
  const draft={titleAr:"رحلة غروب",durationMinutes:120};
  const command=localGuidedTripTurn("انجليزي",{mode:"create_trip",draft,lang:"ar"});
  assert.equal(command.lang,"en");
  assert.deepEqual(command.draft,draft);
  assert.equal(command.askFor,"adultPrice");
  assert.match(command.text,/adult price/i);
  const previous=localGuidedTripTurn("عربي",{mode:"create_trip",draft:command.draft,lang:"en"});
  assert.equal(previous.lang,"ar");
  assert.deepEqual(previous.draft,draft);
  assert.match(previous.text,/سعر الشخص/);
  const seats=localGuidedTripTurn("انجليزي",{mode:"seats",lang:"ar"});
  assert.equal(seats.mode,"seats");
  assert.equal(seats.intent,"help");
  assert.equal(seats.lang,"en");
  assert.equal(localGuidedTripTurn("كم مقعد محجوز اليوم؟",{mode:"seats",lang:"en"}),null);
});

test("assistant context keeps only whitelisted, bounded follow-up focus",()=>{
  const focus=safeAssistantFocus({intent:"trip_info",tripName:"Sunset",date:"2026-11-06",providerId:"not allowed",customerPhone:"0799999999"});
  assert.deepEqual(focus,{intent:"trip_info",tripName:"Sunset",date:"2026-11-06"});
  assert.deepEqual(safeAssistantFocus({intent:"admin",date:"tomorrow",tripName:"x".repeat(500)}),{intent:"",date:"",tripName:"x".repeat(80)});
  const context=assistantConversationContext({mode:"seats",lang:"en",focus:{...focus,customerId:"private"}});
  assert.deepEqual(context.focus,focus);
  assert.equal("customerId" in context.focus,false);
});

test("trip matching is provider-supplied only and ambiguous names are not guessed",()=>{
  const rows=[{titleAr:"رحلة الغروب",titleEn:"Sunset Cruise",vesselName:"White Prince"},{titleAr:"رحلة الغوص",titleEn:"Diving"}];
  assert.equal(matchAssistantTrip(rows,"sunset").match.titleEn,"Sunset Cruise");
  assert.equal(matchAssistantTrip(rows,"white prince").match.titleAr,"رحلة الغروب");
  assert.equal(matchAssistantTrip(rows,"").ambiguous,true);
  assert.equal(matchAssistantTrip(rows,"trip-not-here").match,null);
  const ambiguous=matchAssistantTrip([{titleAr:"رحلة غروب صباحية"},{titleAr:"رحلة غروب مسائية"}],"رحلة غروب");
  assert.equal(ambiguous.match,null);
  assert.equal(ambiguous.ambiguous,true);
});

test("trip answer shows only approved public price fields, never commission or PII",()=>{
  const row={titleAr:"Sunset",durationMinutes:120,pricing:{adultPrice:20,childPrice:10,commissionValue:900,buffetEnabled:true,buffetDescription:"Tea",buffetAdultPrice:25,buffetChildPrice:15},
    departureLocation:{name:"Ayla Marina",googleMapsUrl:"https://maps.app.goo.gl/abc"},customerPhone:"0799999999"};
  const ar=assistantTripSummary(row),en=assistantTripSummary(row,"en");
  assert.match(ar,/المدة: 120 دقيقة/);
  assert.match(en,/Adult price: 20 JOD/);
  assert.match(en,/Tea/);
  assert.match(en,/maps.app.goo.gl/);
  for(const text of [ar,en]){
    assert.doesNotMatch(text,/900|0799999999|commission|customerPhone/i);
  }
  assert.match(assistantTripSummary({titleAr:"Untitled",pricing:{}}, "en"),/Child price: —/);
});

test("visibility diagnosis distinguishes real blockers from unknown customer rendering",()=>{
  const active={titleAr:"الرحلة أ",active:true,platformStatus:"allowed"};
  const future=new Date(Date.now()+86400000).toISOString();
  assert.match(assistantVisibilityDiagnosis({...active,active:false},[], "en"),/inactive/);
  assert.match(assistantVisibilityDiagnosis({...active,platformStatus:"paused"},[], "en"),/paused/);
  assert.match(assistantVisibilityDiagnosis(active,[], "en"),/No future scheduled departure/);
  assert.match(assistantVisibilityDiagnosis(active,[{status:"scheduled",startsAt:future,capacity:10,reservedSeats:10,salesClosed:false}], "en"),/no free seats/);
  assert.match(assistantVisibilityDiagnosis(active,[{status:"scheduled",startsAt:future,capacity:10,reservedSeats:2,salesClosed:false}], "en"),/No obvious availability blocker/);
});

test("guided troubleshooting never asserts a ticket or payment is valid",()=>{
  const qr=assistantTroubleshooting("qr_checkin","en");
  assert.equal(qr.source,"guide");
  assert.match(qr.text,/exact error/);
  const pay=assistantTroubleshooting("payment","ar");
  assert.match(pay.text,/الدفع غير المؤكد/);
  assert.doesNotMatch(pay.text,/تم تأكيد الدفع/);
  assert.match(assistantTroubleshooting("invalid","en").text,/Which screen/);
});
