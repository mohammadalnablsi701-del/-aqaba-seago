const API=String(import.meta.env.VITE_API_BASE_URL||"").replace(/\/$/,"");async function req(path,{token,...o}={}){
  const r=await fetch(API+path,{...o,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{...{}}),...(o.headers||{})}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){if(r.status===401&&token){localStorage.removeItem("seago_admin_auth");window.dispatchEvent(new CustomEvent("seago:session-expired"));}const e=new Error(j.error||"Request failed");e.status=r.status;throw e;}return j;
}
export const login=(email,password)=>req("/api/auth/login",{method:"POST",body:JSON.stringify({email,password})});
export const providers=token=>req("/api/admin/providers",{token});
export const approveProvider=(token,id)=>req("/api/admin/providers/"+id+"/approve",{token,method:"PATCH"});
export const trips=token=>req("/api/admin/trips",{token});
export const setCommission=(token,id,fees)=>{
  if(typeof fees==="number")return req("/api/admin/trips/"+id+"/commission",{token,method:"PATCH",body:JSON.stringify({percentage:fees})});
  return req("/api/admin/trips/"+id+"/fees",{token,method:"PATCH",body:JSON.stringify(fees)});
};
export const refunds=token=>req("/api/admin/refunds",{token});
export const notifications=token=>req("/api/admin/notifications",{token});
export const supportRequests=token=>req("/api/admin/support-requests",{token});
export const setSupportRequestStatus=(token,id,status)=>req("/api/admin/support-requests/"+id,{token,method:"PATCH",body:JSON.stringify({status})});
export const overview=(token,{from="",to="",providerId=""}={})=>{const q=new URLSearchParams();if(from)q.set("from",from);if(to)q.set("to",to);if(providerId)q.set("providerId",providerId);return req("/api/admin/overview"+(q.toString()?"?"+q.toString():""),{token});};
export const settlements=(token,{from="",to="",providerId=""}={})=>{const q=new URLSearchParams();if(from)q.set("from",from);if(to)q.set("to",to);if(providerId)q.set("providerId",providerId);return req("/api/admin/settlements"+(q.toString()?"?"+q.toString():""),{token});};
export const markSettlementPaid=(token,{providerId,from,to,note=""})=>req("/api/admin/settlements/pay",{token,method:"POST",body:JSON.stringify({providerId,from,to,note})});
export const readiness=token=>req("/api/admin/readiness",{token});
export const demoCleanupPreview=token=>req("/api/admin/demo-cleanup-preview",{token});
export const cleanupDemo=(token,providerId,confirmation)=>req("/api/admin/demo-cleanup",{token,method:"POST",body:JSON.stringify({providerId,confirmation})});
export const setProviderStatus=(token,id,status)=>req("/api/admin/providers/"+id+"/status",{token,method:"PATCH",body:JSON.stringify({status})});
export const setProviderAccess=(token,id,{email,name,temporaryPassword})=>req("/api/admin/providers/"+id+"/access",{token,method:"PATCH",body:JSON.stringify({email,name,temporaryPassword})});
export const requestPhoneOtp=(phone,role,mode)=>req("/api/auth/otp/request",{method:"POST",body:JSON.stringify({phone,role,mode})});
export const verifyPhoneOtp=(data)=>req("/api/auth/otp/verify",{method:"POST",body:JSON.stringify(data)});
