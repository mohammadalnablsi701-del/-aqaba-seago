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

test('admin provider access updates an existing owner login in place',{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,'Only a local disposable replica set is allowed');
  const oldSecret=process.env.JWT_SECRET;
  process.env.JWT_SECRET='provider-access-test-secret-at-least-32-characters';

  await mongoose.connect(uri,{dbName:'seago_provider_access_'+crypto.randomUUID().replaceAll('-','')});
  t.after(async()=>{
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
  });

  await Promise.all([User,Provider].map(m=>m.init()));

  const admin=await User.create({name:'Admin',email:'admin@example.test',role:'admin'});
  const owner=await User.create({
    name:'Legacy Provider',
    email:'legacy@example.test',
    role:'provider',
    authVersion:2,
    passwordHash:await bcrypt.hash('LegacyPassword123!',12)
  });
  const provider=await Provider.create({ownerUserId:owner._id,businessName:'Pilot Provider',status:'approved',approvedAt:new Date()});

  const token=jwt.sign({sub:String(admin._id)},process.env.JWT_SECRET,{expiresIn:'1h'});
  const app=createApp();
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const url=`http://127.0.0.1:${port}/api/admin/providers/${provider._id}/access`;

  const newEmail='pilot@aqabaseago.com';
  const newPassword='TemporaryPass123!';
  const response=await fetch(url,{
    method:'PATCH',
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    body:JSON.stringify({email:newEmail,name:'Pilot Provider',temporaryPassword:newPassword})
  });
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(String(body.user.id),String(owner._id));
  assert.equal(body.user.email,newEmail);

  const updatedOwner=await User.findById(owner._id);
  const updatedProvider=await Provider.findById(provider._id);
  assert.equal(updatedOwner.email,newEmail);
  assert.equal(updatedOwner.authVersion,3);
  assert.equal(await bcrypt.compare(newPassword,updatedOwner.passwordHash),true);
  assert.equal(String(updatedProvider.ownerUserId),String(owner._id));
  assert.equal(await User.countDocuments({role:'provider'}),1);
  assert.equal(await User.countDocuments({email:'legacy@example.test'}),0);

  await User.create({name:'Reserved',email:'reserved@aqabaseago.com',role:'provider'});
  const conflict=await fetch(url,{
    method:'PATCH',
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    body:JSON.stringify({email:'reserved@aqabaseago.com',name:'Pilot Provider',temporaryPassword:'AnotherPass123!'})
  });
  assert.equal(conflict.status,409);
  const afterConflictOwner=await User.findById(owner._id);
  const afterConflictProvider=await Provider.findById(provider._id);
  assert.equal(afterConflictOwner.email,newEmail);
  assert.equal(String(afterConflictProvider.ownerUserId),String(owner._id));
});
