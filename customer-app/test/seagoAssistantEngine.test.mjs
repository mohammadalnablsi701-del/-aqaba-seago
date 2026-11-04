import test from "node:test";
import assert from "node:assert/strict";
import { parseAssistantRequest, answerSeaGoQuestion } from "../src/seagoAssistantEngine.js";

const now=new Date("2026-11-04T09:00:00Z");
const trips=[
  {id:"a",apiId:"a",source:"api",title:"Evening White Prince Yacht Cruise",category:"Evening Yacht",
    price:20,childPrice:15,description:"A sunset cruise",buffetEnabled:false,
    liveInventory:{nextDepartureAt:"2026-11-08T15:00:00Z",nextAvailableSeats:5}},
  {id:"b",apiId:"b",source:"api",title:"Coral Snorkeling Trip",category:"Snorkeling",price:15,
    liveInventory:{nextDepartureAt:null,nextAvailableSeats:0}}
];
const rows=[{startsAt:"2026-11-08T15:00:00Z",status:"scheduled",availableSeats:5},
{startsAt:"2026-11-06T15:00:00Z",status:"scheduled",availableSeats:1}];

test("extract requests for sunset, guests, budgets and Aqaba dates",()=>{
 const p=parseAssistantRequest("Sunset cruise for 2 people under 50 JOD on 2026-11-08",now);
 assert.deepEqual([p.guests,p.maxBudget,p.date,p.categories],[2,50,"2026-11-08",["sunset","yacht"]]);
 assert.equal(parseAssistantRequest("tomorrow",now).date,"2026-11-05");
});
test("never pretend a preview sample has real dates or prices",async()=>{
 const reply=await answerSeaGoQuestion("sunset cruise",trips,{hasLiveApi:false,now});
 assert.equal(reply.cards.length,0);
 assert.match(reply.text,/preview/i);
});
test("recommend matching real trips and keep actual adult price",async()=>{
 const reply=await answerSeaGoQuestion("sunset cruise for 2 people under 50 JOD",trips,{hasLiveApi:true,now,listDepartures:async()=>rows});
 assert.equal(reply.cards.length,1);
 assert.equal(reply.cards[0].tripId,"a");
 assert.equal(reply.cards[0].price,20);
 assert.match(reply.text,/adult base prices/i);
});
test("do not recommend a date without verified seats for all guests",async()=>{
 const reply=await answerSeaGoQuestion("sunset for 6 people on 2026-11-08",trips,{
   hasLiveApi:true,now,listDepartures:async()=>rows});
 assert.equal(reply.cards[0].availability,"No matching departure confirmed");
 assert.match(reply.text,/no confirmed departure/i);
});
test("specific day always revalidates against live departure data",async()=>{
 let called=0;
 const reply=await answerSeaGoQuestion("sunset for 2 people on 2026-11-08",trips,{
   hasLiveApi:true,now,listDepartures:async()=>{called++;return rows;}});
 assert.equal(called,1);
 assert.equal(reply.cards[0].availability,"2026-11-08T15:00:00Z");
});
test("failed API never claims a departure is available",async()=>{
 const reply=await answerSeaGoQuestion("sunset on 2026-11-08",trips,{
   hasLiveApi:true,now,listDepartures:async()=>{throw Error("offline");}});
 assert.match(reply.text,/couldn't verify/i);
 assert.equal(reply.cards[0].availability,"Availability not verified");
});
test("ticket/support/cancellation guidance does not expose bookings or execute actions",async()=>{
 for(const [prompt,type] of [["where is my qr ticket?","tickets"],["cancel my booking","support"],["human support","support"]]){
  const reply=await answerSeaGoQuestion(prompt,trips,{hasLiveApi:true,now});
  assert.equal(reply.action.type,type);
  assert.equal(reply.cards.length,0);
 }
});
test("budget is group estimated base, not per-person checkout quote",async()=>{
 const reply=await answerSeaGoQuestion("sunset for 2 people under 30 JOD",trips,{hasLiveApi:true,now});
 assert.equal(reply.cards.length,0);
 assert.match(reply.text,/published base prices/i);
});
test("missing verified trips never falls back to fabricated sample recommendations",async()=>{
 const reply=await answerSeaGoQuestion("anything",[],{hasLiveApi:true,now});
 assert.equal(reply.cards.length,0);
 assert.match(reply.text,/couldn't load verified/i);
});

test("invalid explicit date does not silently fall back to any day",async()=>{
 const response=await answerSeaGoQuestion("sunset for 2 on 2026-11-32",trips,{hasLiveApi:true,now});
 assert.equal(response.cards.length,0);
 assert.match(response.text,/date does not appear valid/i);
});
test("sunset cruises are not mixed with unrelated yacht tours",async()=>{
 const mixed=[...trips,{id:"c",apiId:"c",source:"api",title:"Daytime Yacht Cruise",category:"Yacht",price:10,
  liveInventory:{nextDepartureAt:"2026-11-07T10:00:00Z",nextAvailableSeats:10}}];
 const response=await answerSeaGoQuestion("sunset cruise",mixed,{hasLiveApi:true,now,listDepartures:async()=>rows});
 assert.deepEqual(response.cards.map(c=>c.tripId),["a"]);
});

test("rechecks live departures: later departure can seat a group when the first cannot",async()=>{
 let checked=0;
 const reply=await answerSeaGoQuestion("sunset cruise for 2 people",trips,{
   hasLiveApi:true,now,listDepartures:async()=>{checked++;return [
    {startsAt:"2026-11-06T15:00:00Z",status:"scheduled",availableSeats:1},
    {startsAt:"2026-11-08T15:00:00Z",status:"scheduled",availableSeats:4}
   ];}});
 assert.equal(checked,1);
 assert.equal(reply.cards.length,1);
 assert.equal(reply.cards[0].availableSeats,4);
 assert.equal(reply.cards[0].availability,"2026-11-08T15:00:00Z");
});
test("calendar weekday requests do not silently show another day",async()=>{
 for(const text of ["sunset cruise next Friday","boats this weekend","tickets next Monday"]){
  const reply=await answerSeaGoQuestion(text,trips,{now,hasLiveApi:true,listDepartures:async()=>rows});
  assert.equal(reply.cards.length,0);
  assert.match(reply.text,/YYYY-MM-DD/);
 }
});
test("mixed adult/child estimates use separate published prices and total seats",async()=>{
 const query=parseAssistantRequest("Sunset cruise for 2 adults and 2 kids under 70 JD",now);
 assert.equal(query.guests,4);assert.equal(query.adults,2);assert.equal(query.children,2);
 let checked=0;
 const reply=await answerSeaGoQuestion("sunset cruise for 2 adults and 2 kids under 70 JD",trips,{
   now,hasLiveApi:true,listDepartures:async()=>{checked++;return rows;}});
 assert.equal(checked,1);
 assert.equal(reply.cards[0].availability,"2026-11-08T15:00:00Z");
 assert.match(reply.text,/6–12/);
});
test("budget includes child pricing, not adult-only pricing",async()=>{
 const reply=await answerSeaGoQuestion("sunset for 2 adults and 2 children under 65 JD",trips,{
   now,hasLiveApi:true,listDepartures:async()=>rows});
 assert.equal(reply.cards.length,0); // 2*20 + 2*15 = 70 JOD
 assert.match(reply.text,/65 JOD/);
});
test("children without adult count require clarification, not invented ticket count",async()=>{
 const reply=await answerSeaGoQuestion("sunset cruise for 3 children",trips,{now,hasLiveApi:true,listDepartures:async()=>rows});
 assert.equal(reply.cards.length,0);
 assert.match(reply.text,/How many adults and children/);
});
test("all API failures with cached home availability fail closed",async()=>{
 const reply=await answerSeaGoQuestion("sunset cruise for 2 people",trips,{
   now,hasLiveApi:true,listDepartures:async()=>{throw new Error("offline")}});
 assert.equal(reply.cards[0].availability,"Availability not verified");
 assert.match(reply.text,/couldn't verify all live departures/i);
});
test("dates do not include expired or sold-out seats",async()=>{
 const reply=await answerSeaGoQuestion("sunset for 2 people on 2026-11-08",trips,{
   now,hasLiveApi:true,listDepartures:async()=>[
    {startsAt:"2026-11-08T15:00:00Z",status:"cancelled",availableSeats:20},
    {startsAt:"2026-11-08T16:00:00Z",status:"scheduled",availableSeats:1},
    {startsAt:"2026-11-08T17:00:00Z",status:"scheduled",availableSeats:0}
   ]});
 assert.equal(reply.cards[0].availability,"No matching departure confirmed");
});

test("family-of-four is four seats, not one default adult",()=>{
 const p=parseAssistantRequest("We are a family of 4 looking for a boat",now);
 assert.equal(p.guests,4);
 assert.equal(p.adults,4);
});
test("under-six child requests do not accidentally apply 6–12 child fares",async()=>{
 const ans=await answerSeaGoQuestion("2 adults and 1 child under 6 on a sunset cruise",trips,{
   hasLiveApi:true,now,listDepartures:async()=>rows});
 assert.equal(ans.cards.length,0);
 assert.match(ans.text,/under 6/);
});
