import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import express from 'express';
import mongoose from 'mongoose';
import {createProductionDiagnosticsRouter,collectProductionDiagnostics,diagnosticReleaseReadOnlyStartup} from '../src/routes/productionDiagnostics.js';
const id=n=>new mongoose.Types.ObjectId(n.toString(16).padStart(24,'0'));
const token='a'.repeat(64);
const env=()=>({PRODUCTION_DIAGNOSTIC_ENABLED:'true',PRODUCTION_DIAGNOSTIC_TOKEN:token,PRODUCTION_DIAGNOSTIC_EXPIRES_AT:new Date(Date.now()+600000).toISOString()});
function matches(row,filter){return Object.entries(filter).every(([key,value])=>{
  if(key==='$or')return value.some(f=>matches(row,f));
  if(value instanceof RegExp)return value.test(String(row[key]||''));
  if(value?.$type==='date')return row[key] instanceof Date;
  return String(row[key])===String(value);
});}
function database(){
  const secret={passwordHash:'HASH_CANARY',googleSub:'GOOGLE_CANARY',resetToken:'RESET_CANARY',secret:'SECRET_CANARY'};
  const data={users:[{_id:id(1),name:'Admin',email:'admin@example.test',role:'admin',isActive:true,authVersion:2,...secret},
    {_id:id(2),name:'Sea Breeze',email:'seabreeze@aqabaseago.com',role:'provider',isActive:true,authVersion:3,...secret}],
    providers:[{_id:id(3),businessName:'Sea Breeze / Aquamarina',ownerUserId:id(2),settings:{defaultCapacity:10,secret:'NESTED_SECRET'},...secret}],
    trips:[{_id:id(4),providerId:id(3),active:true,titleEn:'Sunset Cruise',pricing:{adultPrice:15,commissionValue:20,secret:'PRICING_SECRET'},...secret},
      {_id:id(5),providerId:id(3),active:false,titleEn:'Old test',...secret}],
    departures:[{_id:id(6),tripId:id(4),capacity:10,startsAt:new Date(),status:'scheduled',...secret}],
    bookings:[{_id:id(7),tripId:id(4),status:'confirmed',customerSnapshot:{name:'CUSTOMER_PII',phone:'CUSTOMER_PHONE'},customerId:id(8)}]};
  const calls=[];
  const db={collection(name){assert.ok(['users','providers','trips','departures','bookings'].includes(name));return new Proxy({
    find(filter,options){calls.push({name,method:'find',filter,options});assert.notEqual(name,'bookings');assert.ok(options.projection);return {limit(){return this;},async toArray(){return structuredCloneBson(data[name].filter(x=>matches(x,filter)));}};},
    async countDocuments(filter){calls.push({name,method:'countDocuments'});assert.equal(name,'bookings');return data[name].filter(x=>matches(x,filter)).length;}
  },{get(target,key){assert.ok(key in target,'Unexpected database operation: '+String(key));return target[key];}});}};
  return {db,data,calls};
}
function structuredCloneBson(value){return value.map(x=>({...x}));}
async function start(t,config={}){const app=express();app.use('/internal/diagnostics',createProductionDiagnosticsRouter(config));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));return async(auth,method='GET')=>fetch(`http://127.0.0.1:${server.address().port}/internal/diagnostics/sea-breeze`,{method,headers:auth?{Authorization:auth}:{}});}

test('disabled by default, missing/wrong/expired/weak tokens never access DB',async t=>{
 for(const [config,auth] of [[{},'Bearer '+token],[env(),undefined],[env(),'Bearer wrong'],[{...env(),PRODUCTION_DIAGNOSTIC_EXPIRES_AT:new Date(0).toISOString()},'Bearer '+token],[{...env(),PRODUCTION_DIAGNOSTIC_TOKEN:'short'},'Bearer short']]){
  const request=await start(t,{env:config,getDb:()=>{throw Error('DB must not be accessed');}});
  const response=await request(auth);assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:'Not found'});
 }
});
test('only safe fields, all inactive trips, counts only, no mutations',async()=>{
 const {db,data,calls}=database();const before=JSON.stringify(data);const result=await collectProductionDiagnostics(db);const json=JSON.stringify(result);
 for(const forbidden of ['passwordHash','HASH_CANARY','googleSub','GOOGLE_CANARY','RESET_CANARY','SECRET_CANARY','NESTED_SECRET','PRICING_SECRET','CUSTOMER_PII','CUSTOMER_PHONE','customerId','customerSnapshot'])assert.ok(!json.includes(forbidden),forbidden);
 assert.equal(JSON.stringify(data),before);assert.ok(calls.every(x=>['find','countDocuments'].includes(x.method)));
 assert.equal(result.admins[0].authVersion,2);assert.equal(result.providerCount,1);assert.equal(result.approvedEmailUserCount,1);
 assert.equal(result.providers[0].trips.length,2);assert.equal(result.providers[0].trips[1].trip.active,false);
 assert.equal(result.providers[0].trips[0].bookingsCount,1);assert.equal(result.providers[0].trips[0].ticketsCount,null);
 assert.equal(result.providers[0].trips[0].ticketEligibleBookingsCount,1);
});
test('successful authenticated GET is no-store and one-shot, HEAD cannot consume it',async t=>{
 const {db}=database();const request=await start(t,{env:env(),getDb:()=>db});
 assert.equal((await request('Bearer '+token,'HEAD')).status,404);
 const res=await request('Bearer '+token);assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');assert.equal((await res.json()).readOnly,true);
 assert.equal((await request('Bearer '+token)).status,404);
});
test('global rate limit bounds rejected attempts and does not read DB',async t=>{
 const request=await start(t,{env:env(),getDb:()=>{throw Error('must not read');}});
 for(let i=0;i<5;i++)assert.equal((await request('wrong')).status,404);
 assert.equal((await request('Bearer '+token)).status,404);
});
test('database failure returns generic error and consumes access',async t=>{
 const request=await start(t,{env:env(),getDb:()=>{throw Error('SECRET_CANARY');}});
 const res=await request('Bearer '+token);assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'Diagnostic unavailable'});
 assert.equal((await request('Bearer '+token)).status,404);
});
test('temporary release skips startup writers and route has no mutation/service calls',async()=>{
 assert.equal(diagnosticReleaseReadOnlyStartup,true);
 const source=await readFile(new URL('../src/routes/productionDiagnostics.js',import.meta.url),'utf8');
 assert.doesNotMatch(source.split('export function createProductionDiagnosticsRouter')[0],/\.(save|create|insert\w*|update\w*|findOneAndUpdate|delete\w*|bulkWrite|drop\w*)\s*\(/);
 assert.doesNotMatch(source,/from\s+['"].*services\//);assert.doesNotMatch(source,/console\./);
 const server=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
 const guarded=server.split('if (diagnosticReleaseReadOnlyStartup) {')[1].split('} else {')[0];
 assert.match(guarded,/autoIndex:false,autoCreate:false/);assert.doesNotMatch(guarded,/connectDb|applyRealPilotData|applyCommission20Migration|releaseExpired|setInterval/);
});
