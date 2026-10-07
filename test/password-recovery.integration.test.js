import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {createApp} from '../src/app.js';
import User from '../src/models/User.js';
import PasswordResetToken from '../src/models/PasswordResetToken.js';
import {passwordRecoveryInternals} from '../src/services/passwordRecovery.js';

const uri=process.env.SEAGO_TEST_MONGODB_URI;

async function post(base,path,body){
  const response=await fetch(`${base}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  return {response,body:await response.json()};
}

test('password recovery is enumeration-safe, one-time, expires, and invalidates old JWTs',{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,'Only a local disposable replica set is allowed');
  const oldSecret=process.env.JWT_SECRET;
  const oldExpiry=process.env.JWT_EXPIRES_IN;
  const oldResend=process.env.RESEND_API_KEY;
  process.env.JWT_SECRET='password-recovery-test-secret-at-least-32-chars';
  process.env.JWT_EXPIRES_IN='1h';
  delete process.env.RESEND_API_KEY;

  await mongoose.connect(uri,{dbName:'seago_password_reset_'+crypto.randomUUID().replaceAll('-','')});
  t.after(async()=>{
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
    if(oldExpiry===undefined)delete process.env.JWT_EXPIRES_IN;else process.env.JWT_EXPIRES_IN=oldExpiry;
    if(oldResend===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldResend;
  });

  await Promise.all([User,PasswordResetToken].map(m=>m.init()));
  const passwordHash=await bcrypt.hash('OldPassword123!',12);
  const user=await User.create({name:'Reset User',email:'reset@example.test',role:'customer',passwordHash,isActive:true});
  const oldJwt=jwt.sign({sub:String(user._id),role:'customer',ver:0},process.env.JWT_SECRET,{expiresIn:'1h'});

  const app=createApp();
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;

  const known=await post(base,'/api/auth/password-reset/request',{email:'reset@example.test'});
  const unknown=await post(base,'/api/auth/password-reset/request',{email:'nobody@example.test'});
  assert.equal(known.response.status,202);
  assert.equal(unknown.response.status,202);
  assert.deepEqual(known.body,unknown.body);

  const stored=await PasswordResetToken.findOne({userId:user._id}).lean();
  assert.ok(stored);
  assert.match(stored.tokenHash,/^[a-f0-9]{64}$/);
  assert.equal('token' in stored,false);

  const expiredRaw=crypto.randomBytes(32).toString('base64url');
  await PasswordResetToken.create({userId:user._id,tokenHash:passwordRecoveryInternals.hashToken(expiredRaw),expiresAt:new Date(Date.now()-1000)});
  const expired=await post(base,'/api/auth/password-reset/confirm',{token:expiredRaw,password:'NewPassword456!'});
  assert.equal(expired.response.status,400);

  const raw=crypto.randomBytes(32).toString('base64url');
  await PasswordResetToken.create({userId:user._id,tokenHash:passwordRecoveryInternals.hashToken(raw),expiresAt:new Date(Date.now()+30*60_000)});
  const reset=await post(base,'/api/auth/password-reset/confirm',{token:raw,password:'NewPassword456!'});
  assert.equal(reset.response.status,200);
  assert.equal(reset.body.ok,true);

  const replay=await post(base,'/api/auth/password-reset/confirm',{token:raw,password:'AnotherPassword789!'});
  assert.equal(replay.response.status,400);

  const oldSession=await fetch(`${base}/api/notifications`,{headers:{authorization:`Bearer ${oldJwt}`}});
  assert.equal(oldSession.status,401);

  const oldLogin=await post(base,'/api/auth/login',{email:'reset@example.test',password:'OldPassword123!'});
  assert.equal(oldLogin.response.status,401);
  const newLogin=await post(base,'/api/auth/login',{email:'reset@example.test',password:'NewPassword456!'});
  assert.equal(newLogin.response.status,200);
  const claims=jwt.verify(newLogin.body.token,process.env.JWT_SECRET);
  assert.equal(claims.ver,1);
});
