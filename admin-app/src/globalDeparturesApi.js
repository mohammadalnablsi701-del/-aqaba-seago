const API=String(import.meta.env.VITE_API_BASE_URL||"").replace(/\/$/,"");

export async function globalDepartures(token,{date,providerId="",status="",sales=""}={},options={}){
  const query=new URLSearchParams();
  if(date)query.set("date",date);
  if(providerId)query.set("providerId",providerId);
  if(status)query.set("status",status);
  if(sales)query.set("sales",sales);
  const response=await fetch(`${API}/api/admin/operations/departures${query.toString()?`?${query}`:""}`,{
    ...options,
    headers:{...(token?{Authorization:`Bearer ${token}`}:{...{}}),...(options.headers||{})}
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    if(response.status===401&&token){
      localStorage.removeItem("seago_admin_auth");
      window.dispatchEvent(new CustomEvent("seago:session-expired"));
    }
    const error=new Error(body.error||"Could not load departures");
    error.status=response.status;
    throw error;
  }
  return body;
}
