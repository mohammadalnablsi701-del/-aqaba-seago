import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createNativePushController } from "../customer-app/src/nativePushController.js";
import { NATIVE_PUSH_CONTEXT as context } from "../shared/nativePushContext.js";

function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
function harness(options={}){
  const handlers=new Map(),stored=new Map(options.stored||[]),calls=[],states=[],taps=[];
  let deleteAttempt=0;
  const plugin={
    checkPermissions:async()=>({receive:options.permission||"granted"}),
    requestPermissions:async()=>({receive:options.requested||"granted"}),
    createChannel:async()=>{},
    addListener:async(name,fn)=>{handlers.set(name,fn);return {remove:async()=>{if(handlers.get(name)===fn)handlers.delete(name);}};},
    register:async()=>{calls.push(["register"]);if(options.registrationError)handlers.get("registrationError")?.({error:"private token"});else if(!options.timeout)handlers.get("registration")?.({value:"fcm-registration-token-example"});},
    unregister:async()=>assert.fail("Capacitor unregister must not be used as the Firebase deletion fence")
  };
  const nativeBridge={
    isConfigured:async()=>{calls.push(["isConfigured"]);return {configured:options.configured!==false};},
    deleteToken:async()=>{
      calls.push(["deleteToken"]);deleteAttempt+=1;
      if(typeof options.deleteTokenHandler==="function")return options.deleteTokenHandler(deleteAttempt);
      if(options.deleteTokenPromise)await options.deleteTokenPromise;
      if(options.deleteTokenError)throw new Error("private firebase failure");
    }
  };
  const api={
    status:async()=>{calls.push(["status"]);if(options.backendError)throw new Error("backend down");return {enabled:options.backend!==false};},
    register:async(body,auth,generation)=>{calls.push(["bind",body,auth,generation]);if(options.persistError)throw new Error("private token");},
    unregister:async(id,auth,generation)=>calls.push(["unbind",id,auth,generation])
  };
  const controller=createNativePushController({plugin,nativeBridge,api,storage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},enabled:options.enabled!==false,platform:options.platform||"android",timeoutMs:20,uuid:()=>"installation_customer_123",notify:s=>states.push(s),onTap:info=>{taps.push(info);calls.push(["tap",info]);},onReceive:()=>calls.push(["receive"])});
  return {controller,plugin,nativeBridge,api,handlers,calls,states,stored,taps};
}
const flush=(ms=10)=>new Promise(resolve=>setTimeout(resolve,ms));

test("Android registration persists FCM context and lifecycle generation; refresh cannot leak raw token",async()=>{
  const h=harness();await h.controller.enable("customer-a");
  assert.equal(h.controller.status().subscribed,true);
  const bind=h.calls.find(c=>c[0]==="bind");
  assert.deepEqual(bind[1],{...context,token:"fcm-registration-token-example",installationId:"installation_customer_123",lifecycleGeneration:1});
  assert.equal(bind[2],"customer-a");assert.equal(bind[3],1);
  h.handlers.get("registration")({value:"fcm-refreshed-registration-token"});await flush();
  assert.equal(h.calls.filter(c=>c[0]==="bind").length,2);
  h.handlers.get("pushNotificationReceived")({private:"secret"});h.handlers.get("pushNotificationActionPerformed")({url:"https://attacker.invalid"});
  assert.ok(h.calls.some(c=>c[0]==="tap"));assert.ok(h.calls.some(c=>c[0]==="receive"));
  assert.doesNotMatch(JSON.stringify(h.states),/fcm-registration|private|secret/);
  await h.controller.disable("customer-a");
  assert.equal(h.handlers.has("registration"),false);
  assert.equal(h.handlers.has("pushNotificationActionPerformed"),true);
  assert.equal(h.calls.filter(c=>c[0]==="deleteToken").length,1);
});

test("restart reconciles an opted-in installation without a permission prompt and advances persisted lifecycle",async()=>{
  const h=harness({stored:[["seago_android_push_opt_in","true"],["seago_native_installation_id","installation_customer_123"],["seago_native_push_lifecycle_generation","7"]]});
  h.plugin.requestPermissions=()=>assert.fail("must not prompt at startup");
  await h.controller.setAuth("customer-a");assert.equal(h.controller.status().subscribed,true);
  assert.equal(h.calls.find(c=>c[0]==="bind")[1].lifecycleGeneration,8);
  assert.equal(h.stored.get("seago_native_push_lifecycle_generation"),"8");
  await h.controller.disable();
});

test("permission denied, registration error, persistence failure and timeout are observable and cleaned up",async()=>{
  for(const [options,pattern] of [[{permission:"denied"},/blocked/],[{registrationError:true},/failed/],[{timeout:true},/timed out/],[{persistError:true},/save notification/]]){
    const h=harness(options);await assert.rejects(h.controller.enable("customer-a"),pattern);
    assert.equal(h.controller.status().subscribed,false);assert.equal(h.handlers.has("registration"),false);
    assert.equal(h.handlers.has("pushNotificationActionPerformed"),true);
    assert.doesNotMatch(JSON.stringify(h.states),/private token/);
  }
});

test("feature disabled, backend disabled, missing Firebase config, iOS and browser cannot register Android FCM",async()=>{
  for(const options of [{enabled:false},{backend:false},{configured:false},{platform:"ios"},{platform:"web"}]){
    const h=harness(options);await assert.rejects(h.controller.enable("customer-a"),/not available|save notification/);
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

test("logout cancels pending registration and removes only session listeners",async()=>{
  const h=harness({timeout:true});
  const pending=h.controller.enable("customer-a");
  const rejection=assert.rejects(pending,/cancelled/);
  await flush();await h.controller.disable("customer-a");await rejection;
  assert.equal(h.handlers.has("registration"),false);
  assert.equal(h.handlers.has("pushNotificationActionPerformed"),true);
  assert.equal(h.calls.filter(c=>c[0]==="bind").length,0);
});

test("feature disabled plus no Firebase config: logout revokes server binding without any Firebase delete/unregister API",async()=>{
  const h=harness({enabled:false,configured:false});
  await h.controller.setAuth("customer-a");
  await h.controller.disable("customer-a");
  assert.ok(h.calls.some(c=>c[0]==="unbind"&&c[2]==="customer-a"));
  assert.equal(h.calls.filter(c=>c[0]==="deleteToken").length,0);
  assert.equal(h.calls.filter(c=>c[0]==="register").length,0);
});

test("feature disabled plus no Firebase config: account-deletion credential cleanup is safe and server-side revocation still completes",async()=>{
  const h=harness({enabled:false,configured:false});
  await h.controller.setAuth("customer-a");
  const accountDeletionCleanup=h.controller.disable("customer-a");
  await accountDeletionCleanup;
  assert.deepEqual(h.calls.filter(c=>c[0]==="unbind").map(c=>c.slice(0,4)),[["unbind","installation_customer_123","customer-a",2]]);
  assert.equal(h.calls.some(c=>c[0]==="deleteToken"),false);
});

test("stale enable(A) cannot execute with account B auth or restore opt-in after logout",async()=>{
  const h=harness();
  const staleEnable=h.controller.enable("customer-a");
  const staleResult=assert.rejects(staleEnable,/cancelled/);
  const logout=h.controller.disable("customer-a");
  const loginB=h.controller.setAuth("customer-b");
  await Promise.all([logout,loginB,staleResult]);
  assert.equal(h.calls.filter(c=>c[0]==="bind").length,0);
  assert.equal(h.stored.get("seago_android_push_opt_in"),undefined);
  assert.equal(h.controller.status().subscribed,false);
});

test("logout Firebase deleteToken completion is a hard barrier before immediate login/enable can register",async()=>{
  const deletion=deferred();
  const h=harness({deleteTokenPromise:deletion.promise});
  await h.controller.enable("customer-a");
  const registerCount=h.calls.filter(c=>c[0]==="register").length;
  const logout=h.controller.disable("customer-a");
  await flush();
  assert.equal(h.calls.filter(c=>c[0]==="deleteToken").length,1);
  const enableB=h.controller.enable("customer-b");
  await flush();
  assert.equal(h.calls.filter(c=>c[0]==="register").length,registerCount);
  deletion.resolve();
  await logout;await enableB;
  assert.equal(h.calls.filter(c=>c[0]==="register").length,registerCount+1);
});

test("Firebase token deletion failure is recoverable by a later explicit enable after a serialized retry succeeds",async()=>{
  const retry=deferred();
  const h=harness({deleteTokenHandler:async attempt=>{
    if(attempt===1)throw new Error("private firebase failure");
    if(attempt===2)await retry.promise;
  }});
  await h.controller.enable("customer-a");
  const registerCount=h.calls.filter(c=>c[0]==="register").length;
  await assert.rejects(h.controller.disable("customer-a"),/fully remove/);
  assert.equal(h.controller.status().subscribed,false);
  const enableB=h.controller.enable("customer-b");
  await flush();
  assert.equal(h.calls.filter(c=>c[0]==="deleteToken").length,2);
  assert.equal(h.calls.filter(c=>c[0]==="register").length,registerCount);
  assert.equal(h.controller.status().subscribed,false);
  retry.resolve();
  await enableB;
  assert.equal(h.calls.filter(c=>c[0]==="register").length,registerCount+1);
  assert.equal(h.controller.status().subscribed,true);
  assert.equal(h.stored.get("seago_android_push_opt_in"),"true");
  assert.doesNotMatch(JSON.stringify(h.states),/private firebase failure/);
});

test("Firebase token deletion retry failure remains privacy-safe and fail-closed",async()=>{
  const h=harness({deleteTokenHandler:async()=>{throw new Error("private firebase failure");}});
  await h.controller.enable("customer-a");
  await assert.rejects(h.controller.disable("customer-a"),/fully remove/);
  await assert.rejects(h.controller.enable("customer-b"),/fully remove/);
  assert.equal(h.calls.filter(c=>c[0]==="deleteToken").length,2);
  assert.equal(h.calls.filter(c=>c[0]==="register").length,1);
  assert.equal(h.controller.status().subscribed,false);
  assert.equal(h.stored.get("seago_android_push_opt_in"),undefined);
  assert.doesNotMatch(JSON.stringify(h.states),/private firebase failure/);
});

test("notification tap listener is installed before backend status and remains functional when status fails",async()=>{
  const h=harness({backendError:true});
  await assert.rejects(h.controller.enable("customer-a"),/save notification/);
  const tap=h.handlers.get("pushNotificationActionPerformed");
  assert.equal(typeof tap,"function");
  tap({notification:{data:{private:"secret"}}});
  assert.deepEqual(h.taps.at(-1),{authenticated:true,accountIdentity:"customer-a"});
  await h.controller.disable("customer-a");
  h.handlers.get("pushNotificationActionPerformed")({notification:{data:{private:"secret"}}});
  assert.deepEqual(h.taps.at(-1),{authenticated:false,accountIdentity:null});
  assert.doesNotMatch(JSON.stringify(h.taps),/secret/);
});

test("customer API forwards lifecycle generation on native revoke",()=>{
  const source=fs.readFileSync(new URL("../customer-app/src/api.js",import.meta.url),"utf8");
  assert.match(source,/unregisterNativePushToken=\(installationId,token,lifecycleGeneration\)/);
  assert.match(source,/JSON\.stringify\(\{installationId,lifecycleGeneration\}\)/);
});
