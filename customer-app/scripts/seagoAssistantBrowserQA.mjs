import assert from "node:assert/strict";
import { chromium } from "playwright";

const url="https://aqaba-seago-assistant-qa.onrender.com/?e2e=staging";
const origin="https://aqaba-seago-api-staging.onrender.com";
const pageErrors=[];
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
try {
 const context=await browser.newContext({
   viewport:{width:390,height:844},
   deviceScaleFactor:3,
   isMobile:true,
   hasTouch:true,
   locale:"en-GB",
   timezoneId:"Asia/Amman"
 });
 const page=await context.newPage();
 page.on("pageerror",error=>pageErrors.push(String(error.message)));
 page.on("requestfailed",request=>console.log("REQUEST FAILED",request.url(),request.failure()?.errorText));
 page.on("request",request=>{if(request.url().startsWith(origin+"/api/"))console.log("API REQUEST",request.method(),new URL(request.url()).pathname);});
 page.on("console",m=>{if(m.type()==="error")console.log("BROWSER CONSOLE:",m.text().slice(0,300));});
 console.log("BROWSER QA: Mobile viewport 390×844, timezone Asia/Amman, Chromium touch emulation; NOT physical iPhone Safari.");
 const responses=[];
 page.on("response",response=>{if(response.url().startsWith(origin+"/api/"))responses.push({status:response.status(),path:new URL(response.url()).pathname});});
 await page.goto(url,{waitUntil:"domcontentloaded",timeout:90000});
 await page.getByRole("button",{name:"Open SeaGo Assistant"}).waitFor({timeout:60000});
 await page.getByRole("button",{name:"Open SeaGo Assistant"}).first().click();
 await page.getByRole("heading",{name:"SeaGo Assistant"}).waitFor();
 await page.locator('.seago-assistant-panel[data-trips-loading="false"]').waitFor({timeout:65000});
 console.log("BROWSER Trip data finished initial loading");
 await page.locator(".seago-assistant-shortcut-grid button").first().waitFor();
 assert.equal(await page.locator(".seago-assistant-shortcut-grid button").count(),4,"Should show four accessible welcome choices");
 const bounds=await page.locator(".seago-assistant-panel").boundingBox();
 assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=390&&bounds.y+bounds.height<=844,
   "Chat modal must fit inside a mobile viewport");
 console.log("PASS Chat opens, welcome buttons and mobile bounds");

 const editor=page.locator("#seago-assistant-input");
 await editor.fill("sunset cruise for 2 people on 2026-11-06");
 await page.getByRole("button",{name:"Send message"}).click();
 await page.locator(".seago-assistant-message--bot").last().waitFor({timeout:20000});
 console.log("BROWSER ASSISTANT REPLY:",(await page.locator(".seago-assistant-message--bot").last().innerText()).slice(0,1200));
 console.log("BROWSER API RESPONSES:",JSON.stringify(responses).slice(0,1500));
 const testTrip=page.getByRole("button",{name:"View details for [TEST] Sea Breeze Pilot Cruise"});
 await testTrip.waitFor({timeout:10000});
 const recommendation=await testTrip.innerText();
 assert.match(recommendation,/2026|Nov|JOD/);
 console.log("PASS Chat recognized sunset for 2 on 6 Nov and shows the available [TEST] Sea Breeze Pilot Cruise");

 await testTrip.click();
 await page.locator(".detail-screen h1").waitFor({timeout:15000});
 assert.match(await page.locator(".detail-screen h1").innerText(),/\[TEST\] Sea Breeze Pilot Cruise/);
 const departure=page.locator(".detail-departure-option");
 await departure.first().waitFor({timeout:20000});
 assert.match(await departure.first().innerText(),/5 seats available/i);
 await page.getByRole("button",{name:/Continue with selected time/}).click();
 await page.getByRole("heading",{name:"Choose your trip details"}).waitFor({timeout:20000});
 const quote=page.locator(".price-box");
 await quote.getByText("Total",{exact:true}).waitFor({timeout:35000});
 assert.match(await quote.innerText(),/2[.]00|2 JOD|JOD 2|2[.]000/);
 const adultStep=page.locator(".booking-form--guests label").filter({hasText:"Adults"}).locator(".stepper b");
 assert.equal((await adultStep.innerText()).trim(),"2","Chat requested two adults must persist to booking");
 console.log("PASS Chat recommendation -> same trip detail -> booking with 2 adults -> live price quote");

 await page.getByRole("button",{name:"Continue to secure payment"}).click();
 const auth=page.getByText(/Sign in|Create account|Continue with Google/i).first();
 await auth.waitFor({timeout:15000});
 console.log("PASS No payment without login: official customer authentication required");
 assert.equal(responses.filter(x=>x.status>=500).length,0,"No 5xx API responses");
 assert.equal(pageErrors.length,0,"No unhandled browser JavaScript errors: "+pageErrors.join("; "));
 console.log("PASS No 5xx responses or unhandled client errors");
 await context.close();
} finally {await browser.close();}
