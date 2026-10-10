import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {createApp} from '../src/app.js';
import User from '../src/models/User.js';
import Payment from '../src/models/Payment.js';
import NotificationLog from '../src/models/NotificationLog.js';
import SupportRequest from '../src/models/SupportRequest.js';

const uri=process.env.SEAGO_TEST_MONGODB_URI;

test('admin operations queue is protected and surfaces only safe actionable failures',{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\/\/(127\.0\.0\.1|localhost):/,'Only a local disposable replica set is allowed');
  const oldSecret=process.env.JWT_SECRET;
  process.env.JWT_SECRET='admin-operations-test-secret-at-least-32-characters';

  await mongoose.connect(uri,{dbName:'seago_admin_ops_'+crypto.randomUUID().replaceAll('-','')});
  t.after(async()=>{
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
  });

  await Promise.all([User,Payment,NotificationLog,SupportRequest].map(m=>m.init()));

  const admin=await User.create({name:'Admin',phone:'+962790009001',role:'admin'});
  const customer=await User.create({name:'Customer',phone:'+962790009002',role:'customer'});
  const provider=await User.create({name:'Provider',phone:'+962790009003',role:'provider'});
  const rawSecret='raw-webhook-secret-must-not-leak';
  const checkoutSecret='https://gateway.example.test/pay?token=checkout-secret-must-not-leak';
  const notificationRecipient='private-recipient@example.test';
  const notificationExternalId='provider-message-secret-id';
  const supportMessage='support-message-body-must-not-appear-in-attention-preview';
  await Payment.create({
    holdId:new mongoose.Types.ObjectId(),customerId:customer._id,provider:'mock',status:'needs_review',amount:42,currency:'JOD',
    checkoutUrl:checkoutSecret,rawLastEvent:{authorization:rawSecret}
  });
  await NotificationLog.create({
    key:'ops-test-failure',type:'booking_confirmation',recipient:notificationRecipient,status:'failed',externalId:notificationExternalId,error:'x'.repeat(400)
  });
  await SupportRequest.create({customerId:customer._id,subject:'Need help',message:supportMessage,status:'open',bookingReference:'SG-TEST1234'});

  const tokenFor=user=>jwt.sign({sub:String(user._id)},process.env.JWT_SECRET,{expiresIn:'1h'});
  const app=createApp();
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const url=`http://127.0.0.1:${port}/api/admin/operations`;

  const unauthenticated=await fetch(url);
  assert.equal(unauthenticated.status,401);

  const customerDenied=await fetch(url,{headers:{authorization:`Bearer ${tokenFor(customer)}`}});
  assert.equal(customerDenied.status,403);

  const providerDenied=await fetch(url,{headers:{authorization:`Bearer ${tokenFor(provider)}`}});
  assert.equal(providerDenied.status,403);

  const response=await fetch(url,{headers:{authorization:`Bearer ${tokenFor(admin)}`}});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.healthy,false);
  assert.equal(body.alerts.paymentNeedsReview,1);
  assert.equal(body.alerts.notificationFailures24h,1);
  assert.equal(body.alerts.openSupport,1);
  assert.equal(body.queues.paymentNeedsReview.length,1);
  assert.equal(body.queues.paymentNeedsReview[0].status,'needs_review');
  assert.equal(body.queues.notificationFailures.length,1);
  assert.ok(body.queues.notificationFailures[0].error.length<=240);
  assert.equal(body.queues.openSupport.length,1);
  assert.equal(body.queues.openSupport[0].subject,'Need help');
  assert.equal(body.queues.openSupport[0].status,'open');
  assert.equal(body.queues.openSupport[0].customerId.name,'Customer');
  assert.equal(body.queues.openSupport[0].message,undefined);
  assert.equal(body.queues.openSupport[0].customerId.email,undefined);

  const serialized=JSON.stringify(body);
  assert.doesNotMatch(serialized,new RegExp(rawSecret));
  assert.doesNotMatch(serialized,/checkout-secret-must-not-leak/);
  assert.doesNotMatch(serialized,new RegExp(notificationRecipient.replace('.','\\.')));
  assert.doesNotMatch(serialized,new RegExp(notificationExternalId));
  assert.doesNotMatch(serialized,new RegExp(supportMessage));
});
