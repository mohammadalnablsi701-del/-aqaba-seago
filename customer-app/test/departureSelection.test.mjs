import test from "node:test";
import assert from "node:assert/strict";
import { aqabaDateKey, availableDepartures, selectInitialDeparture } from "../src/departureSelection.js";
const now = new Date("2026-11-04T10:00:00Z");
const departures = [
  {id:"early",startsAt:"2026-11-06T06:00:00Z",status:"scheduled",availableSeats:8},
  {id:"chosen",startsAt:"2026-11-08T06:00:00Z",status:"scheduled",availableSeats:5},
  {id:"later",startsAt:"2026-11-09T06:00:00Z",status:"scheduled",availableSeats:5}
];
test("search on Nov 8 must never default to earlier Nov 6",()=>{
 assert.equal(selectInitialDeparture(departures,{date:"2026-11-08",guests:2},now)?.id,"chosen");
});
test("unavailable searched day must not automatically select any other day",()=>{
 assert.equal(selectInitialDeparture(departures,{date:"2026-11-08",guests:6},now),null);
 assert.equal(selectInitialDeparture(departures,{date:"2026-11-10",guests:2},now),null);
});
test("explicit departure ID accepted only when it matches requested date and seats",()=>{
 assert.equal(selectInitialDeparture(departures,{date:"2026-11-08",guests:2,departureId:"chosen"},now)?.id,"chosen");
 assert.equal(selectInitialDeparture(departures,{date:"2026-11-08",guests:2,departureId:"early"},now)?.id,"chosen");
});
test("browse flow without searched date defaults to earliest bookable time",()=>{
 assert.equal(selectInitialDeparture(departures,{guests:2},now)?.id,"early");
});
test("exclude expired, cancelled, fully booked or invalid departures",()=>{
 const rows=[{id:"past",startsAt:"2026-10-06T06:00:00Z",status:"scheduled",availableSeats:2},
 {id:"cancelled",startsAt:"2026-11-06T06:00:00Z",status:"cancelled",availableSeats:2},
 {id:"full",startsAt:"2026-11-06T06:00:00Z",status:"scheduled",availableSeats:0},
 {id:"invalid",startsAt:"bad",status:"scheduled",availableSeats:2},departures[2],departures[0]];
 assert.deepEqual(availableDepartures(rows,now).map(row=>row.id),["early","later"]);
});
test("Aqaba midnight date consistent irrespective of the user's timezone",()=>{
 assert.equal(aqabaDateKey("2026-11-07T22:30:00Z"),"2026-11-08");
 assert.equal(aqabaDateKey("2026-11-08T20:30:00Z"),"2026-11-08");
 assert.equal(aqabaDateKey("bad"),"");
});
