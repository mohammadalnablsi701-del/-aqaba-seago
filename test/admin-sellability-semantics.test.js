import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PLATFORM_STATUS,
  isTripSellable,
  sellableNowDepartureFilter,
  sellableTripFilter,
  tripSalesSemantics
} from "../src/services/tripSales.js";

const approved={status:"approved"};
const suspended={status:"suspended"};
const semantics=(trip,provider=approved,hasSellableDeparture=true)=>tripSalesSemantics({trip,provider,hasSellableDeparture});

test("A: approved + provider active + platform allowed is sellable when a departure is sellable",()=>{
  const s=semantics({active:true,platformStatus:"allowed"});
  assert.deepEqual(s,{providerActive:true,platformAllowed:true,providerApproved:true,salesEligible:true,sellableNow:true,state:"sellable_now"});
});

test("B: provider paused + platform allowed is not sellable",()=>{
  const s=semantics({active:false,platformStatus:"allowed"});
  assert.equal(s.providerActive,false);
  assert.equal(s.platformAllowed,true);
  assert.equal(s.salesEligible,false);
  assert.equal(s.sellableNow,false);
  assert.equal(s.state,"provider_paused");
});

test("C/F: platform pause blocks sales without changing Provider Active truth",()=>{
  const s=semantics({active:true,platformStatus:"paused"});
  assert.equal(s.providerActive,true);
  assert.equal(s.platformAllowed,false);
  assert.equal(s.salesEligible,false);
  assert.equal(s.sellableNow,false);
  assert.equal(s.state,"platform_paused");
});

test("D: suspended provider blocks sales while preserving trip state",()=>{
  const s=semantics({active:true,platformStatus:"allowed"},suspended);
  assert.equal(s.providerActive,true);
  assert.equal(s.platformAllowed,true);
  assert.equal(s.providerApproved,false);
  assert.equal(s.salesEligible,false);
  assert.equal(s.sellableNow,false);
  assert.equal(s.state,"provider_blocked");
});

test("E: legacy missing platformStatus remains platform allowed",()=>{
  const trip={active:true};
  const s=semantics(trip);
  assert.equal(s.platformAllowed,true);
  assert.equal(s.salesEligible,true);
  assert.equal(isTripSellable({trip,provider:approved}),true);
  assert.deepEqual(sellableTripFilter({_id:"legacy"}),{_id:"legacy",active:true,platformStatus:{$ne:PLATFORM_STATUS.PAUSED}});
});

test("G: Platform Allowed truth is independent of provider active state",()=>{
  const active=semantics({active:true,platformStatus:"allowed"});
  const paused=semantics({active:false,platformStatus:"allowed"});
  assert.equal(active.platformAllowed,true);
  assert.equal(paused.platformAllowed,true);
});

test("H: sellable requires provider approval, Provider Active, Platform Allowed and sellable departure",()=>{
  assert.equal(semantics({active:true,platformStatus:"allowed"},approved,true).sellableNow,true);
  assert.equal(semantics({active:false,platformStatus:"allowed"},approved,true).sellableNow,false);
  assert.equal(semantics({active:true,platformStatus:"paused"},approved,true).sellableNow,false);
  assert.equal(semantics({active:true,platformStatus:"allowed"},suspended,true).sellableNow,false);
  assert.equal(semantics({active:true,platformStatus:"allowed"},approved,false).sellableNow,false);
});

test("Sellable Now departure filter matches checkout-level basic availability",()=>{
  const now=new Date("2026-10-10T10:00:00.000Z");
  const filter=sellableNowDepartureFilter({tripId:{$in:["trip-a"]}},now);
  assert.equal(filter.status,"scheduled");
  assert.deepEqual(filter.salesClosed,{$ne:true});
  assert.deepEqual(filter.startsAt,{$gt:now});
  assert.deepEqual(filter.tripId,{$in:["trip-a"]});
  assert.deepEqual(filter.$expr,{$gt:[{$ifNull:["$capacity",0]},{$ifNull:["$reservedSeats",0]}]});
});

test("I: Admin Trip UI consumes backend sellability instead of rebuilding sales rules",async()=>{
  const source=await readFile(new URL("../admin-app/src/App.jsx",import.meta.url),"utf8");
  assert.match(source,/const sales=t\.sellability\|\|null/);
  assert.match(source,/Sellable Now/);
  assert.match(source,/Provider Active:/);
  assert.match(source,/Platform Allowed:/);
  assert.doesNotMatch(source,/Boolean\(t\.active&&platformAllowed&&providerApproved\)/);
});

test("J/K: readiness uses sellable departures while confirmed booking operations stay independent",async()=>{
  const source=await readFile(new URL("../src/routes/admin.js",import.meta.url),"utf8");
  assert.match(source,/sellableNowDepartureFilter/);
  assert.match(source,/label:"At least one sellable departure now",ok:sellableDepartures>0/);
  assert.match(source,/providerActiveTrips,platformAllowedTrips,salesEligibleTrips,sellableTrips,sellableDepartures/);
  assert.match(source,/\$match:\{tripId:\{\$in:tripIds\},status:"confirmed"\}/);
  assert.match(source,/confirmedBookings:Number\(s\.bookings\|\|0\)/);
});

test("L: Task 7 authority filter remains backward compatible and platform-owned",()=>{
  const filter=sellableTripFilter({providerId:"provider-a"});
  assert.equal(filter.active,true);
  assert.deepEqual(filter.platformStatus,{$ne:"paused"});
  assert.equal(filter.providerId,"provider-a");
});
