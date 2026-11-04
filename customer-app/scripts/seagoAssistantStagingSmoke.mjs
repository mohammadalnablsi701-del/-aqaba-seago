import assert from "node:assert/strict";

// Read-only acceptance smoke for the Customer QA origin. No credentials,
// reservations, payment mutations or production API calls are allowed.
const origin="https://aqaba-seago-assistant-qa.onrender.com";
const api="https://aqaba-seago-api-staging.onrender.com";
const fetchWithDeadline=(url,options={})=>fetch(url,{
 ...options,redirect:"follow",signal:AbortSignal.timeout(120_000)
});
function verifyCors(response,section){
 const allow=response.headers.get("access-control-allow-origin");
 assert.equal(allow,origin,`${section}: Staging API must explicitly allow the QA origin, got ${allow||"none"}`);
}
function statusOk(response,label){
 assert.ok(response.ok,`${label}: unexpected HTTP ${response.status}`);
}
console.log("SeaGo Assistant Staging read-only smoke");
const page=await fetchWithDeadline(origin+"/");
statusOk(page,"QA webpage");
const html=await page.text();
assert.ok(html.includes('id="root"'),"QA should serve the Customer app");
console.log("PASS QA static website is accessible");
const preflight=await fetchWithDeadline(api+"/api/trips",{
 method:"OPTIONS",
 headers:{Origin:origin,"Access-Control-Request-Method":"GET","Access-Control-Request-Headers":"content-type"}
});
statusOk(preflight,"Staging CORS preflight");
verifyCors(preflight,"Staging preflight");
console.log("PASS CORS preflight for the QA origin");
const health=await fetchWithDeadline(api+"/health",{headers:{Origin:origin}});
statusOk(health,"Staging health");
verifyCors(health,"Staging health");
const healthData=await health.json();
assert.equal(healthData.ok,true,"Staging API health must be healthy");
console.log("PASS Staging API health and CORS");
const res=await fetchWithDeadline(api+"/api/trips",{headers:{Origin:origin}});
statusOk(res,"Staging trips");
verifyCors(res,"Staging trips");
const trips=await res.json();
assert.ok(Array.isArray(trips),"GET /api/trips must return an array");
console.log(`PASS ${trips.length} published trips returned by Staging`);
let checked=0,available=0;
for(const trip of trips){
 if(!trip._id) continue;
 const departures=await fetchWithDeadline(api+"/api/departures?"+new URLSearchParams({
   tripId:String(trip._id),limit:"30"
 }),{headers:{Origin:origin}});
 statusOk(departures,"Staging departures");
 verifyCors(departures,"Staging departures");
 const rows=await departures.json();
 assert.ok(Array.isArray(rows),"GET /api/departures must return an array");
 checked++;
 available+=rows.filter(row=>row.status==="scheduled" && Number(row.availableSeats||0)>0 && new Date(row.startsAt)>new Date()).length;
}
console.log(`PASS ${checked} trip departure endpoints checked; ${available} future sellable departure rows observed`);
if(available===0)console.log("INVENTORY NOTICE No future sellable departures were found; checkout recommendation cannot be fully exercised.");
if(available>0)console.log("PASS Future Staging departure observed for booking acceptance");
else console.log("NOTICE No future inventory; browser E2E uses isolated in-browser departure and quote fixtures.");
console.log("RESULT Staging frontend, API, CORS and public read-only inventory contract passed");
