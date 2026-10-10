import test from'node:test';
import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import{buildQueuePreview,getAttentionCategories,hasOperationalAttention}from'../admin-app/src/operationsAttentionModel.js';
import{createLatestRequestManager,isAbortError}from'../admin-app/src/requestLifecycle.js';

const component=readFileSync(new URL('../admin-app/src/OperationsAttention.jsx',import.meta.url),'utf8');
const app=readFileSync(new URL('../admin-app/src/App.jsx',import.meta.url),'utf8');
const api=readFileSync(new URL('../admin-app/src/api.js',import.meta.url),'utf8');
const route=readFileSync(new URL('../src/routes/operations.js',import.meta.url),'utf8');

const emptyOperations=()=>({
  alerts:{paymentNeedsReview:0,notificationFailures24h:0,openSupport:0},
  queues:{paymentNeedsReview:[],notificationFailures:[],openSupport:[]}
});

function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej});return{promise,resolve,reject}}
async function applyOperationsWhenCurrent(manager,request,promise,state){
  try{const value=await promise;if(manager.isCurrent(request.id)){state.data=value;state.error=''}}
  catch(error){if(manager.isCurrent(request.id)&&!isAbortError(error))state.error=error.message}
}

test('A zero issues renders the explicit All clear state',()=>{
  const data=emptyOperations();
  assert.equal(hasOperationalAttention(data),false);
  assert.deepEqual(getAttentionCategories(data).map(x=>x.count),[0,0,0]);
  assert.match(component,/>All clear</);
  assert.match(component,/No operational issues need attention\./);
});

test('B paymentNeedsReview is the highest-priority visible category',()=>{
  const data=emptyOperations();data.alerts.paymentNeedsReview=2;
  data.queues.paymentNeedsReview=[{_id:'66aa00000000000012345678',status:'needs_review',amount:42,currency:'JOD'}];
  const categories=getAttentionCategories(data);
  assert.deepEqual(categories.map(x=>x.id),['payment','notification','support']);
  assert.equal(categories[0].count,2);
  assert.equal(buildQueuePreview(data)[0].kind,'payment');
});

test('C notificationFailures24h is visible with a safe failure summary',()=>{
  const data=emptyOperations();data.alerts.notificationFailures24h=1;
  data.queues.notificationFailures=[{_id:'n1',type:'booking_confirmation',provider:'resend',error:'delivery failed',createdAt:'2026-10-10T10:00:00Z'}];
  const preview=buildQueuePreview(data);
  assert.equal(getAttentionCategories(data)[1].count,1);
  assert.equal(preview[0].kind,'notification');
  assert.ok(preview[0].details.includes('delivery failed'));
});

test('D openSupport is visible and links to the existing Support screen',()=>{
  const data=emptyOperations();data.alerts.openSupport=3;
  data.queues.openSupport=[{_id:'s1',subject:'Need help',status:'open',customerId:{name:'Customer'}}];
  const category=getAttentionCategories(data)[2];
  assert.equal(category.count,3);
  assert.equal(category.destination,'support');
  assert.equal(buildQueuePreview(data)[0].title,'Need help');
});

test('E multiple categories keep counts and Payment -> Notification -> Support order',()=>{
  const data=emptyOperations();
  data.alerts={paymentNeedsReview:2,notificationFailures24h:1,openSupport:4};
  data.queues.paymentNeedsReview=[{_id:'p1'}];
  data.queues.notificationFailures=[{_id:'n1',type:'email'}];
  data.queues.openSupport=[{_id:'s1',subject:'Support'}];
  assert.deepEqual(getAttentionCategories(data).map(x=>[x.id,x.count]),[['payment',2],['notification',1],['support',4]]);
  assert.deepEqual(buildQueuePreview(data).map(x=>x.kind),['payment','notification','support']);
});

test('F operations endpoint failure is isolated from the financial Overview',()=>{
  const attentionIndex=app.indexOf('<OperationsAttention');
  const filterIndex=app.indexOf('<section className="overview-filter-card"');
  assert.ok(attentionIndex>0&&filterIndex>attentionIndex,'attention section must appear before revenue filters');
  assert.match(component,/Revenue and booking data remain available/);
  assert.match(component,/role="alert"/);
  assert.doesNotMatch(component,/Promise\.all/);
});

test('G background refresh failure preserves last-known-good operations data',async()=>{
  const manager=createLatestRequestManager();
  const state={data:{alerts:{paymentNeedsReview:1}},error:''};
  const work=deferred();const request=manager.start();
  const run=applyOperationsWhenCurrent(manager,request,work.promise,state);
  work.reject(new Error('operations refresh failed'));await run;
  assert.equal(state.data.alerts.paymentNeedsReview,1);
  assert.equal(state.error,'operations refresh failed');
  assert.doesNotMatch(component,/setData\(null\)/);
});

test('H a stale operations request cannot overwrite a newer response',async()=>{
  const manager=createLatestRequestManager();const state={data:null,error:''};
  const first=deferred();const requestA=manager.start();const runA=applyOperationsWhenCurrent(manager,requestA,first.promise,state);
  const second=deferred();const requestB=manager.start();const runB=applyOperationsWhenCurrent(manager,requestB,second.promise,state);
  second.resolve({generatedAt:'new'});await runB;
  first.resolve({generatedAt:'old'});await runA;
  assert.equal(state.data.generatedAt,'new');
  assert.equal(requestA.signal.aborted,true);
  assert.match(component,/manager\.isCurrent\(request\.id\)/);
});

test('J failure and support text are rendered as React text, never injected HTML',()=>{
  const malicious='<img src=x onerror=alert(1)>';
  const data=emptyOperations();data.alerts.openSupport=1;data.queues.openSupport=[{_id:'s1',subject:malicious,status:'open'}];
  assert.equal(buildQueuePreview(data)[0].title,malicious);
  assert.doesNotMatch(component,/dangerouslySetInnerHTML/);
  assert.doesNotMatch(component,/innerHTML/);
});

test('K attention contract whitelists operational fields and excludes raw secret payload surfaces',()=>{
  assert.match(route,/select\("bookingId customerId provider externalPaymentId amount currency status createdAt updatedAt"\)/);
  assert.match(route,/select\("customerId bookingId bookingReference subject status createdAt updatedAt"\)/);
  assert.doesNotMatch(route,/select\([^\n]*rawLastEvent/);
  assert.doesNotMatch(route,/select\([^\n]*checkoutUrl/);
  assert.doesNotMatch(component,/rawLastEvent|checkoutUrl|webhook payload/i);
});

test('operations API forwards AbortSignal and component uses scoped retry/latest-only lifecycle',()=>{
  assert.match(api,/operations=\(token,options=\{\}\)=>req\("\/api\/admin\/operations",\{token,\.\.\.options\}\)/);
  assert.match(component,/operations\(token,\{signal:request\.signal\}\)/);
  assert.match(component,/setRetryKey\(value=>value\+1\)/);
  assert.match(component,/return\(\)=>manager\.cancel\(\)/);
});

test('queue preview is intentionally bounded to five signals in the UI',()=>{
  assert.match(component,/buildQueuePreview\(data,5\)/);
});
