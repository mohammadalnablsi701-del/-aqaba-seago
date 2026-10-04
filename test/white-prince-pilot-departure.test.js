import test from "node:test";
import assert from "node:assert/strict";

test("White Prince pilot departure time is a future Jordan 2 PM slot",()=>{
  const startsAt=new Date("2026-10-05T11:00:00.000Z");
  assert.equal(startsAt.toISOString(),"2026-10-05T11:00:00.000Z");
  assert.equal(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Amman",hour:"2-digit",minute:"2-digit",hour12:false}).format(startsAt),"14:00");
});
