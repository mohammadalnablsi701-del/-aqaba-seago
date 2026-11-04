import assert from "node:assert/strict";
import { chromium } from "playwright";

// No database fixtures or checkout mutations. Even live-trips mode mocks every
// departure and quote: GET /api/trips is the only request allowed to reach API.
const url=process.env.SEAGO_QA_URL||"https://aqaba-seago-assistant-qa.onrender.com/?e2e=staging";
const mode=process.env.SEAGO_QA_MODE||"fixture";
assert.ok(["fixture","live-trips"].includes(mode),"SEAGO_QA_MODE must be fixture or live-trips");
const staging="https://aqaba-seago-api-staging.onrender.com";
const fixtureTrip={
  _id:"111111111111111111111111",titleEn:"QA Sunset Cruise",category:"sunset",
  providerId:{_id:"222222222222222222222222",businessName:"QA Fixture Operator"},
  pricing:{currency:"JOD",adultPrice:17,childPrice:10,pricePerPerson:17,buffetEnabled:false},
  durationMinutes:120,active:true,platformStatus:"allowed",images:[],
  departureLocation:{name:"QA Marina",address:"Aqaba, Jordan"}
};
const departureId="333333333333333333333333";
const startsAt="2030-01-04T15:00:00.000Z";
const date="2030-01-04";
const pageErrors=[],badResponses=[],unsafeRequests=[],unexpectedRequests=[];
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
let publishedTrips=null,liveTripRequests=0,quoteRequests=0;

async function bounded(locator,viewport,label){
  const box=await locator.boundingBox();
  assert.ok(box&&box.x>=-1&&box.y>=-1&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,
    `${label} must fit ${viewport.width}×${viewport.height}: ${JSON.stringify(box)}`);
}
async function openAssistant(page){
  await page.getByRole("button",{name:"Open SeaGo Assistant",exact:true}).click();
  await page.locator('.seago-assistant-panel[data-trips-loading="false"]').waitFor({timeout:65000});
}
async function send(page,message){
  const old=await page.locator(".seago-assistant-message--bot").count();
  await page.locator("#seago-assistant-input").fill(message);
  await page.locator("#seago-assistant-input").press("Enter");
  await page.waitForFunction(count=>document.querySelectorAll(".seago-assistant-message--bot").length>count,old);
}
async function contextFor(viewport){
  const context=await browser.newContext({viewport,deviceScaleFactor:1,isMobile:viewport.width<700,
    hasTouch:viewport.width<700,locale:"en-GB",timezoneId:"Asia/Amman",serviceWorkers:"block"});
  await context.route("**/api/**",async route=>{
    const request=route.request(),endpoint=new URL(request.url());
    const path=endpoint.pathname;
    const respond=body=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
    if(request.method()!=="GET"){
      unsafeRequests.push(`${request.method()} ${path}`);
      return route.abort("blockedbyclient");
    }
    if(path==="/api/trips"){
      if(mode==="fixture")publishedTrips=[fixtureTrip];
      else if(!publishedTrips){
        // Fetch explicit Staging instead of trusting the frontend API setting.
        const response=await fetch(staging+path,{signal:AbortSignal.timeout(90000)});
        assert.equal(response.status,200,"Live Staging trips must load successfully");
        publishedTrips=await response.json();
        assert.ok(Array.isArray(publishedTrips)&&publishedTrips.length>0,"Staging must return published trips");
        liveTripRequests++;
      }
      return respond(publishedTrips);
    }
    if(path==="/api/departures"){
      const tripId=endpoint.searchParams.get("tripId");
      return respond([{id:departureId,tripId,startsAt,capacity:5,reservedSeats:0,
        availableSeats:5,status:"scheduled",salesClosed:false}]);
    }
    if(path===`/api/departures/${departureId}/quote`){
      quoteRequests++;
      const adults=Number(endpoint.searchParams.get("adults"));
      const children=Number(endpoint.searchParams.get("children"));
      const mealPlan=endpoint.searchParams.get("mealPlan");
      assert.equal(adults,2,"Booking must request the two adults selected in chat");
      assert.equal(children,0);assert.equal(mealPlan,"without_buffet");
      return respond({departureId,adults,children,mealPlan,pricing:{currency:"JOD",
        adultUnitPrice:21.75,childUnitPrice:10,adultSubtotal:43.5,childSubtotal:0,grossAmount:43.5}});
    }
    if(path==="/api/auth/google/config")return respond({enabled:false});
    unexpectedRequests.push(path);
    return route.abort("blockedbyclient");
  });
  const page=await context.newPage();
  await page.clock.setFixedTime(new Date("2030-01-02T12:00:00.000Z"));
  page.on("pageerror",error=>pageErrors.push(error.message));
  page.on("response",response=>{if(response.status()>=500)badResponses.push(`${response.status()} ${response.url()}`);});
  await page.goto(url,{waitUntil:"domcontentloaded",timeout:90000});
  await page.getByRole("button",{name:"Open SeaGo Assistant",exact:true}).waitFor({timeout:60000});
  return {context,page};
}

try{
  console.log(`BROWSER QA mode=${mode}; Chromium emulation; NOT physical-device Safari, iOS simulator, or OS keyboard testing.`);
  for(const viewport of [{width:390,height:844},{width:320,height:568},{width:1280,height:900}]){
    const {context,page}=await contextFor(viewport);
    const header=page.locator(".hero__top-actions .seago-assistant-launcher--header");
    assert.equal(await header.count(),1,"Home must use the compact launcher beside the menu");
    assert.equal(await page.locator(".seago-assistant-launcher--floating").count(),0);
    assert.match(await page.locator(".hero-scene").evaluate(node=>getComputedStyle(node).backgroundImage),/aqaba-hero[.]jpg/);
    assert.equal(await page.locator("video").count(),0,"Deferred hero video must remain absent");
    await openAssistant(page);
    assert.equal(await page.locator(".seago-assistant-shortcut-grid button").count(),4);
    await bounded(page.getByRole("dialog"),viewport,"Assistant dialog");
    await bounded(page.locator("#seago-assistant-input"),viewport,"Message input");
    assert.doesNotMatch(await page.locator("body").innerText(),/[\u0600-\u06ff]/,"Customer UI must remain English-only");
    const close=page.getByRole("button",{name:"Close assistant",exact:true});
    assert.equal(await close.evaluate(node=>node===document.activeElement),true,"Opening must focus close control");
    await page.locator("#seago-assistant-input").fill("hello");
    await close.focus();await page.keyboard.press("Shift+Tab");
    assert.equal(await page.getByRole("button",{name:"Send message",exact:true}).evaluate(node=>node===document.activeElement),true,"Shift+Tab must stay inside dialog");
    await page.keyboard.press("Tab");
    assert.equal(await close.evaluate(node=>node===document.activeElement),true,"Tab must wrap inside dialog");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({state:"detached"});
    await page.waitForFunction(()=>document.activeElement?.getAttribute("aria-label")==="Open SeaGo Assistant");
    await openAssistant(page);
    await page.locator("#seago-assistant-input").fill("");
    if(viewport.width===390){
      // Exercise visualViewport handling without claiming a real OS keyboard.
      await page.locator("#seago-assistant-input").focus();
      await page.evaluate(()=>{
        Object.defineProperty(window.visualViewport,"height",{configurable:true,get:()=>500});
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
      await page.waitForFunction(()=>parseFloat(document.querySelector(".seago-assistant-panel").style.bottom)>300);
      await bounded(page.getByRole("dialog"),{width:390,height:500},"Synthetic keyboard viewport dialog");
      await bounded(page.locator("#seago-assistant-input"),{width:390,height:500},"Synthetic keyboard viewport input");
      await page.evaluate(()=>{delete window.visualViewport.height;window.visualViewport.dispatchEvent(new Event("resize"));});
      console.log("PASS Synthetic visualViewport keyboard resize, focus trap and Escape/focus return");
    }
    await page.getByRole("button",{name:/My tickets QR & booking help/}).click();
    await page.getByRole("button",{name:"Open My Tickets",exact:true}).click();
    await page.getByRole("heading",{name:"Sign in to view your tickets",exact:true}).waitFor();
    assert.equal(await page.locator(".seago-assistant-launcher--floating").count(),1,"Tickets must expose floating launcher");
    await openAssistant(page);
    await send(page,"contact support");
    await page.getByRole("button",{name:"Open Support",exact:true}).click();
    await page.getByRole("heading",{name:"How can we help?",exact:true}).waitFor();
    console.log(`PASS ${viewport.width}×${viewport.height}: welcome layout, English UI, header/floating launchers, ticket/support navigation, approved image and no video`);
    if(viewport.width===390){
      await openAssistant(page);
      await send(page,`sunset cruise for 2 people on ${date}`);
      const selected=publishedTrips.find(trip=>trip.titleEn==="Sunset Cruise")||publishedTrips.find(trip=>/sunset/i.test(trip.titleEn)&&/cruise/i.test(trip.titleEn));
      assert.ok(selected,"API dataset must include a published sunset cruise for this acceptance scenario");
      const recommendation=page.getByRole("button",{name:`View details for ${selected.titleEn}`,exact:true});
      await recommendation.waitFor();
      assert.match(await recommendation.innerText(),/4 Jan|Jan 4/);
      await recommendation.click();
      await page.locator(".detail-screen h1").waitFor();
      assert.equal((await page.locator(".detail-screen h1").innerText()).trim(),selected.titleEn);
      assert.equal(await page.locator(".seago-assistant-launcher--floating").count(),1);
      const departure=page.locator(".detail-departure-option.active");
      await departure.waitFor();
      assert.match(await departure.innerText(),/5 seats available/i);
      assert.match(await page.locator(".booking-search-context").innerText(),/04 Jan 2030.*2 persons/);
      await page.getByRole("button",{name:/Continue with selected time/}).click();
      await page.getByRole("heading",{name:"Choose your trip details",exact:true}).waitFor();
      await page.locator(".price-box__total strong").waitFor();
      assert.equal((await page.locator(".price-box__total strong").innerText()).trim(),"43.50 JOD","Booking must use quote response, not published base price");
      assert.equal((await page.locator(".booking-form--guests label").filter({hasText:"Adults"}).locator(".stepper b").innerText()).trim(),"2");
      assert.match(await page.locator(".booking-title .booking-search-context").innerText(),/04 Jan 2030.*2 persons/);
      await page.getByRole("button",{name:"Continue to secure payment",exact:true}).click();
      await page.getByRole("heading",{name:"Sign in to book",exact:true}).waitFor();
      console.log(`PASS ${mode} trip recommendation → exact trip → selected date/two adults → mocked authoritative quote → authentication before payment`);
    }
    await context.close();
  }
  assert.ok(quoteRequests>0,"Booking must request its price quote");
  if(mode==="live-trips")assert.equal(liveTripRequests,1,"Must fetch actual published Staging trips");
  assert.deepEqual(unsafeRequests,[],"No booking, checkout, payment, auth or other API mutation may be attempted");
  assert.deepEqual(unexpectedRequests,[],"Unexpected API requests must fail acceptance");
  assert.deepEqual(badResponses,[],"No HTTP 5xx responses");
  assert.deepEqual(pageErrors,[],"No unhandled JavaScript errors");
  console.log("PASS No API mutations, unexpected API requests, HTTP 5xx responses or unhandled JavaScript errors; no database fixture created");
}finally{await browser.close();}
