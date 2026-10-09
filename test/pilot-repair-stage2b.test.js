import test from "node:test";
import assert from "node:assert/strict";
import { expectedCommissionForBooking,STAGE2B_PLAN_ID,STAGE2B_TRIP_TITLE } from "../src/services/pilotRepairStage2b.js";

test("Stage 2B targets the approved immutable plan and trip",()=>{
  assert.equal(STAGE2B_PLAN_ID,"2026-10-09-fun-n-sun-historical-commission-stage2b-v1");
  assert.equal(STAGE2B_TRIP_TITLE,"Coral Whisper + White Prince Experience");
});

test("Stage 2B computes five JOD per seat and never exceeds gross",()=>{
  assert.equal(expectedCommissionForBooking({seats:4,pricing:{grossAmount:100}}),20);
  assert.equal(expectedCommissionForBooking({seats:2,pricing:{grossAmount:37}}),10);
  assert.equal(expectedCommissionForBooking({seats:6,pricing:{grossAmount:12}}),12);
});
