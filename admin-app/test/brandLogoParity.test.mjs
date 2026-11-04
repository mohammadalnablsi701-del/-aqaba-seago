import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("Admin in-app mark is the approved Direction A admin icon",()=>{
 const source=read("src/App.jsx"),icon=read("public/app-admin.svg"),favicon=read("public/admin-favicon-a-v1.svg");
 assert.equal(icon,favicon,"The in-app mark must match the launcher icon exactly");
 assert.match(icon,/id="helm"/);
 assert.match(source,/src={`\$\{import\.meta\.env\.BASE_URL\}app-admin\.svg`}/);
 assert.match(source,/alt="SeaGo Admin logo"/);
 assert.match(source,/AQABA · ADMIN/);
 assert.doesNotMatch(source,/<svg className="admin-brand-mark"/);
});

test("Admin brand and bootstrap are safe on mobile and when JavaScript fails",()=>{
 const html=read("index.html"),css=read("src/styles.css");
 assert.match(html,/<div id="root"><\/div><div id="seago-boot-recovery"/);
 assert.doesNotMatch(html,/#root:not\(:empty\)\+#seago-boot-recovery\{display:none\}/);
 assert.match(html,/window\.__seagoLaunchReady/);
 assert.match(html,/prefers-reduced-motion:reduce/);
 assert.match(html,/src="\.\/app-admin\.svg"/);
 assert.match(html,/>Reload App<\/a>/);
 assert.match(html,/prefers-reduced-motion:reduce/);
 assert.match(css,/\.admin-brand \.admin-brand-mark\{[^}]*object-fit:contain/);
});

test("Admin mounts the login even if a standalone preview has no version.json",()=>{
 const src=read("src/main.jsx");
 assert.doesNotMatch(src,/if\(!r\.ok\)return;/);
 assert.doesNotMatch(src,/if\(!commit\)return;/);
 assert.match(src,/if\(!r\.ok\)throw new Error/);
 assert.match(src,/createRoot\(document\.getElementById\("root"\)\)\.render/);
});

test("three-second splash stays until React commits; failed JS keeps branded recovery",async()=>{
 const {runInNewContext}=await import("node:vm");
 const script=read("index.html").match(/<script id="seago-launch-controller">([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script,"Inline launch controller missing");
 function harness(){
  let time=0,sequence=0;
  const queue=[],attributes=new Map(),classes=new Set();
  const root={setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:k=>attributes.delete(k)};
  const splash={hidden:false,classList:{add:k=>classes.add(k)}};
  const window={
   setTimeout(fn,delay){queue.push({at:time+delay,seq:sequence++,fn});},
   requestAnimationFrame(fn){queue.push({at:time+16,seq:sequence++,fn});}
  };
  const document={visibilityState:"visible",getElementById:id=>id==="root"?root:id==="seago-boot-recovery"?splash:null};
  runInNewContext(script,{window,document});
  const advance=until=>{
   for(;;){
    queue.sort((a,b)=>a.at-b.at||a.seq-b.seq);
    if(!queue.length||queue[0].at>until)break;
    const task=queue.shift();time=task.at;task.fn();
   }
   time=until;
  };
  return{advance,ready:()=>window.__seagoLaunchReady(),splash,attributes,classes};
 }
 const fast=harness();
 fast.ready();fast.advance(2999);
 assert.equal(fast.splash.hidden,false);
 assert.equal(fast.attributes.has("inert"),true);
 fast.advance(3032);
 assert.equal(fast.splash.hidden,true);
 assert.equal(fast.attributes.has("inert"),false);
 const failed=harness();
 failed.advance(10000);
 assert.equal(failed.splash.hidden,false,"Failed bundle must not reveal blank root");
 assert.equal(failed.attributes.has("inert"),true);
 failed.ready();failed.advance(10300);
 assert.equal(failed.splash.hidden,true,"Late mount should release after exit");
});
