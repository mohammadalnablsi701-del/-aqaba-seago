import { chromium } from "playwright";

const locations=[
  "https://aqaba-seago-customer-logo-qa.onrender.com/",
  "https://aqaba-seago-assistant-qa.onrender.com/"
];
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 for(const url of locations){
   console.log("=== Browser diagnosis",url);
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:"en-US"});
   const page=await context.newPage();
   const events=[],responses=[];
   page.on("pageerror",err=>events.push("PAGE ERROR "+err.message));
   page.on("console",msg=>{if(msg.type()==="error") events.push("CONSOLE "+msg.text());});
   page.on("requestfailed",req=>events.push("FAILED REQUEST "+req.url()+" "+(req.failure()?.errorText||"")));
   page.on("response",resp=>{
     if(resp.status()>=400)responses.push({status:resp.status(),url:resp.url().slice(0,160)});
   });
   try{
     const res=await page.goto(url,{waitUntil:"domcontentloaded",timeout:60000});
     console.log("HTTP",res?.status(),"page URL",page.url());
     await page.waitForTimeout(5000);
     console.log("HTML",JSON.stringify((await page.locator("body").innerHTML()).slice(0,520)));
     const v=await page.evaluate(()=>({
       title:document.title,readyState:document.readyState,
       location:window.location.href,rootChildren:document.querySelector("#root")?.children.length,
       bodyText:document.body.innerText.slice(0,300),
       scripts:Array.from(document.scripts).map(s=>s.src),
       icon:Array.from(document.querySelectorAll(".brand__mark")).map(el=>({tag:el.tagName,src:el.src||null,complete:el.complete||null,naturalWidth:el.naturalWidth||null})),
       styles:Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(s=>s.href)
     }));
     console.log("DOM RESULT",JSON.stringify(v));
   }catch(e){console.log("NAVIGATION ERROR",String(e));}
   console.log("ERROR RESPONSES",JSON.stringify(responses));
   console.log("BROWSER ERRORS",JSON.stringify(events));
   await context.close();
 }
}finally{await browser.close();}
