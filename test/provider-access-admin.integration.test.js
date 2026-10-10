import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {createApp} from '../src/app.js';
import User from '../src/models/User.js';
import Provider from '../src/models/Provider.js';

const uri=process.env.SEAGO_TEST_MONGODB_URI;
const SECRET='provider-access-test-secret-at-least-32-characters';
const PASSWORD='TemporaryPass123!';
const REASON='Credential rotation test';

function tokenFor(user,ver=Number(user.authVersion||0)){
  return jwt.sign({sub:String(user._id),ver},SECRET,{expiresIn:'1h'});
}

async function requestJson(base,path,{token,method='GET',body}={}){
  const response=await fetch(base+path,{
    method,
    headers:{...(token?{authorization:`Bearer ${token}`}:{ }),'content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const json=await response.json().catch(()=>({}));
  return {response,json};
}

function iso(value){return value?new Date(value).toISOString():null;}

async function rawProvider(id){return Provider.collection.findOne({_id:new mongoose.Types.ObjectId(String(id))});}

test('admin provider access is lifecycle-neutral, ID-targeted and session-safe',{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,'Only a local disposable replica set is allowed');
  const oldSecret=process.env.JWT_SECRET;
  process.env.JWT_SECRET=SECRET;

  await mongoose.connect(uri,{dbName:'seago_provider_access_'+crypto.randomUUID().replaceAll('-','')});
  t.after(async()=>{
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
  });

  await Promise.all([User,Provider].map(m=>m.init()));

  const admin=await User.create({name:'Admin',email:'admin@example.test',role:'admin'});
  const lifecycleAdmin=await User.create({name:'Lifecycle Admin',email:'lifecycle@example.test',role:'admin'});
  const customer=await User.create({name:'Customer',email:'customer@example.test',role:'customer'});
  const providerCaller=await User.create({name:'Provider Caller',email:'caller@example.test',role:'provider'});
  const adminToken=tokenFor(admin);

  const app=createApp();
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const base=`http://127.0.0.1:${port}`;

  const unauthorizedOwner=await User.create({name:'Unauthorized Target',email:'unauthorized-target@example.test',role:'provider'});
  const unauthorizedProvider=await Provider.create({ownerUserId:unauthorizedOwner._id,businessName:'Unauthorized Target',status:'pending'});
  const unauthorizedPath=`/api/admin/providers/${unauthorizedProvider._id}/access`;
  const accessPayload={email:'should-not-change@example.test',name:'Unauthorized Target',temporaryPassword:PASSWORD};
  const customerAttempt=await requestJson(base,unauthorizedPath,{token:tokenFor(customer),method:'PATCH',body:accessPayload});
  assert.equal(customerAttempt.response.status,403,'Customer must not call admin provider access');
  const providerAttempt=await requestJson(base,unauthorizedPath,{token:tokenFor(providerCaller),method:'PATCH',body:accessPayload});
  assert.equal(providerAttempt.response.status,403,'Provider must not call admin provider access');
  const afterUnauthorized=await User.findById(unauthorizedOwner._id);
  assert.equal(afterUnauthorized.email,'unauthorized-target@example.test');
  assert.equal((await Provider.findById(unauthorizedProvider._id)).status,'pending');

  const cases=[];
  for(const status of ['pending','approved','rejected','suspended']){
    const owner=await User.create({
      name:`${status} owner`,
      email:`${status}-old@example.test`,
      role:'provider',
      authVersion:2,
      passwordHash:await bcrypt.hash('LegacyPassword123!',12)
    });
    const approvedAt=status==='approved'?new Date('2026-01-02T03:04:05.000Z'):undefined;
    const provider=await Provider.create({
      ownerUserId:owner._id,
      businessName:`Lifecycle ${status}`,
      status,
      ...(approvedAt?{approvedAt,approvedBy:lifecycleAdmin._id}:{})
    });
    if(status==='rejected'){
      await Provider.collection.updateOne({_id:provider._id},{$set:{rejectedAt:new Date('2026-02-03T04:05:06.000Z'),rejectionReason:'test rejection marker'}});
    }
    if(status==='suspended'){
      await Provider.collection.updateOne({_id:provider._id},{$set:{suspendedAt:new Date('2026-03-04T05:06:07.000Z'),suspensionReason:'test suspension marker'}});
    }
    cases.push({status,owner,provider,approvedAt});
  }

  for(const item of cases){
    const before=await rawProvider(item.provider._id);
    const oldOwnerToken=tokenFor(item.owner,2);
    const newEmail=`${item.status}-new@example.test`;
    const path=`/api/admin/providers/${item.provider._id}/access`;
    const {response,json}=await requestJson(base,path,{
      token:adminToken,
      method:'PATCH',
      body:{email:newEmail,name:`${item.status} access owner`,temporaryPassword:PASSWORD,reason:REASON}
    });
    assert.equal(response.status,200,`${item.status}: access update should succeed`);
    assert.equal(String(json.provider.id),String(item.provider._id),`${item.status}: response must identify requested provider ID`);
    assert.equal(json.provider.status,item.status,`${item.status}: response lifecycle must be unchanged`);

    const owner=await User.findById(item.owner._id);
    const provider=await Provider.findById(item.provider._id);
    const after=await rawProvider(item.provider._id);
    assert.equal(owner.email,newEmail,`${item.status}: owner email should update`);
    assert.equal(owner.authVersion,3,`${item.status}: authVersion should increment exactly once`);
    assert.equal(await bcrypt.compare(PASSWORD,owner.passwordHash),true,`${item.status}: password should update`);
    assert.equal(String(provider.ownerUserId),String(item.owner._id),`${item.status}: owner link should stay on the same user`);
    assert.equal(provider.status,item.status,`${item.status}: provider lifecycle must be invariant`);
    assert.equal(iso(after.approvedAt),iso(before.approvedAt),`${item.status}: approvedAt must be untouched`);
    assert.equal(String(after.approvedBy||''),String(before.approvedBy||''),`${item.status}: approvedBy must be untouched`);
    assert.equal(iso(after.rejectedAt),iso(before.rejectedAt),`${item.status}: rejection timestamp must be untouched`);
    assert.equal(after.rejectionReason,before.rejectionReason,`${item.status}: rejection state must be untouched`);
    assert.equal(iso(after.suspendedAt),iso(before.suspendedAt),`${item.status}: suspension timestamp must be untouched`);
    assert.equal(after.suspensionReason,before.suspensionReason,`${item.status}: suspension state must be untouched`);

    if(item.status==='approved'){
      const expired=await requestJson(base,'/api/providers/me',{token:oldOwnerToken});
      assert.equal(expired.response.status,401,'Existing provider session must be invalidated after credential change');
    }
  }

  const duplicateOwnerA=await User.create({name:'Duplicate A',email:'duplicate-a@example.test',role:'provider',authVersion:0,passwordHash:await bcrypt.hash('LegacyPassword123!',12)});
  const duplicateOwnerB=await User.create({name:'Duplicate B',email:'duplicate-b@example.test',role:'provider',authVersion:0,passwordHash:await bcrypt.hash('LegacyPassword123!',12)});
  const duplicateA=await Provider.create({ownerUserId:duplicateOwnerA._id,businessName:'Same Business Name',status:'pending'});
  const duplicateB=await Provider.create({ownerUserId:duplicateOwnerB._id,businessName:'Same Business Name',status:'suspended'});
  const duplicateBBefore=await rawProvider(duplicateB._id);
  const targetResult=await requestJson(base,`/api/admin/providers/${duplicateA._id}/access`,{
    token:adminToken,
    method:'PATCH',
    body:{email:'duplicate-a-new@example.test',name:'Duplicate A Updated',temporaryPassword:PASSWORD,reason:REASON}
  });
  assert.equal(targetResult.response.status,200);
  assert.equal(String(targetResult.json.provider.id),String(duplicateA._id));
  assert.equal((await User.findById(duplicateOwnerA._id)).email,'duplicate-a-new@example.test');
  assert.equal((await User.findById(duplicateOwnerB._id)).email,'duplicate-b@example.test','Same businessName must not redirect the action to another provider');
  const duplicateBAfter=await rawProvider(duplicateB._id);
  assert.equal(duplicateBAfter.status,duplicateBBefore.status);
  assert.equal(String(duplicateBAfter.ownerUserId),String(duplicateBBefore.ownerUserId));
  assert.equal(iso(duplicateBAfter.updatedAt),iso(duplicateBBefore.updatedAt),'Non-target duplicate-name provider must not be saved');

  const conflictOwner=await User.create({name:'Conflict Owner',email:'conflict-owner@example.test',role:'provider',authVersion:4,passwordHash:await bcrypt.hash('LegacyPassword123!',12)});
  const conflictProvider=await Provider.create({ownerUserId:conflictOwner._id,businessName:'Conflict Provider',status:'rejected'});
  const reserved=await User.create({name:'Reserved',email:'reserved@aqabaseago.com',role:'provider'});
  assert.ok(reserved._id);
  const conflictBefore=await rawProvider(conflictProvider._id);
  const conflict=await requestJson(base,`/api/admin/providers/${conflictProvider._id}/access`,{
    token:adminToken,
    method:'PATCH',
    body:{email:'reserved@aqabaseago.com',name:'Conflict Provider',temporaryPassword:'AnotherPass123!',reason:REASON}
  });
  assert.equal(conflict.response.status,409);
  const conflictOwnerAfter=await User.findById(conflictOwner._id);
  const conflictAfter=await rawProvider(conflictProvider._id);
  assert.equal(conflictOwnerAfter.email,'conflict-owner@example.test');
  assert.equal(conflictOwnerAfter.authVersion,4);
  assert.equal(conflictAfter.status,conflictBefore.status);
  assert.equal(String(conflictAfter.ownerUserId),String(conflictBefore.ownerUserId));
});
