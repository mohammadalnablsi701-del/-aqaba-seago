const API=String(import.meta.env.VITE_API_BASE_URL||"").replace(/\/$/,"");
async function req(path,{token,...options}={}){const r=await fetch(API+path,{...options,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{}),...(options.headers||{})}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Request failed");return j;}
export const login=(email,password)=>req("/api/auth/login",{method:"POST",body:JSON.stringify({email,password})});
export const me=token=>req("/api/providers/me",{token});
export const trips=token=>req("/api/providers/me/trips",{token});
export const departures=(token,date)=>req("/api/providers/me/departures?date="+encodeURIComponent(date),{token});
export const bookings=(token,date)=>req("/api/providers/me/bookings?date="+encodeURIComponent(date),{token});
export const checkIn=(token,ticketToken)=>req("/api/tickets/check-in",{token,method:"POST",body:JSON.stringify({token:ticketToken})});

export const inspectTicket=(token,ticketToken)=>req("/api/tickets/inspect",{token,method:"POST",body:JSON.stringify({token:ticketToken})});

export const createTrip=(token,data)=>req("/api/trips",{token,method:"POST",body:JSON.stringify(data)});
export const updateTrip=(token,id,data)=>req("/api/trips/"+id,{token,method:"PATCH",body:JSON.stringify(data)});
export const createDeparture=(token,data)=>req("/api/departures",{token,method:"POST",body:JSON.stringify(data)});
export const updateDeparture=(token,id,data)=>req("/api/departures/"+id,{token,method:"PATCH",body:JSON.stringify(data)});

export const bookingDetail=(token,id)=>req("/api/providers/me/bookings/"+id,{token});

export const providerStats=(token,date)=>req("/api/providers/me/stats?date="+encodeURIComponent(date),{token});
