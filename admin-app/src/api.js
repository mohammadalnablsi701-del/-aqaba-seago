import{runLockedSensitiveAction,runSensitiveAction}from"./sensitiveActionDialog.js";
import{commissionConfirmationText,commissionPayloadPreview}from"./commissionEditorModel.js";

const API=String(import.meta.env.VITE_API_BASE_URL||"").replace(/\/$/,"");async function req(path,{token,...o}={}){
  const r=await fetch(API+path,{...o,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{...{}}),...(o.headers||{})}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){if(r.status===401&&token){localStorage.removeItem("seago_admin_auth");window.dispatchEvent(new CustomEvent("seago:session-expired"));}const e=new Error(j.error||"Request failed");e.status=r.status;throw e;}return j;
}
async function providerMeta(token,id){const rows=await req("/api/admin/providers",{token});return rows.find(x=>String(x._id||x.id)===String(id))||{_id:id,businessName:"Provider",status:"unknown"}}
async function tripMeta(token,id){const rows=await req("/api/admin/trips",{token});return rows.find(x=>String(x._id||x.id)===String(id))||{_id:id,titleEn:"Trip",pricing:{},providerId:{}}}
const tripName=t=>t.titleEn||t.titleAr||"Trip";
const providerName=p=>p.businessName||"Provider";

export const login=(email,password)=>req("/api/auth/login",{method:"POST",body:JSON.stringify({email,password})});
export const providers=(token,options={})=>req("/api/admin/providers",{token,...options});
export const approveProvider=(token,id)=>runLockedSensitiveAction(`provider:${id}:approve`,async()=>{
  const p=await providerMeta(token,id);
  return runSensitiveAction({
    title:"Approve provider",subject:providerName(p),confirmLabel:"Approve provider",
    impact:"This approves the provider on SeaGo. Trips become sellable only when the trip is provider-active, allowed by the platform, and otherwise available for sale.",
    details:[{label:"Current status",value:p.status||"unknown"}],
    execute:()=>req("/api/admin/providers/"+id+"/approve",{token,method:"PATCH"})
  });
});
export const trips=(token,options={})=>req("/api/admin/trips",{token,...options});
export const setTripPlatformStatus=(token,id,platformStatus)=>runLockedSensitiveAction(`trip:${id}:platform:${platformStatus}`,async()=>{
  const t=await tripMeta(token,id);const current=t.platformStatus==="paused"?"paused":"allowed";
  if(current===platformStatus)return req("/api/admin/trips/"+id+"/platform-status",{token,method:"PATCH",body:JSON.stringify({platformStatus})});
  const pausing=platformStatus==="paused";
  return runSensitiveAction({
    title:pausing?"Pause trip on platform":"Allow trip on platform",subject:tripName(t),confirmLabel:pausing?"Pause on platform":"Allow on platform",danger:pausing,reasonRequired:pausing,reasonLabel:"Operational reason",
    impact:pausing
      ?"This will stop new checkout starts and public SeaGo sales entry points for this trip. Existing checkout holds are not released by this action. It will not change the provider-controlled active state, delete departures, or cancel confirmed bookings."
      :"This allows SeaGo platform sales for this trip. It does not change the provider-controlled active state or provider approval, so the trip may still remain not sellable.",
    details:[{label:"Provider",value:t.providerId?.businessName||"Provider"},{label:"Provider state",value:t.active?"Active":"Paused"},{label:"Platform",value:current}],
    execute:reason=>req("/api/admin/trips/"+id+"/platform-status",{token,method:"PATCH",body:JSON.stringify({platformStatus,...(reason?{reason}:{})})})
  });
});
export const setCommission=(token,id,fees)=>runLockedSensitiveAction(`trip:${id}:commission`,async()=>{
  const t=await tripMeta(token,id);const pricing=t.pricing||{};const body=typeof fees==="number"?{percentage:fees}:{...fees};
  const oldType=String(pricing.commissionType||"");
  const nextType=body.percentage!==undefined?"percentage":String(body.commissionType||oldType);
  const typeChanged=Boolean(oldType)&&nextType!==oldType;
  const requestBody={...body,...(typeChanged?{confirmTypeChange:true}:{})};
  return runSensitiveAction({
    title:"Change trip commission",subject:tripName(t),confirmLabel:"Save commission",danger:true,reasonRequired:true,reasonLabel:"Reason for commission change",
    impact:"This change applies to future bookings only. Existing booking pricing snapshots will remain unchanged.",
    details:[
      {label:"Current commission",value:commissionConfirmationText(pricing)},
      {label:"New commission",value:commissionPayloadPreview(pricing,requestBody)},
      ...(typeChanged?[{label:"Type change",value:"Explicit confirmation required"}]:[])
    ],
    execute:reason=>req("/api/admin/trips/"+id+"/commission",{token,method:"PATCH",body:JSON.stringify({...requestBody,reason})})
  });
});
export const refunds=(token,options={})=>req("/api/admin/refunds",{token,...options});
export const notifications=(token,options={})=>req("/api/admin/notifications",{token,...options});
export const supportRequests=(token,options={})=>req("/api/admin/support-requests",{token,...options});
export const setSupportRequestStatus=(token,id,status)=>req("/api/admin/support-requests/"+id,{token,method:"PATCH",body:JSON.stringify({status})});
export const overview=(token,{from="",to="",providerId=""}={},options={})=>{const q=new URLSearchParams();if(from)q.set("from",from);if(to)q.set("to",to);if(providerId)q.set("providerId",providerId);return req("/api/admin/overview"+(q.toString()?"?"+q.toString():""),{token,...options});};
export const operations=(token,options={})=>req("/api/admin/operations",{token,...options});
export const settlements=(token,{from="",to="",providerId=""}={},options={})=>{const q=new URLSearchParams();if(from)q.set("from",from);if(to)q.set("to",to);if(providerId)q.set("providerId",providerId);return req("/api/admin/settlements"+(q.toString()?"?"+q.toString():""),{token,...options});};
export const markSettlementPaid=(token,{providerId,from,to,note=""})=>req("/api/admin/settlements/pay",{token,method:"POST",body:JSON.stringify({providerId,from,to,note})});
export const readiness=(token,options={})=>req("/api/admin/readiness",{token,...options});
export const demoCleanupPreview=(token,options={})=>req("/api/admin/demo-cleanup-preview",{token,...options});
export const cleanupDemo=(token,providerId,confirmation)=>req("/api/admin/demo-cleanup",{token,method:"POST",body:JSON.stringify({providerId,confirmation})});
export const setProviderStatus=(token,id,status)=>runLockedSensitiveAction(`provider:${id}:status:${status}`,async()=>{
  const p=await providerMeta(token,id);if(p.status===status)return req("/api/admin/providers/"+id+"/status",{token,method:"PATCH",body:JSON.stringify({status})});
  const config={
    rejected:{title:"Reject provider",label:"Reject provider",danger:true,reason:true,impact:"This will reject the provider, stop new sales, and release open checkout holds. Confirmed bookings and scheduled departures will remain."},
    suspended:{title:"Suspend provider",label:"Suspend provider",danger:true,reason:true,impact:"This will stop new sales for this provider and release open checkout holds. Existing confirmed bookings and scheduled departures will remain."},
    approved:{title:"Reactivate provider",label:"Reactivate provider",danger:false,reason:false,impact:"This restores provider approval. Trips are sellable only when each trip is provider-active, allowed by the platform, and otherwise available for sale."},
    pending:{title:"Return provider to pending",label:"Return to pending",danger:false,reason:true,impact:"This moves the rejected application back to pending review. It does not approve the provider or make its trips sellable."}
  }[status];
  if(!config)return req("/api/admin/providers/"+id+"/status",{token,method:"PATCH",body:JSON.stringify({status})});
  return runSensitiveAction({
    title:config.title,subject:providerName(p),confirmLabel:config.label,danger:config.danger,reasonRequired:config.reason,reasonLabel:"Operational reason",
    impact:config.impact,
    details:[{label:"Current status",value:p.status||"unknown"},{label:"New status",value:status}],
    execute:reason=>req("/api/admin/providers/"+id+"/status",{token,method:"PATCH",body:JSON.stringify({status,...(reason?{reason}:{})})})
  });
});
export const setProviderAccess=(token,id,{email,name,temporaryPassword,reason})=>runLockedSensitiveAction(`provider:${id}:access`,()=>req("/api/admin/providers/"+id+"/access",{token,method:"PATCH",body:JSON.stringify({email,name,temporaryPassword,reason})}));
export const requestPhoneOtp=(phone,role,mode)=>req("/api/auth/otp/request",{method:"POST",body:JSON.stringify({phone,role,mode})});
export const verifyPhoneOtp=(data)=>req("/api/auth/otp/verify",{method:"POST",body:JSON.stringify(data)});
