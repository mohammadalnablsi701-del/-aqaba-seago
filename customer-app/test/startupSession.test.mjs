import test from "node:test";
import assert from "node:assert/strict";
import { validateStartupSession } from "../src/startupSession.js";

function sessionStorage(token) {
  let value = token ? JSON.stringify({token, user:{id:"customer-qa"}}) : null;
  const removed=[];
  return {
    removed,
    getItem(key) { assert.equal(key,"seago_auth"); return value; },
    removeItem(key) { assert.equal(key,"seago_auth"); removed.push(key); value=null; },
    change(token) { value=token ? JSON.stringify({token, user:{id:"other-customer"}}) : null; }
  };
}
const unauthorized = () => Object.assign(new Error("Session expired"), {status:401});

test("a stored session without a live API cannot reveal unverified cached account content", async () => {
  const storage=sessionStorage("saved-token");
  let calls=0;
  await assert.rejects(validateStartupSession({hasApi:false, storage, validate:async()=>{calls++;}}), /Session verification is unavailable/);
  assert.equal(calls,0);
  assert.deepEqual(storage.removed,[]);
});

test("a signed-out startup is ready without an authentication request", async () => {
  const storage=sessionStorage();
  let calls=0;
  await validateStartupSession({hasApi:true, storage, validate:async()=>{calls++;}});
  await validateStartupSession({hasApi:false, storage, validate:async()=>{calls++;}});
  assert.equal(calls,0);
  assert.deepEqual(storage.removed,[]);
});

test("a restored valid session is verified before startup completes", async () => {
  const storage=sessionStorage("valid-token");
  let resolveValidation, completed=false;
  const validation=new Promise(resolve=>{resolveValidation=resolve;});
  const seen=[];
  const startup=validateStartupSession({hasApi:true, storage, validate:(token,{signal})=>{
    seen.push(token);
    assert.equal(signal.aborted,false);
    return validation;
  }}).then(()=>{completed=true;});
  await Promise.resolve();
  assert.equal(completed,false,"protected content must wait for the validation result");
  assert.deepEqual(seen,["valid-token"]);
  resolveValidation();
  await startup;
  assert.equal(completed,true);
  assert.deepEqual(storage.removed,[]);
});

test("an expired restored session clears only that session and continues signed out", async () => {
  const storage=sessionStorage("expired-token");
  const seen=[];
  await validateStartupSession({hasApi:true, storage, validate:async token=>{
    seen.push(token);
    throw unauthorized();
  }});
  assert.deepEqual(seen,["expired-token"]);
  assert.deepEqual(storage.removed,["seago_auth"]);
  assert.equal(storage.getItem("seago_auth"),null);
});

test("network and server failures keep the saved session and reject startup honestly", async () => {
  for (const error of [new Error("Network unavailable"),Object.assign(new Error("Service unavailable"),{status:503})]) {
    const storage=sessionStorage("unverified-token");
    await assert.rejects(validateStartupSession({hasApi:true, storage, validate:async()=>{throw error;}}),actual=>actual===error);
    assert.deepEqual(storage.removed,[]);
    assert.equal(JSON.parse(storage.getItem("seago_auth")).token,"unverified-token");
  }
});

test("a stalled validation reaches the deadline, aborts its request and keeps recovery possible", async () => {
  const storage=sessionStorage("unverified-token");
  let requestSignal;
  await assert.rejects(validateStartupSession({hasApi:true, storage, timeoutMs:15, validate:(_token,{signal})=>{
    requestSignal=signal;
    return new Promise(()=>{});
  }}),/Session verification timed out/);
  assert.equal(requestSignal.aborted,true);
  assert.deepEqual(storage.removed,[]);
});

test("an account changed during successful validation receives its own verification", async () => {
  const storage=sessionStorage("old-token");
  const seen=[];
  await validateStartupSession({hasApi:true, storage, validate:async token=>{
    seen.push(token);
    if (token==="old-token") storage.change("new-token");
  }});
  assert.deepEqual(seen,["old-token","new-token"]);
  assert.deepEqual(storage.removed,[]);
  assert.equal(JSON.parse(storage.getItem("seago_auth")).token,"new-token");
});

test("a late 401 from the old account never deletes a newer account", async () => {
  const storage=sessionStorage("old-token");
  const seen=[];
  await validateStartupSession({hasApi:true, storage, validate:async token=>{
    seen.push(token);
    if (token==="old-token") {
      storage.change("new-token");
      throw unauthorized();
    }
  }});
  assert.deepEqual(seen,["old-token","new-token"]);
  assert.deepEqual(storage.removed,[]);
  assert.equal(JSON.parse(storage.getItem("seago_auth")).token,"new-token");
});

test("signing out during validation allows a signed-out startup without another request", async () => {
  const storage=sessionStorage("old-token");
  const seen=[];
  await validateStartupSession({hasApi:true, storage, validate:async token=>{
    seen.push(token);
    storage.change(null);
  }});
  assert.deepEqual(seen,["old-token"]);
  assert.equal(storage.getItem("seago_auth"),null);
});

test("the verification deadline and abort signal are shared across an account change", async () => {
  const storage=sessionStorage("old-token");
  const seen=[];
  await assert.rejects(validateStartupSession({hasApi:true, storage, timeoutMs:15, validate:(token,{signal})=>{
    seen.push({token,signal});
    if (token==="old-token") {
      storage.change("new-token");
      return Promise.resolve();
    }
    return new Promise(()=>{});
  }}),/Session verification timed out/);
  assert.deepEqual(seen.map(request=>request.token),["old-token","new-token"]);
  assert.equal(seen[0].signal,seen[1].signal);
  assert.equal(seen[1].signal.aborted,true);
  assert.deepEqual(storage.removed,[]);
});
