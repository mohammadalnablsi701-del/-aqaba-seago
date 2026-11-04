import {chromium} from "playwright";
import {mkdirSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const output=fileURLToPath(new URL("../../brand-qa-review/",import.meta.url));
mkdirSync(output,{recursive:true});
const apps=[
  {key:"provider",name:"SeaGo Provider",url:"https://aqaba-seago-provider-logo-qa.onrender.com/",brand:".provider-brand-mark",copy:"AQABA · PROVIDER"},
  {key:"admin",name:"SeaGo Admin",url:"https://aqaba-seago-admin-logo-qa.onrender.com/",brand:".admin-brand-mark",copy:"AQABA · ADMIN"}
];
const viewports=[{width:320,height:568},{width:390,height:844},{width:768,height:1024}];
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
const results=[];
try{
  for(const app of apps){
    for(const viewport of viewports){
      const context=await browser.newContext({viewport,isMobile:viewport.width<=390,hasTouch:viewport.width<=390,deviceScaleFactor:2});
      const page=await context.newPage();
      const errors=[];
      page.on("pageerror",e=>errors.push("JavaScript: "+e.message));
      page.on("requestfailed",r=>{
        if(/\.(?:js|css|svg)(?:\?|$)/i.test(r.url())) errors.push("Asset: "+r.url()+" "+r.failure()?.errorText);
      });
      const response=await page.goto(app.url,{waitUntil:"domcontentloaded",timeout:45000});
      if(!response?.ok()) throw new Error(`${app.name} returned HTTP ${response?.status()} at ${viewport.width}px`);
      await page.locator(app.brand).waitFor({state:"visible",timeout:20000});
      const state=await page.evaluate(({selector,copy})=>{
        const img=document.querySelector(selector);
        const root=document.querySelector("#root");
        return {
          rootChildren:root?.children.length||0,
          imageTag:img?.tagName,
          imageSrc:img?.getAttribute("src"),
          imageLoaded:img?.complete && img.naturalWidth===1024,
          brandCopy:document.body.innerText.includes(copy),
          recoveryHidden:getComputedStyle(document.getElementById("seago-boot-recovery")).display==="none"
        };
      },{selector:app.brand,copy:app.copy});
      if(state.rootChildren<1 || state.imageTag!=="IMG" || !state.imageLoaded || !state.brandCopy || !state.recoveryHidden)
        throw new Error(`${app.name} ${viewport.width}px failed: ${JSON.stringify(state)}`);
      if(!state.imageSrc.endsWith(`app-${app.key}.svg`))throw new Error("Unexpected logo asset "+state.imageSrc);
      if(errors.length)throw new Error(`${app.name} ${viewport.width}px JS/asset error: ${errors.join(" | ")}`);
      if(viewport.width===390) await page.screenshot({path:`${output}/${app.key}-390.png`,fullPage:true,animations:"disabled"});
      results.push(`PASS ${app.name} ${viewport.width}x${viewport.height}: React rendered, icon loaded, no runtime errors`);
      console.log(results.at(-1));
      await context.close();
    }
    // Test recovery without JavaScript, i.e. the failure mode from iPhone screenshot.
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,javaScriptEnabled:false});
    try{
      const page=await context.newPage(),r=await page.goto(app.url,{waitUntil:"domcontentloaded",timeout:45000});
      const visible=await page.locator("#seago-boot-recovery").isVisible();
      const retry=await page.getByRole("link",{name:`Reload ${app.name} if loading takes too long`}).count();
      const iconLoaded=await page.locator("#seago-boot-recovery img").evaluate(img=>img.complete&&img.naturalWidth===1024);
      if(!r?.ok()||!visible||retry!==1||!iconLoaded)
        throw new Error(`${app.name} no-JS fallback failed: ${JSON.stringify({status:r?.status(),visible,retry,iconLoaded})}`);
      results.push(`PASS ${app.name} JavaScript-disabled recovery: branded loader + Reload App`);
      console.log(results.at(-1));
    }finally{await context.close();}
  }
  const cards=apps.map(app=>`<article><h2>${app.name}</h2><img src="./${app.key}-390.png" alt="${app.name} login screen at 390px"/><a href="${app.url}">Open ${app.name} QA</a></article>`).join("");
  writeFileSync(`${output}/index.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SeaGo brand QA screenshots</title><style>body{font-family:system-ui;background:#eaf4f8;color:#071f33;margin:0;padding:24px}main{max-width:900px;margin:auto}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px}article{background:white;border-radius:18px;padding:14px}img{width:100%;height:auto;border:1px solid #ddd;border-radius:12px}a{display:block;margin-top:12px;color:#0b3d91;font-weight:700}</style><main><h1>SeaGo Provider + Admin Brand QA</h1><p>Automated Chromium screenshots at 390px; live previews, no real credentials used.</p><section>${cards}</section></main></html>`);
  console.log(`SUCCESS: ${results.length} checks; screenshot review generated`);
}finally{await browser.close();}
