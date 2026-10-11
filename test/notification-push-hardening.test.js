import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import jwt from "jsonwebtoken";
import pushRouter from "../src/routes/push.js";
import User from "../src/models/User.js";
import PushSubscription from "../src/models/PushSubscription.js";
import NativePushToken from "../src/models/NativePushToken.js";
import { deliverWebPush } from "../src/services/push.js";
import {
  credentialFingerprint,
  maskEmail,
  minimizedPushEnvelope,
  safePushData
} from "../src/utils/notificationPrivacy.js";
import { notificationRouteInternals } from "../src/routes/notifications.js";

const ENDPOINT="https://fcm.googleapis.com/fcm/send/same-device-endpoint";
const SUBSCRIPTION={endpoint:ENDPOINT,keys:{p256dh:"public-key-material",auth:"auth-secret-material"}};
const A="507f1f77bcf86cd799439011";
const B="507f191e810c19729de860ea";

function source(path){return fs.readFileSync(new URL(path,import.meta.url),"utf8");}

async function startPushApp(){
  const app=express();
  app.use(express.json());
  app.use("/api/push",pushRouter);
  const server=app.listen(0,"127.0.0.1");
  return new Promise((resolve,reject)=>{
    server.once("listening",()=>resolve({server,baseUrl:`http://127.0.0.1:${server.address().port}`}));
    server.once("error",reject);
  });
}

function authToken(userId){return jwt.sign({sub:userId,role:"customer",ver:0},process.env.JWT_SECRET,{expiresIn:"1h"});}

async function jsonRequest(baseUrl,path,{token,body}={}){
  const response=await fetch(baseUrl+path,{
    method:"POST",
    headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},
    body:JSON.stringify(body||{})
  });
  return {response,body:await response.json()};
}

test("push privacy helpers fingerprint credentials, mask email and strip unsafe push data",()=>{
  const endpoint="https://push.example.test/private/credential";
  assert.match(credentialFingerprint(endpoint),/^[a-f0-9]{16}$/);
  assert.equal(credentialFingerprint(endpoint),credentialFingerprint(endpoint));
  assert.equal(maskEmail("mohammad@example.com"),"m***@example.com");

  assert.deepEqual(
    safePushData({
      screen:"tickets",
      notificationId:"507f1f77bcf86cd799439011",
      ticketToken:"bearer-ticket-secret",
      authToken:"jwt-secret",
      email:"customer@example.test",
      url:"https://attacker.test/"
    }),
    {screen:"tickets",notificationId:"507f1f77bcf86cd799439011"}
  );

  const envelope=minimizedPushEnvelope({
    data:{screen:"tickets",ticketToken:"bearer-ticket-secret",authToken:"jwt-secret"},
    notificationId:"507f1f77bcf86cd799439011"
  });
  const serialized=JSON.stringify(envelope);
  assert.equal(envelope.title,"Aqaba SeaGo");
  assert.match(envelope.body,/Open the app to view details/);
  assert.doesNotMatch(serialized,/bearer-ticket-secret|jwt-secret/);
});

test("web push permanent 410 is classified invalid and is not retried",async()=>{
  let calls=0;
  const result=await deliverWebPush(SUBSCRIPTION,{title:"Update",body:"Open app",data:{screen:"notifications"}}, {
    retryDelayMs:0,
    send:async()=>{calls++;const error=new Error("private provider body");error.statusCode=410;throw error;}
  });
  assert.deepEqual(result,{ok:false,attempts:1,code:"push_subscription_invalid",statusCode:410});
  assert.equal(calls,1);
});

test("web push permanent 404 is classified invalid and is not retried",async()=>{
  let calls=0;
  const result=await deliverWebPush(SUBSCRIPTION,{title:"Update",body:"Open app"}, {
    retryDelayMs:0,
    send:async()=>{calls++;const error=new Error("gone");error.statusCode=404;throw error;}
  });
  assert.equal(result.code,"push_subscription_invalid");
  assert.equal(result.attempts,1);
  assert.equal(calls,1);
});

test("web push transient 500 and network failures are bounded and do not become permanent",async()=>{
  let calls500=0;
  const serverFailure=await deliverWebPush(SUBSCRIPTION,{title:"Update",body:"Open app"}, {
    retryDelayMs:0,
    send:async()=>{calls500++;const error=new Error("provider outage with secret");error.statusCode=500;throw error;}
  });
  assert.equal(serverFailure.code,"push_delivery_transient");
  assert.equal(serverFailure.attempts,2);
  assert.equal(calls500,2);

  let callsNetwork=0;
  const networkFailure=await deliverWebPush(SUBSCRIPTION,{title:"Update",body:"Open app"}, {
    retryDelayMs:0,
    send:async()=>{callsNetwork++;throw new Error("timeout private endpoint");}
  });
  assert.equal(networkFailure.code,"push_delivery_transient");
  assert.equal(networkFailure.attempts,2);
  assert.equal(callsNetwork,2);
});

test("web push delivery strips ticket/auth secrets from provider payload",async()=>{
  let delivered;
  const result=await deliverWebPush(SUBSCRIPTION,{
    title:"Aqaba SeaGo",
    body:"Generic update",
    data:{screen:"tickets",notificationId:"abc_123",ticketToken:"ticket-secret",authToken:"auth-secret",url:"https://attacker.test"}
  },{
    retryDelayMs:0,
    send:async(_subscription,payload)=>{delivered=JSON.parse(payload);}
  });
  assert.equal(result.ok,true);
  assert.deepEqual(delivered.data,{screen:"tickets",notificationId:"abc_123"});
  assert.doesNotMatch(JSON.stringify(delivered),/ticket-secret|auth-secret|attacker/);
});

test("customer notification DTO is an explicit safe whitelist",()=>{
  const dto=notificationRouteInternals.toCustomerNotificationDto({
    _id:"507f1f77bcf86cd799439011",
    userId:A,
    type:"booking_confirmed",
    title:"Booking confirmed",
    body:"Open the app",
    bookingId:"507f191e810c19729de860ea",
    data:{providerMessageId:"provider-secret",deviceToken:"native-token"},
    readAt:null,
    createdAt:new Date("2026-10-11T00:00:00Z"),
    __v:9
  });
  assert.deepEqual(Object.keys(dto).sort(),["_id","body","createdAt","readAt","title","type"].sort());
  assert.equal(JSON.stringify(dto).includes("provider-secret"),false);
  assert.equal(JSON.stringify(dto).includes("native-token"),false);
  assert.equal("__v" in dto,false);
  assert.equal("userId" in dto,false);
  assert.equal("bookingId" in dto,false);
});

test("authenticated web subscription lifecycle is deduplicated, owner-scoped and cross-account safe",async()=>{
  const originalSecret=process.env.JWT_SECRET;
  const originalFindById=User.findById;
  const originalFindOneAndUpdate=PushSubscription.findOneAndUpdate;
  const originalDeleteOne=PushSubscription.deleteOne;
  const originalNativeDeleteMany=NativePushToken.deleteMany;
  const originalNativeFindOneAndUpdate=NativePushToken.findOneAndUpdate;
  const webRows=new Map();
  const users=new Map([
    [A,{_id:A,role:"customer",isActive:true,authVersion:0}],
    [B,{_id:B,role:"customer",isActive:true,authVersion:0}]
  ]);

  process.env.JWT_SECRET="notification-hardening-test-secret-32chars";
  User.findById=id=>({select:async()=>users.get(String(id))||null});
  PushSubscription.findOneAndUpdate=async(filter,update)=>{
    const row={...(webRows.get(filter.endpoint)||{}),...update.$set};
    webRows.set(filter.endpoint,row);
    return row;
  };
  PushSubscription.deleteOne=async filter=>{
    const row=webRows.get(filter.endpoint);
    if(row&&String(row.userId)===String(filter.userId)){webRows.delete(filter.endpoint);return {deletedCount:1};}
    return {deletedCount:0};
  };
  NativePushToken.deleteMany=async()=>({deletedCount:0});
  NativePushToken.findOneAndUpdate=async()=>({});

  let server;
  try{
    const started=await startPushApp();
    server=started.server;
    const tokenA=authToken(A),tokenB=authToken(B);

    const unauth=await jsonRequest(started.baseUrl,"/api/push/subscribe",{body:{subscription:SUBSCRIPTION}});
    assert.equal(unauth.response.status,401);

    const first=await jsonRequest(started.baseUrl,"/api/push/subscribe",{token:tokenA,body:{subscription:SUBSCRIPTION}});
    const repeated=await jsonRequest(started.baseUrl,"/api/push/subscribe",{token:tokenA,body:{subscription:SUBSCRIPTION}});
    assert.equal(first.response.status,200);
    assert.deepEqual(first.body,{ok:true});
    assert.equal(repeated.response.status,200);
    assert.equal(webRows.size,1);
    assert.equal(String(webRows.get(ENDPOINT).userId),A);

    const switched=await jsonRequest(started.baseUrl,"/api/push/subscribe",{token:tokenB,body:{subscription:SUBSCRIPTION}});
    assert.equal(switched.response.status,200);
    assert.equal(webRows.size,1);
    assert.equal(String(webRows.get(ENDPOINT).userId),B);

    const wrongOwnerRevoke=await jsonRequest(started.baseUrl,"/api/push/unsubscribe",{token:tokenA,body:{endpoint:ENDPOINT}});
    assert.equal(wrongOwnerRevoke.response.status,200);
    assert.equal(String(webRows.get(ENDPOINT).userId),B);

    const revoke=await jsonRequest(started.baseUrl,"/api/push/unsubscribe",{token:tokenB,body:{endpoint:ENDPOINT}});
    const repeatedRevoke=await jsonRequest(started.baseUrl,"/api/push/unsubscribe",{token:tokenB,body:{endpoint:ENDPOINT}});
    assert.equal(revoke.response.status,200);
    assert.equal(repeatedRevoke.response.status,200);
    assert.equal(webRows.size,0);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    User.findById=originalFindById;
    PushSubscription.findOneAndUpdate=originalFindOneAndUpdate;
    PushSubscription.deleteOne=originalDeleteOne;
    NativePushToken.deleteMany=originalNativeDeleteMany;
    NativePushToken.findOneAndUpdate=originalNativeFindOneAndUpdate;
    if(originalSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=originalSecret;
  }
});

test("native push registration contract uses authenticated installation binding without exposing token in response",async()=>{
  const routeSource=source("../src/routes/push.js");
  const nativeSource=source("../customer-app/src/nativePush.js");
  assert.match(routeSource,/router\.post\("\/native-subscribe",requireAuth/);
  assert.match(routeSource,/installationId/);
  assert.match(routeSource,/deleteMany\(\{appId:APP_ID,installationId,token:\{\$ne:token\}\}\)/);
  assert.match(routeSource,/res\.json\(\{ok:true\}\)/);
  assert.match(nativeSource,/registration.*registerToken/s);
  assert.match(nativeSource,/disableNativePush\(authToken\)/);
  assert.doesNotMatch(nativeSource,/localStorage\.setItem\([^,]+,token/);
});

test("logout and login reconciliation are fail-safe and do not block auth",()=>{
  const apiSource=source("../customer-app/src/api.js");
  const lifecycleSource=source("../customer-app/src/notificationCredentialLifecycle.js");
  assert.match(apiSource,/\/api\/push\/unsubscribe/);
  assert.match(apiSource,/subscription\.unsubscribe\(\)/);
  assert.match(apiSource,/reconcileExistingPushSubscription/);
  assert.match(apiSource,/void reconcileExistingPushSubscription\(result\.token\)\.catch\(\(\)=>\{\}\)/);
  assert.match(lifecycleSource,/\.profile-signout/);
  assert.match(lifecycleSource,/Promise\.allSettled/);
});

test("service workers fail closed on malformed payloads and never navigate to arbitrary payload URLs",()=>{
  for(const path of ["../customer-app/public/sw.js","../provider-app/public/sw.js"]){
    const sw=source(path);
    assert.match(sw,/catch\{payload=\{\};\}/);
    assert.doesNotMatch(sw,/event\.data\?\.text/);
    assert.doesNotMatch(sw,/payload.*url|data.*url|openWindow\([^)]*payload/i);
    assert.match(sw,/new URL\("\.\/\?open=notifications",self\.registration\.scope\)/);
  }
});

test("notification delivery logging schema and code do not persist or print raw recipient/error credentials",()=>{
  const logModel=source("../src/models/NotificationLog.js");
  const notifications=source("../src/services/notifications.js");
  const push=source("../src/services/push.js");
  assert.doesNotMatch(logModel,/\n\s*recipient:\s*\{/);
  assert.doesNotMatch(logModel,/\n\s*error:\s*String/);
  assert.match(logModel,/recipientFingerprint/);
  assert.match(logModel,/errorCode/);
  assert.doesNotMatch(notifications,/console\.(?:log|error|warn)\([^\n]*\bto\b/);
  assert.doesNotMatch(notifications,/recipient:to/);
  assert.doesNotMatch(notifications,/error:String\(e/);
  assert.doesNotMatch(push,/console\.(?:log|error|warn)\([^\n]*row\.endpoint/);
  assert.doesNotMatch(push,/console\.(?:log|error|warn)\([^\n]*e\?\.message/);
});
