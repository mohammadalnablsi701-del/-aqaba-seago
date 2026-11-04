import { chromium, webkit } from "playwright";
import { execFileSync } from "node:child_process";

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
   if(url.includes("customer-logo-qa")){
     const recovered=await page.locator("#seago-boot-recovery").evaluate(el=>getComputedStyle(el).display);
     console.log("RECOVERY WHILE APP RUNS",recovered);
     if(recovered!=="none")throw new Error("Fallback must hide when React is ready");
     const jsBlocked=await browser.newContext({viewport:{width:390,height:844},javaScriptEnabled:false});
     try{
       const noJsPage=await jsBlocked.newPage();
       const staticResponse=await noJsPage.goto(url,{waitUntil:"domcontentloaded",timeout:30000});
       const recovery=await noJsPage.locator("#seago-boot-recovery").isVisible();
       const retry=await noJsPage.getByRole("link",{name:"Reload Aqaba SeaGo if loading is taking too long"}).count();
       console.log("NO-JS RECOVERY",JSON.stringify({status:staticResponse?.status(),recovery,retry}));
       if(!recovery||retry!==1)throw new Error("Static boot recovery did not appear with JavaScript disabled");
     }finally{await jsBlocked.close();}
   }
   await context.close();
 }
}finally{await browser.close();}

console.log("=== WebKit (Safari engine) diagnostic, mobile viewport");
try {
  execFileSync("npx",["playwright","install","webkit"],{
    cwd:process.cwd()+"/customer-app",stdio:"pipe",timeout:120000
  });
  const safari=await webkit.launch({headless:true});
  try {
    const context=await safari.newContext({
      viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,
      userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"
    });
    const page=await context.newPage(),errors=[];
    page.on("pageerror",e=>errors.push("PAGE ERROR: "+e.message));
    page.on("requestfailed",r=>errors.push("FAILED: "+r.url()+" "+r.failure()?.errorText));
    const res=await page.goto("https://aqaba-seago-customer-logo-qa.onrender.com/",{waitUntil:"domcontentloaded",timeout:30000});
    await page.waitForTimeout(4500);
    const facts=await page.evaluate(()=>({
      text:document.body.innerText.slice(0,350),
      root:document.getElementById("root")?.children.length,
      logoLoaded:document.querySelector(".brand__mark")?.naturalWidth>0
    }));
    console.log("WEBKIT STATUS",res?.status(),"DOM",JSON.stringify(facts),"ERRORS",JSON.stringify(errors));
    await context.close();
  }finally{await safari.close();}
}catch(e){console.log("WEBKIT DIAGNOSTIC UNAVAILABLE",String(e).slice(0,1500));}
