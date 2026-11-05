import test from "node:test";
import assert from "node:assert/strict";
import {localGuidedTripTurn,safeGoogleMapsUrl,sanitizeTripConversationDraft} from "../src/services/providerAssistantConversation.js";

function next(state,text,pendingField=""){
  return localGuidedTripTurn(text,{mode:"create_trip",draft:state.draft,pendingField});
}
function start(){
  let state=localGuidedTripTurn("بدي أضيف رحلة",{});
  state=next(state,"رحلة غروب");
  state=next(state,"ساعتين");
  state=next(state,"10 دنانير");
  state=next(state,"8");
  assert.equal(state.askFor,"buffetEnabled");
  return state;
}
test("with buffet requires description and both buffet prices before departure",()=>{
  let s=start();
  s=next(s,"نعم");
  assert.equal(s.askFor,"buffetDescription");
  assert.equal(s.total,10);
  s=next(s,"مشاوي، أرز، سلطات وعصائر");
  assert.equal(s.askFor,"buffetAdultPrice");
  s=next(s,"25 دينار");
  assert.equal(s.askFor,"buffetChildPrice");
  s=next(s,"15 دينار");
  assert.equal(s.askFor,"locationName");
  s=next(s,"أيلة مارينا");
  assert.equal(s.askFor,"googleMapsUrl");
  s=next(s,"https://maps.app.goo.gl/MarinaTrip123");
  assert.equal(s.ready,true);
  assert.equal(s.progress,10);
  assert.equal(s.total,10);
  assert.equal(s.draft.buffetEnabled,true);
  assert.equal(s.draft.buffetDescription,"مشاوي، أرز، سلطات وعصائر");
  assert.equal(s.draft.buffetAdultPrice,25);
  assert.equal(s.draft.buffetChildPrice,15);
  assert.equal(s.draft.locationName,"أيلة مارينا");
  assert.match(s.text,/ما تم إنشاء أي شيء/);
});

test("without buffet skips additional buffet questions but still asks departure point",()=>{
  let s=start();
  s=next(s,"لا");
  assert.equal(s.draft.buffetEnabled,false);
  assert.equal(s.askFor,"locationName");
  assert.equal(s.total,7);
  s=next(s,"المرسى السياحي");
  assert.equal(s.askFor,"googleMapsUrl");
  s=next(s,"تخطي الرابط");
  assert.equal(s.ready,true);
  assert.equal(s.progress,7);
  assert.equal(s.draft.googleMapsSkipped,true);
  assert.equal(s.draft.googleMapsUrl,undefined);
  assert.match(s.text,/البوفيه: لا/);
});

test("Google Maps URLs are validated before allowing review",()=>{
  assert.equal(safeGoogleMapsUrl("https://example.com/maps"),"");
  assert.equal(safeGoogleMapsUrl("http://maps.google.com/maps"),"");
  assert.equal(safeGoogleMapsUrl("https://maps.google.com/?q=Aqaba"),"https://maps.google.com/?q=Aqaba");
  let s=start();
  s=next(s,"بدون بوفيه");
  s=next(s,"Marina");
  s=next(s,"https://example.com/maps");
  assert.equal(s.ready,false);
  assert.equal(s.askFor,"googleMapsUrl");
  assert.equal(s.draft.googleMapsUrl,undefined);
  s=next(s,"https://www.google.com/maps/place/Aqaba");
  assert.equal(s.ready,true);
});

test("changing buffet to no removes unused buffet fields",()=>{
  const draft={titleAr:"رحلة بحرية",durationMinutes:120,adultPrice:10,childPrice:8,
    buffetEnabled:true,buffetDescription:"عشاء",buffetAdultPrice:20,buffetChildPrice:12,
    locationName:"مرسى العقبة",googleMapsUrl:"https://maps.app.goo.gl/TestABC"};
  const edit=localGuidedTripTurn("بدي أغير البوفيه",{mode:"create_trip",draft});
  assert.equal(edit.pendingField,"buffetEnabled");
  const final=localGuidedTripTurn("لا",{mode:"create_trip",draft,pendingField:edit.pendingField});
  assert.equal(final.ready,true);
  assert.equal(final.draft.buffetEnabled,false);
  for(const field of ["buffetDescription","buffetAdultPrice","buffetChildPrice"]){
    assert.equal(field in final.draft,false);
  }
});

test("changes to buffet child price keep existing prices and place",()=>{
  const draft={titleAr:"رحلة بحرية",durationMinutes:120,adultPrice:10,childPrice:8,
    buffetEnabled:true,buffetDescription:"غداء",buffetAdultPrice:20,buffetChildPrice:12,
    locationName:"مرسى العقبة",googleMapsUrl:"https://maps.app.goo.gl/TestABC"};
  const edit=localGuidedTripTurn("بدي أغير سعر الطفل مع البوفيه",{mode:"create_trip",draft});
  assert.equal(edit.pendingField,"buffetChildPrice");
  const updated=localGuidedTripTurn("١٨",{mode:"create_trip",draft,pendingField:edit.pendingField});
  assert.equal(updated.draft.buffetChildPrice,18);
  assert.equal(updated.draft.adultPrice,10);
  assert.equal(updated.draft.locationName,"مرسى العقبة");
  assert.equal(updated.ready,true);
});
test("untrusted draft content cannot add arbitrary fields or unsafe map links",()=>{
  const data=sanitizeTripConversationDraft({titleAr:"تجربة",buffetEnabled:true,
    buffetAdultPrice:-20,buffetChildPrice:1e9,
    googleMapsUrl:"https://unrelated.example/map",otherField:"value"});
  assert.deepEqual(data,{titleAr:"تجربة",buffetEnabled:true});
});
