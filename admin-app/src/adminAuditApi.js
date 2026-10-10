const API=String(import.meta.env.VITE_API_BASE_URL||"").replace(/\/$/,"");

export async function adminAudit(token,{page=1,limit=25,entityType="",entityId="",action=""}={}){
  const params=new URLSearchParams({page:String(page),limit:String(limit)});
  if(entityType)params.set("entityType",entityType);
  if(entityId)params.set("entityId",entityId);
  if(action)params.set("action",action);
  const response=await fetch(`${API}/api/admin/audit?${params.toString()}`,{
    headers:token?{Authorization:`Bearer ${token}`}:{ }
  });
  const json=await response.json().catch(()=>({}));
  if(!response.ok){
    if(response.status===401&&token){
      localStorage.removeItem("seago_admin_auth");
      window.dispatchEvent(new CustomEvent("seago:session-expired"));
    }
    throw new Error(json.error||"Could not load admin activity");
  }
  return json;
}
