import test from "node:test";
import assert from "node:assert/strict";
import {assistantConversationContext,mergeTripConversationDraft,sanitizeTripConversationDraft,tripConversationStep,assistantSuggestionList} from "../src/services/providerAssistantConversation.js";

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
  assert.equal(ready.ready,true);
  assert.equal(ready.progress,4);
  assert.match(ready.text,/سعر الكبير: 20/);
  assert.match(ready.text,/ما تم إنشاء أي شيء/);
});

test("context is untrusted and never transports provider IDs, customer info or payment fields",()=>{
  const ctx=assistantConversationContext({mode:"create_trip",draft:{
    titleAr:"  رحلة الغروب  ", adultPrice:25,childPrice:10,customerPhone:"0799999999",
    providerId:"someone-else",pricing:{commission:0},imageUrl:"https://x",active:true
  },customer:{name:"Should not leave browser"}});
  assert.deepEqual(ctx,{mode:"create_trip",draft:{titleAr:"رحلة الغروب",adultPrice:25,childPrice:10}});
  assert.deepEqual(assistantConversationContext({mode:"admin",draft:null}),{mode:"",draft:{}});
});

test("revised prices replace old ones without erasing earlier trip details",()=>{
  const first={titleAr:"سفينة الأبيض",durationMinutes:90,adultPrice:20,childPrice:10};
  const revised=mergeTripConversationDraft(first,{adultPrice:25,childPrice:null,durationMinutes:""});
  assert.deepEqual(revised,first);
  assert.equal(revised.adultPrice,25);
  assert.equal(tripConversationStep(revised).ready,true);
});

test("invalid fields and impossible prices never become part of a saved draft",()=>{
  assert.deepEqual(sanitizeTripConversationDraft({category:"prototype",durationMinutes:-15,adultPrice:-20,childPrice:"hello",titleAr:43}),{});
  assert.equal(sanitizeTripConversationDraft({adultPrice:0,childPrice:0}).adultPrice,0);
  assert.deepEqual(assistantSuggestionList(["hi",false,"",123,"ok","later"]),["hi","ok","later"]);
});
