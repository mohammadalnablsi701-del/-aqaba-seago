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

export function adminPayments(token,filters={},options={}){
  const params=new URLSearchParams();
  const values={
    page:filters.page||1,
    limit:filters.limit||25,
    status:filters.status,
    provider:filters.provider,
    from:filters.from,
    to:filters.to,
    booking:filters.booking,
    needsReview:filters.needsReview,
    refund:filters.refund,
    q:filters.q
  };
  Object.entries(values).forEach(([key,value])=>{
    if(value!==undefined&&value!==null&&String(value)!==""&&String(value)!=="any"&&String(value)!=="all")params.set(key,String(value));
  });
  return request(`/api/admin/payments?${params}`,token,options);
}

export function adminPaymentDetail(token,paymentId,options={}){
  return request(`/api/admin/payments/${encodeURIComponent(paymentId)}`,token,options);
}
