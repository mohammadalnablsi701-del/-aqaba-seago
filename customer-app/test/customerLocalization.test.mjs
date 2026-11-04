import test from "node:test";
import assert from "node:assert/strict";
import {languageFromStorage,tr,localizedTripTitle,localizedTripDuration,localizedDepartureDate,verifiedTripImages} from "../src/customerLocalization.js";

test("Arabic and English lookup with safe English fallback",()=>{
 assert.equal(tr("Search Trips","ar"),"ابحث عن رحلات");
 assert.equal(tr("Search Trips","en"),"Search Trips");
 assert.equal(tr("Unknown label","ar"),"Unknown label");
 assert.equal(languageFromStorage("ar"),"ar");
 assert.equal(languageFromStorage("unknown"),"en");
});
test("Arabic title always uses the operator's own Arabic title",()=>{
 const trip={title:"White Prince",raw:{titleAr:"رحلة وايت برنس",durationMinutes:120}};
 assert.equal(localizedTripTitle(trip,"ar"),"رحلة وايت برنس");
 assert.equal(localizedTripTitle(trip,"en"),"White Prince");
 assert.equal(localizedTripDuration(trip,"ar"),"ساعتان");
});
test("duration fallback and Aqaba timezone respected",()=>{
 assert.equal(localizedTripDuration({duration:"2 hours"},"ar"),"2 hours");
 assert.match(localizedDepartureDate("2026-11-07T22:30:00Z","en"),/8 Nov/);
 assert.ok(localizedDepartureDate("2026-11-07T22:30:00Z","ar"));
});
test("operator photos require HTTPS and never synthesize stock imagery",()=>{
 assert.deepEqual(verifiedTripImages([
  "https://example.com/vessel.jpg",{url:"https://cdn.example.com/cruise.webp"},
  "javascript:alert(1)","http://insecure.example.com/photo.jpg","data:image/png;base64,AA",
  {url:"https://name:secret@example.com/photo.png"},null, ""
 ]),["https://example.com/vessel.jpg","https://cdn.example.com/cruise.webp"]);
 assert.deepEqual(verifiedTripImages([]),[]);
});
