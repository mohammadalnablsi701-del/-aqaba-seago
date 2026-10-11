import test from "node:test";
import assert from "node:assert/strict";
import { createNativePushController } from "../customer-app/src/nativePushController.js";
import { NATIVE_PUSH_CONTEXT as context } from "../shared/nativePushContext.js";

function harness(options={}){
  const handlers=new Map(),stored=new Map(options.stored||[]),calls=[],states=[];
  const plugin={
    checkPermissions:async()=>({receive:options.permission||"granted"}),
    requestPermissions:async()=>({receive:options.requested||"granted"}),
    createChannel:async()=>{},
    addListener:async(name,fn)=>{handlers.set(name,fn);return {remove:async()=>handlers.delete(name)};},
    register:async()=>{calls.push(["register"]);if(options.registrationError)handlers.get("registrationError")?.({error:"private token"});else if(!options.timeout)handlers.get("registration")?.({value:"fcm-registration-token-example"});},
    unregister:async()=>calls.push(["unregister"])
  };
  const api={status:async()=>({enabled:options.backend!==false}),register:async(body,auth)=>{calls.push(["bind",body,auth]);if(options.persistError)throw new Error("private token");},unregister:async(id,auth)=>calls.push(["unbind",id,auth])};
  const controller=createNativePushController({plugin,api,storage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},enabled:options.enabled!==false,platform:options.platform||"android",timeoutMs:20,uuid:()=>"installation_customer_123",notify:s=>states.push(s),onTap:()=>calls.push(["tap"]),onReceive:()=>calls.push(["receive"])});
  return {controller,plugin,api,handlers,calls,states,stored};
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,10));

test("Android registration persists FCM context and refreshes without raw token status",async()=>{
  const h=harness();await h.controller.enable("customer-a");
  assert.equal(h.controller.status().subscribed,true);
  const bind=h.calls.find(c=>c[0]==="bind");
  assert.deepEqual(bind[1],{...context,token:"fcm-registration-token-example",installationId:"installation_customer_123"});
  h.handlers.get("registration")({value:"fcm-refreshed-registration-token"});await flush();
  assert.equal(h.calls.filter(c=>c[0]==="bind").length,2);
  h.handlers.get("pushNotificationReceived")({private:"secret"});h.handlers.get("pushNotificationActionPerformed")({url:"https://attacker.invalid"});
  assert.ok(h.calls.some(c=>c[0]==="tap"));assert.ok(h.calls.some(c=>c[0]==="receive"));
  assert.doesNotMatch(JSON.stringify(h.states),/fcm-registration|private|secret/);
  await h.controller.disable("customer-a");assert.equal(h.handlers.size,0);
});
test("restart reconciles an opted-in installation without a permission prompt",async()=>{
  const h=harness({stored:[["seago_android_push_opt_in","true"],["seago_native_installation_id","installation_customer_123"]]});
  h.plugin.requestPermissions=()=>assert.fail("must not prompt at startup");
  await h.controller.setAuth("customer-a");assert.equal(h.controller.status().subscribed,true);
  await h.controller.disable();
});
test("permission denied, registration error, persistence failure and timeout are observable and cleaned up",async()=>{
  for(const [options,pattern] of [[{permission:"denied"},/blocked/],[{registrationError:true},/failed/],[{timeout:true},/timed out/],[{persistError:true},/save notification/]]){
    const h=harness(options);await assert.rejects(h.controller.enable("customer-a"),pattern);
    assert.equal(h.controller.status().subscribed,false);assert.equal(h.handlers.size,0);
    assert.doesNotMatch(JSON.stringify(h.states),/private token/);
  }
});
test("feature disabled, backend disabled, iOS and browser cannot register Android FCM",async()=>{
  for(const options of [{enabled:false},{backend:false},{platform:"ios"},{platform:"web"}]){
    const h=harness(options);await assert.rejects(h.controller.enable("customer-a"),/not available/);
    assert.equal(h.calls.filter(c=>c[0]==="bind"||c[0]==="register").length,0);
  }
});
test("account switch revokes old owner before rebinding; logout prevents stale refresh callbacks",async()=>{
  const h=harness();await h.controller.enable("customer-a");
  const stale=h.handlers.get("registration");
  await h.controller.setAuth("customer-b");
  const unbind=h.calls.findIndex(c=>c[0]==="unbind"&&c[2]==="customer-a");
  const bind=h.calls.findIndex(c=>c[0]==="bind"&&c[2]==="customer-b");
  assert.ok(unbind>=0 && bind>unbind);
  await h.controller.disable("customer-b");
  const count=h.calls.filter(c=>c[0]==="bind").length;
  stale({value:"old-private-refreshed-token"});await flush();
  assert.equal(h.calls.filter(c=>c[0]==="bind").length,count);
  assert.equal(h.stored.get("seago_android_push_opt_in"),undefined);
});
test("logout cancels pending registration and removes listeners",async()=>{
  const h=harness({timeout:true});
  const pending=h.controller.enable("customer-a");
  const rejection=assert.rejects(pending,/cancelled/);
  await flush();await h.controller.disable("customer-a");await rejection;
  assert.equal(h.handlers.size,0);assert.equal(h.calls.filter(c=>c[0]==="bind").length,0);
});
