import fs from "node:fs";

function replaceOnce(text,needle,replacement,label){
  const count=text.split(needle).length-1;
  if(count!==1)throw new Error(`${label}: expected exactly one match, found ${count}`);
  return text.replace(needle,replacement);
}

// Admin API: move settlement payment actions onto the existing Sensitive Action modal.
{
  const path="admin-app/src/api.js";
  let text=fs.readFileSync(path,"utf8");
  const oldLine='export const markSettlementPaid=(token,{providerId,from,to,note=""})=>req("/api/admin/settlements/pay",{token,method:"POST",body:JSON.stringify({providerId,from,to,note})});';
  const replacement=`export const markSettlementPaid=(token,{providerId,from,to})=>runLockedSensitiveAction(\`settlement:\${providerId}:\${from}:\${to}:pay\`,async()=>{\n  const data=await settlements(token,{from,to,providerId});\n  const row=(data.breakdown||[]).find(item=>String(item.providerId)===String(providerId));\n  if(!row)throw new Error("Settlement preview is no longer available. Refresh and try again.");\n  const amount=Number(row.payableNow??row.outstanding??0);\n  if(!(amount>0))throw new Error(Number(row.reversedOutstanding||0)>0?"This balance was reversed and cannot be re-recorded through Mark Paid.":"No payable provider balance remains in this period.");\n  const currency=data.currency||"JOD";\n  return runSensitiveAction({\n    title:"Mark settlement paid",subject:row.providerName||"Provider",confirmLabel:"Mark paid",danger:true,reasonRequired:true,reasonLabel:"Payment reason",\n    impact:"This action records that the provider has actually been paid.",\n    details:[\n      {label:"Provider",value:row.providerName||"Provider"},\n      {label:"Settlement period / reference",value:\`\${from} → \${to}\`},\n      {label:"Settlement amount",value:\`\${amount.toFixed(2)} \${currency}\`},\n      {label:"Currency",value:currency},\n      {label:"Current status",value:"Outstanding"},\n      {label:"New status",value:"Paid"}\n    ],\n    execute:reason=>req("/api/admin/settlements/pay",{token,method:"POST",body:JSON.stringify({providerId,from,to,reason})})\n  });\n});\nexport const reverseSettlementPayment=(token,settlement)=>runLockedSensitiveAction(\`settlement:\${settlement.id}:reverse\`,()=>runSensitiveAction({\n  title:"Reverse settlement payment record",subject:settlement.providerName||"Provider",confirmLabel:"Reverse payment record",danger:true,reasonRequired:true,reasonLabel:"Correction reason",\n  impact:"This records an append-only correction. The original Paid history remains visible; effective paid becomes zero. It does not initiate a bank transfer or refund.",\n  details:[\n    {label:"Provider",value:settlement.providerName||"Provider"},\n    {label:"Settlement reference",value:String(settlement.id)},\n    {label:"Settlement amount",value:\`\${Number(settlement.amountPaid||0).toFixed(2)} \${settlement.currency||"JOD"}\`},\n    {label:"Currency",value:settlement.currency||"JOD"},\n    {label:"Current status",value:"Paid"},\n    {label:"New effective state",value:"Payment record reversed"}\n  ],\n  execute:reason=>req("/api/admin/settlements/"+settlement.id+"/reverse",{token,method:"POST",body:JSON.stringify({reason})})\n}));`;
  text=replaceOnce(text,oldLine,replacement,"admin api settlement action");
  fs.writeFileSync(path,text);
}

// Admin UI: remove window.confirm, display reversal truth, and prevent re-paying reversed allocations.
{
  const path="admin-app/src/App.jsx";
  let text=fs.readFileSync(path,"utf8");
  text=replaceOnce(text,'import BookingSupport from"./BookingSupport.jsx";','import BookingSupport from"./BookingSupport.jsx";\nimport SettlementHistoryRow from"./SettlementHistoryRow.jsx";',"SettlementHistoryRow import");

  const payStart=' async function payProviderSettlement(row){';
  const payEnd=' async function runDemoCleanup(){';
  const start=text.indexOf(payStart),end=text.indexOf(payEnd);
  if(start<0||end<0||end<=start)throw new Error("payProviderSettlement block not found");
  const safePay=' async function payProviderSettlement(row){if(!settlementFrom||!settlementTo)return;setSettlementBusy(String(row.providerId));setSettlementError("");try{await markSettlementPaid(auth.token,{providerId:String(row.providerId),from:settlementFrom,to:settlementTo});setSettlementRefresh(v=>v+1);setOverviewRefresh(v=>v+1)}catch(e){if(!e?.cancelled)setSettlementError(e.message||"Could not mark settlement paid")}finally{setSettlementBusy("")} }\n';
  text=text.slice(0,start)+safePay+text.slice(end);

  text=replaceOnce(text,'<div className="settlement-company"><b>{row.providerName}</b><small>{row.bookings} paid booking(s)</small></div>','<div className="settlement-company"><b>{row.providerName}</b><small>{row.bookings} paid booking(s)</small>{Number(row.reversedOutstanding||0)>0&&<small>Reversed payout outstanding: {Number(row.reversedOutstanding).toFixed(2)} JOD · dedicated re-payment flow required</small>}</div>',"settlement reversed outstanding presentation");

  const oldButton='<button className="settlement-pay" disabled={row.reconciliationRequired||row.recoveryDue>0||!settlementFrom||!settlementTo||Number(row.outstanding||0)<=0||settlementBusy===String(row.providerId)} onClick={()=>payProviderSettlement(row)}>{settlementBusy===String(row.providerId)?"Saving...":row.reconciliationRequired||row.recoveryDue>0?"Review required":Number(row.outstanding||0)>0?"Mark as paid":"Paid"}</button>';
  const newButton='<button className="settlement-pay" disabled={row.reconciliationRequired||row.recoveryDue>0||!settlementFrom||!settlementTo||Number(row.payableNow??row.outstanding??0)<=0||settlementBusy===String(row.providerId)} onClick={()=>payProviderSettlement(row)}>{settlementBusy===String(row.providerId)?"Saving...":row.reconciliationRequired||row.recoveryDue>0?"Review required":Number(row.payableNow??row.outstanding??0)>0?"Mark as paid":Number(row.reversedOutstanding||0)>0?"Re-payment flow required":"Paid"}</button>';
  text=replaceOnce(text,oldButton,newButton,"settlement pay button");

  const oldHistory='settlementData.history.map(s=><div className="settlement-history-row" key={s.id}><div><b>{s.providerName}</b><span>{new Date(s.periodFrom).toLocaleDateString()} → {new Date(s.periodTo).toLocaleDateString()}</span></div><div><b>{Number(s.amountPaid||0).toFixed(2)} {s.currency||"JOD"}</b><span>Paid {new Date(s.paidAt).toLocaleString()}</span></div></div>)';
  const newHistory='settlementData.history.map(s=><SettlementHistoryRow key={s.id} settlement={s} token={auth.token} onChanged={()=>{setSettlementRefresh(v=>v+1);setOverviewRefresh(v=>v+1)}}/>)';
  text=replaceOnce(text,oldHistory,newHistory,"settlement history row");
  if(text.includes("window.confirm(`Mark "))throw new Error("legacy settlement window.confirm remains");
  fs.writeFileSync(path,text);
}

// Remove the legacy settlement handlers now that adminSettlements owns this contract.
{
  const path="src/routes/admin.js";
  let text=fs.readFileSync(path,"utf8");
  text=replaceOnce(text,'import {settlementLedger, recordSettlement} from "../services/settlements.js";\n',"","legacy settlement service import");
  const start=text.indexOf('router.get("/settlements"');
  const end=text.indexOf('router.get("/trips"',start);
  if(start<0||end<0||end<=start)throw new Error("legacy settlement route block not found");
  text=text.slice(0,start)+text.slice(end);
  text=text.replace('import ProviderSettlement from "../models/ProviderSettlement.js";',"");
  fs.writeFileSync(path,text);
}

console.log("Task 3 source patch applied successfully.");
