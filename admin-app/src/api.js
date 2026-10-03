const API=String(import.meta.env.VITE_API_BASE_URL||"").replace(/\/$/,"");async function req(path,{token,...o}={}){
  const r=await fetch(API+path,{...o,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{}),...(o.headers||{})}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){
    if(r.status===401&&token){
      localStorage.removeItem("seago_admin_auth");
      window.dispatchEvent(new CustomEvent("seago:session-expired"));
    }
    const e=new Error(j.error||"Request failed");
    e.status=r.status;
    throw e;
  }
  return j;
}export const login=(email,password)=>req("/api/auth/login",{method:"POST",body:JSON.stringify({email,password})});export const trips=token=>req("/api/admin/trips",{token});export const setCommission=(token,id,percentage)=>req("/api/admin/trips/"+id+"/commission",{token,method:"PATCH",body:JSON.stringify({percentage})});export const refunds=token=>req("/api/admin/refunds",{token});export const notifications=token=>req("/api/admin/notifications",{token});
export const readiness=token=>req("/api/admin/readiness",{token});
export const demoCleanupPreview=token=>req("/api/admin/demo-cleanup-preview",{token});
export const cleanupDemo=(token,providerId,confirmation)=>req("/api/admin/demo-cleanup",{token,method:"POST",body:JSON.stringify({providerId,confirmation})});
