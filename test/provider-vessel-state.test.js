import test from "node:test";
import assert from "node:assert/strict";
import{buildTripFormState,serializeTripForm}from"../provider-app/src/tripFormModel.js";

const baseTrip={
  _id:"trip-1",titleEn:"Sunset Cruise",titleAr:"رحلة الغروب",vesselName:"Sea Breeze",category:"sunset",durationMinutes:120,
  pricing:{adultPrice:17,childPrice:12,buffetEnabled:false,buffetAdultPrice:17,buffetChildPrice:12,buffetDescription:""},
  images:[{url:"https://example.test/trip.jpg"}],departureLocation:{name:"Ayla Marina",address:"Aqaba",googleMapsUrl:"https://maps.example.test"},active:true
};

test("create serializes vesselName from form state",()=>{
  const form=buildTripFormState();
  form.titleEn="New Trip";form.titleAr="New Trip";form.vesselName="  Aqaba One  ";
  assert.equal(serializeTripForm(form).vesselName,"Aqaba One");
});

test("edit initializes and preserves existing vesselName",()=>{
  const form=buildTripFormState({trip:baseTrip});
  assert.equal(form.vesselName,"Sea Breeze");
  assert.equal(serializeTripForm(form).vesselName,"Sea Breeze");
});

test("edit change serializes the updated vesselName",()=>{
  const form=buildTripFormState({trip:baseTrip});
  form.vesselName="Aquamarina";
  assert.equal(serializeTripForm(form).vesselName,"Aquamarina");
});

test("duplicate carries vesselName with copied trip data",()=>{
  const form=buildTripFormState({duplicateFrom:baseTrip});
  assert.equal(form.titleEn,"Sunset Cruise Copy");
  assert.equal(form.vesselName,"Sea Breeze");
  assert.equal(serializeTripForm(form).vesselName,"Sea Breeze");
});

test("empty vesselName is safe",()=>{
  const form=buildTripFormState({trip:{...baseTrip,vesselName:""}});
  assert.equal(form.vesselName,"");
  assert.equal(serializeTripForm(form).vesselName,"");
});
