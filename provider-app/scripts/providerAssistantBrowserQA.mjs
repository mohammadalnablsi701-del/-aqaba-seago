import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium,webkit} from 'playwright';

// The harness exists only in this local Vite middleware; production gets no QA route.
// All API calls and microphone resources are fixtures. No provider records are read or written.
const root=fileURLToPath(new URL('..',import.meta.url));
const evidence=fileURLToPath(new URL('../test-results/assistant/',import.meta.url));
await mkdir(evidence,{recursive:true});
const server=await createServer({root,base:'/',server:{host:'127.0.0.1',port:0},plugins:[{
  name:'isolated-assistant-qa',configureServer(s){s.middlewares.use(async(req,res,next)=>{
    if(req.url?.split('?')[0]!=='/__assistant_qa')return next();
    res.setHeader('Content-Type','text/html');
    res.end(await s.transformIndexHtml('/__assistant_qa',`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body><div id="root"></div><script type="module">
import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import ProviderAssistant from '/src/ProviderAssistant.jsx';import '/src/styles.css';
const root=ReactDOM.createRoot(document.getElementById('root'));
window.qaUnmount=()=>root.unmount();window.qaDrafts=[];
root.render(React.createElement(ProviderAssistant,{token:'qa-fixture-token',onClose:()=>root.unmount(),onUseDraft:d=>window.qaDrafts.push(d)}));
</script></body></html>`));
  });}
}]});
await server.listen();
const url=`http://127.0.0.1:${server.httpServer.address().port}/__assistant_qa`;
const engines=(process.env.SEAGO_QA_BROWSERS||'chromium,webkit').split(',');
let passed=0;
const failures=[];
const privacy='يُرسل محتوى رسائلك النصية أو الصوتية إلى Google لفهم طلبك. تجنّب مشاركة بيانات العملاء الشخصية.';
const disclaimer='ما بتم حفظ أي رحلة من المحادثة وحدها. راجع النموذج واضغط حفظ بنفسك.';
const answer={text:'أكيد، رحلتك جاهزة للمراجعة.\nراجع التفاصيل قبل الحفظ.',lang:'ar',suggestions:['كم مقعد متاح؟','بدي أضيف رحلة']};
const sel={input:'.seago-assistant-footer input',mic:'.seago-assistant-mic',stop:'.seago-assistant-stop',panel:'.seago-assistant-recording',time:'.seago-assistant-recording-time',bubble:'.seago-assistant-message.assistant:not(.seago-assistant-thinking)',thinking:'.seago-assistant-thinking'};
async function visible(page,selector){await page.locator(selector).waitFor({state:'visible'});}
async function absent(page,selector){await page.locator(selector).waitFor({state:'detached'});}
async function text(page,value){await page.locator(sel.input).fill(value);await page.locator(sel.input).press('Enter');}
async function bounded(page,selector){
  const viewport=page.viewportSize();
  for(const box of await page.locator(selector).evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};}))){
    assert.ok(box.x>=-1&&box.x+box.width<=viewport.width+1,`${selector} fits viewport: ${JSON.stringify(box)}`);
    assert.ok(box.height>=43,`${selector} touch target >=44px`);
  }
}
function installFixtures(){
  const state=window.qaAudio={permission:'granted',size:600,mime:'audio/mp4',supported:true,requests:0,starts:0,stops:0,trackStops:0,contexts:0,contextCloses:0,disconnects:0,reads:0,amplitude:12};
  const stream=()=>({getTracks:()=>[{stop(){state.trackStops++;}}]});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia(){
    state.requests++;
    if(state.permission==='denied')return Promise.reject(new DOMException('Denied','NotAllowedError'));
    if(state.permission==='pending')return new Promise(resolve=>{state.resolve=()=>resolve(stream());});
    return Promise.resolve(stream());
  }}});
  window.MediaRecorder=class{
    static isTypeSupported(){return state.supported;}
    constructor(_stream,options){this.mimeType=state.supported?(options?.mimeType||state.mime):state.mime;this.state='inactive';}
    start(){state.starts++;this.state='recording';}
    stop(){if(this.state!=='recording')throw new Error('duplicate stop');state.stops++;this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['x'.repeat(state.size)],{type:this.mimeType})});this.onstop?.();});}
  };
  window.AudioContext=class{
    constructor(){state.contexts++;this.state='running';}
    createMediaStreamSource(){return {connect(){},disconnect(){state.disconnects++;}};}
    createAnalyser(){return {disconnect(){state.disconnects++;},getByteTimeDomainData(buffer){state.reads++;buffer.fill(128+state.amplitude);}};}
    close(){this.state='closed';state.contextCloses++;return Promise.resolve();}
  };
  window.webkitAudioContext=undefined;
  window.qaAnimations=[];
  document.addEventListener('animationstart',event=>{if(event.target.classList?.contains('seago-assistant-message-enter'))window.qaAnimations.push(event.target.textContent);});
}
async function fixture(browser,options={}){
  const context=await browser.newContext({viewport:options.viewport||{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:options.reducedMotion||'no-preference'});
  await context.addInitScript(installFixtures);
  const page=await context.newPage();
  const requests=[],pending=[],errors=[];
  let response=answer,mode='success';
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/api/**',async route=>{
    assert.ok(route.request().url().endsWith('/api/providers/me/assistant'),'only assistant endpoint allowed');
    assert.equal(route.request().headers().authorization,'Bearer qa-fixture-token');
    requests.push(route.request().postDataJSON());
    if(mode==='hold')await new Promise(resolve=>pending.push(resolve));
    if(mode==='network')return route.abort('internetdisconnected');
    return route.fulfill({status:mode==='failure'?503:200,contentType:'application/json',body:JSON.stringify(mode==='failure'?{error:'Upload unavailable. Please retry.'}:response)});
  });
  await page.goto(url);await visible(page,'.seago-assistant');
  return {page,context,requests,errors,setResponse:v=>{response=v;},setMode:v=>{mode=v;},release:()=>pending.splice(0).forEach(f=>f()),async close(){assert.deepEqual(errors,[],'no browser runtime errors');await context.close();}};
}
async function scenario(browser,engine,name,run,options){
  if(process.env.SEAGO_QA_FILTER&&!name.includes(process.env.SEAGO_QA_FILTER))return;
  const f=await fixture(browser,options);
  try{await run(f);await f.close();passed++;console.log(`PASS ${engine}: ${name}`);}
  catch(error){failures.push(`${engine}: ${name}: ${error.stack}`);await f.page.screenshot({path:`${evidence}/${engine}-${name.replaceAll(/\W/g,'-')}-failure.png`}).catch(()=>{});await f.context.close();console.error(`FAIL ${engine}: ${name}: ${error.message}`);}
}
try{
  for(const engine of engines){
    const browser=await ({chromium,webkit}[engine]).launch({headless:true});
    try{
      await scenario(browser,engine,'footer privacy and narrow mobile controls',async({page})=>{
        assert.ok(!(await page.locator('footer').innerText()).includes(privacy));assert.ok(!(await page.locator('footer').innerText()).includes(disclaimer));
        assert.equal(await page.getByText(privacy,{exact:true}).count(),0);
        await page.locator('.seago-assistant-info-toggle').click();
        assert.equal(await page.locator('.seago-assistant-info-toggle').getAttribute('aria-expanded'),'true');
        assert.ok((await page.locator('.seago-assistant-info').innerText()).includes(privacy));assert.ok((await page.locator('.seago-assistant-info').innerText()).includes(disclaimer));
        await page.locator('.seago-assistant-info-toggle').click();
        assert.equal(await page.locator(sel.input).getAttribute('maxlength'),'1500');
        for(const width of [320,375,390,430]){
          await page.setViewportSize({width,height:844});await bounded(page,'.seago-assistant-footer form button');
          await bounded(page,'.seago-assistant-footer input');
          const strip=await page.locator('.seago-assistant-samples').evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth}));
          assert.ok(strip.scroll>strip.width,'suggestions overflow horizontally');
          assert.ok(await page.locator('.seago-assistant-samples button').first().evaluate(n=>n.getBoundingClientRect().height>=44));
        }
        await page.setViewportSize({width:390,height:844});
        await page.screenshot({path:`${evidence}/${engine}-390-chat.png`});
      });
      await scenario(browser,engine,'thinking suggestions direction stable animations',async(f)=>{
        const {page}=f;f.setMode('hold');
        const value=await page.locator('.seago-assistant-samples button').first().innerText();
        await page.locator('.seago-assistant-samples button').first().click();await visible(page,sel.thinking);
        assert.equal(f.requests[0].text,value);assert.equal(await page.locator(sel.thinking+' i').count(),3);
        assert.equal(await page.locator(sel.input).isDisabled(),true);
        assert.equal(await page.locator('.seago-assistant-footer button[type="submit"]').isDisabled(),true);
        f.setMode('success');f.release();await absent(page,sel.thinking);await page.locator('.seago-assistant-message-enter').waitFor();
        await page.waitForTimeout(400);
        const animation=await page.locator('.seago-assistant-message-enter').evaluate(n=>({name:getComputedStyle(n).animationName,duration:getComputedStyle(n).animationDuration,easing:getComputedStyle(n).animationTimingFunction}));
        assert.notEqual(animation.name,'none');assert.ok(parseFloat(animation.duration)>=.28&&parseFloat(animation.duration)<=.35);assert.equal(animation.easing,'cubic-bezier(0.22, 1, 0.36, 1)');
        const count=await page.evaluate(()=>window.qaAnimations.length);assert.equal(count,1);
        await page.locator(sel.input).fill('typing unrelated text');await page.locator('.seago-assistant-info-toggle').click();await page.locator('.seago-assistant-info-toggle').click();
        await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>window.qaAnimations.length),count);
        assert.equal(await page.locator(sel.bubble+' p').last().evaluate(n=>getComputedStyle(n).direction),'rtl');
        f.setResponse({...answer,text:'Your trip is ready.\nReview the form before saving.',lang:'en',suggestions:['Today bookings','Create a trip']});
        await text(page,'Show my trips');await page.waitForFunction(()=>document.querySelector('.seago-assistant')?.dir==='ltr');
        assert.equal(await page.locator(sel.bubble+' p').last().evaluate(n=>getComputedStyle(n).direction),'ltr');
        assert.equal(await page.locator('.seago-assistant-message.user p').last().evaluate(n=>getComputedStyle(n).direction),'ltr');
      });
      await scenario(browser,engine,'trip draft review keeps manual save',async f=>{
        const draft={titleEn:'Fixture sunset',adultPrice:20,childPrice:10,departureLocation:{name:'QA Marina'}};
        f.setResponse({text:'How many seats?',lang:'en',mode:'create_trip',intent:'create_trip',progress:2,total:4,pendingField:'capacity',draft,suggestions:['20']});
        await text(f.page,'Create a trip');await visible(f.page,'.seago-assistant-progress');
        await f.page.locator('.seago-assistant-samples button').click();
        f.setResponse({text:'Review your trip.',lang:'en',mode:'create_trip',intent:'create_trip',ready:true,progress:4,total:4,draft});
        // The first request may finish before setResponse; wait and send the next wizard turn.
        await absent(f.page,sel.thinking);await text(f.page,'Yes, review');await visible(f.page,'.seago-assistant-draft-button');
        await f.page.locator('.seago-assistant-draft-button').click();
        assert.deepEqual(await f.page.evaluate(()=>window.qaDrafts),[draft]);assert.equal(f.requests.at(-1).context.mode,'create_trip');
        assert.deepEqual(f.requests.at(-1).context.draft,draft);
      });
      await scenario(browser,engine,'recording zero timer waveform early stop once',async f=>{
        const {page}=f;await page.clock.install();await page.clock.pauseAt(new Date());
        await page.locator(sel.mic).click();await visible(page,sel.panel);
        assert.equal(await page.locator(sel.time).innerText(),'00:00 / 01:00');assert.equal(await page.locator(sel.mic).getAttribute('aria-pressed'),'true');
        assert.equal(await page.locator('.seago-assistant-samples button').first().isDisabled(),true);
        await page.clock.runFor(1250);assert.equal(await page.locator(sel.time).innerText(),'00:01 / 01:00');
        const first=await page.locator('.seago-assistant-waveform i').first().evaluate(n=>n.style.getPropertyValue('--bar-level'));
        await page.evaluate(()=>{window.qaAudio.amplitude=60;});await page.clock.runFor(160);
        const second=await page.locator('.seago-assistant-waveform i').first().evaluate(n=>n.style.getPropertyValue('--bar-level'));assert.notEqual(first,second);
        await page.screenshot({path:`${evidence}/${engine}-390-recording.png`});await page.setViewportSize({width:320,height:568});
        await bounded(page,sel.stop);await bounded(page,'.seago-assistant-footer form button');await page.screenshot({path:`${evidence}/${engine}-320-recording.png`});
        await page.evaluate(()=>{document.querySelector('.seago-assistant-stop').click();document.querySelector('.seago-assistant-mic').click();});
        await page.waitForFunction(()=>window.qaAudio.trackStops===1);await absent(page,sel.panel);await absent(page,sel.thinking);
        assert.equal(f.requests.length,1);assert.ok(f.requests[0].audioBase64);assert.equal(f.requests[0].audioMimeType,'audio/mp4');
        const counters=await page.evaluate(()=>window.qaAudio);assert.equal(counters.starts,1);assert.equal(counters.stops,1);assert.equal(counters.contextCloses,1);assert.equal(counters.disconnects,2);
        await page.clock.runFor(61000);assert.equal(f.requests.length,1);
      });
      await scenario(browser,engine,'automatic minute stop does not duplicate upload',async f=>{
        const {page}=f;await page.clock.install();await page.clock.pauseAt(new Date());await page.locator(sel.mic).click();await visible(page,sel.panel);
        await page.clock.runFor(59999);assert.equal(f.requests.length,0);assert.equal(await page.locator(sel.time).innerText(),'00:59 / 01:00');
        await page.clock.runFor(1);await page.waitForFunction(()=>window.qaAudio.stops===1);await absent(page,sel.panel);await absent(page,sel.thinking);
        assert.equal(f.requests.length,1);await page.clock.runFor(60000);assert.equal(f.requests.length,1);
      });
      await scenario(browser,engine,'permission denied retry and pending close cleanup',async f=>{
        const {page}=f;await page.evaluate(()=>{window.qaAudio.permission='denied';});await page.locator(sel.mic).click();await visible(page,'.seago-assistant-error');
        assert.match(await page.locator('.seago-assistant-error').innerText(),/مرفوض/);assert.equal(await page.locator(sel.bubble).count(),1);
        await page.evaluate(()=>{window.qaAudio.permission='pending';});
        await page.locator('.seago-assistant-error button').click();await page.waitForFunction(()=>window.qaAudio.requests===2);
        await page.evaluate(()=>document.querySelector('.seago-assistant-mic').click());assert.equal(await page.evaluate(()=>window.qaAudio.requests),2);
        await page.getByRole('button',{name:'إغلاق المساعد',exact:true}).click();await absent(page,'.seago-assistant');
        await page.evaluate(()=>window.qaAudio.resolve());await page.waitForFunction(()=>window.qaAudio.trackStops===1);assert.equal(f.requests.length,0);
      });
      await scenario(browser,engine,'unmount releases capture analyser and timers',async f=>{
        const {page}=f;await page.clock.install();await page.clock.pauseAt(new Date());await page.locator(sel.mic).click();await visible(page,sel.panel);await page.clock.runFor(250);
        await page.evaluate(()=>window.qaUnmount());await page.clock.runFor(61000);
        assert.deepEqual(await page.evaluate(()=>({tracks:window.qaAudio.trackStops,contexts:window.qaAudio.contextCloses,stops:window.qaAudio.stops})),{tracks:1,contexts:1,stops:1});assert.equal(f.requests.length,0);
      });
      for(const [kind,size,mime,expected] of [['empty',0,'audio/mp4',/ما وصل صوت/],['oversize',1200001,'audio/mp4',/أكبر من المسموح/],['unsupported',600,'audio/unsupported',/مش مدعومة/]]){
        await scenario(browser,engine,`${kind} audio friendly error`,async f=>{
          await f.page.evaluate(({size,mime,kind})=>{Object.assign(window.qaAudio,{size,mime,supported:kind!=='unsupported'});},{size,mime,kind});
          await f.page.locator(sel.mic).click();
          if(kind!=='unsupported'){await visible(f.page,sel.panel);await f.page.locator(sel.stop).click();}
          await visible(f.page,'.seago-assistant-error');assert.match(await f.page.locator('.seago-assistant-error').innerText(),expected);assert.equal(f.requests.length,0);assert.equal(await f.page.evaluate(()=>window.qaAudio.trackStops),1);
        });
      }
      for(const mode of ['failure','network']){
        await scenario(browser,engine,`${mode} upload retries same message`,async f=>{
          f.setMode(mode);await f.page.locator(sel.mic).click();await visible(f.page,sel.panel);await f.page.locator(sel.stop).click();await visible(f.page,'.seago-assistant-error');
          assert.equal(f.requests.length,1);const original=f.requests[0];f.setMode('success');await f.page.locator('.seago-assistant-error button').click();await absent(f.page,sel.thinking);
          assert.equal(f.requests.length,2);assert.equal(f.requests[1].audioBase64,original.audioBase64);assert.equal(await f.page.locator('.seago-assistant-message.user').count(),1);
        });
      }
      await scenario(browser,engine,'reduced motion disables message dots waveform pulses',async f=>{
        f.setMode('hold');await text(f.page,'hello');await visible(f.page,sel.thinking);
        assert.ok(await f.page.locator(sel.thinking+' i').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).animationName==='none')));
        f.setMode('success');f.release();await absent(f.page,sel.thinking);
        assert.equal(await f.page.locator('.seago-assistant-message-enter').last().evaluate(n=>getComputedStyle(n).animationName),'none');
        await f.page.locator(sel.mic).click();await visible(f.page,sel.panel);
        assert.ok(await f.page.locator('.seago-assistant-waveform i').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).animationName==='none')));
        assert.equal(await f.page.evaluate(()=>window.qaAudio.reads),0);await f.page.evaluate(()=>window.qaUnmount());
      },{reducedMotion:'reduce'});
      await scenario(browser,engine,'smart scroll preserves user reading position',async f=>{
        f.setResponse({...answer,text:Array.from({length:26},(_,i)=>`تفاصيل الرحلة والسعة ${i}`).join('\n')});
        await text(f.page,'Show all details');await f.page.waitForFunction(()=>document.querySelectorAll('.seago-assistant-message.assistant:not(.seago-assistant-thinking)').length===2);await absent(f.page,sel.thinking);await f.page.waitForFunction(()=>{const n=document.querySelector('.seago-assistant-messages');return n.scrollHeight-n.scrollTop-n.clientHeight<80;},{},{polling:50,timeout:5000});
        const log=f.page.locator('.seago-assistant-messages');
        assert.ok(await log.evaluate(n=>n.scrollHeight-n.scrollTop-n.clientHeight<80),JSON.stringify(await log.evaluate(n=>({top:n.scrollTop,height:n.clientHeight,scroll:n.scrollHeight,messages:n.children.length,visibility:document.visibilityState}))));
        await log.evaluate(n=>{n.dispatchEvent(new Event('pointerdown',{bubbles:true}));n.scrollTop=0;});await f.page.waitForTimeout(100);
        const top=await log.evaluate(n=>n.scrollTop);await text(f.page,'More details');await f.page.waitForFunction(()=>document.querySelectorAll('.seago-assistant-message.assistant:not(.seago-assistant-thinking)').length===3);await absent(f.page,sel.thinking);await f.page.waitForTimeout(500);
        assert.equal(await log.evaluate(n=>n.scrollTop),top);await visible(f.page,'.seago-assistant-jump');await f.page.locator('.seago-assistant-jump').click();await f.page.waitForTimeout(600);
        assert.ok(await log.evaluate(n=>n.scrollHeight-n.scrollTop-n.clientHeight<80),JSON.stringify(await log.evaluate(n=>({top:n.scrollTop,height:n.clientHeight,scroll:n.scrollHeight,messages:n.children.length,visibility:document.visibilityState}))));
      });
    }finally{await browser.close();}
  }
}finally{await server.close();}
console.log(`${passed} browser scenarios passed; ${failures.length} failed. Evidence: ${evidence}`);
if(failures.length){console.error(failures.join('\n\n'));process.exitCode=1;}
