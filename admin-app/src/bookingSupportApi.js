const API=String(import.meta.env.VITE_API_BASE_URL||"").replace(/\/$/,"");

async function request(path,token,{signal}={}){
  const response=await fetch(API+path,{signal,headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    if(response.status===401&&token){
      localStorage.removeItem("seago_admin_auth");
      window.dispatchEvent(new CustomEvent("seago:session-expired"));
    }
    const error=new Error(body.error||"Request failed");
    error.status=response.status;
    throw error;
  }
  return body;
}

export function searchAdminBookings(token,query,{signal,limit=20}={}){
  const params=new URLSearchParams({q:String(query||"").trim(),limit:String(limit)});
  return request(`/api/admin/bookings/search?${params}`,token,{signal});
}

export function adminBookingDetail(token,bookingId,{signal}={}){
  return request(`/api/admin/bookings/${encodeURIComponent(bookingId)}`,token,{signal});
}
