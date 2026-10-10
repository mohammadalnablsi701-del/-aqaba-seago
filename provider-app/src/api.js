const API=String(import.meta.env.VITE_API_BASE_URL||"").replace(/\/$/,"");

function vesselStore(){
  if(typeof window==="undefined")return{byId:{},byTitle:{},lastInspected:null};
  window.__seagoProviderVesselStore ||= {byId:{},byTitle:{},lastInspected:null};
  return window.__seagoProviderVesselStore;
}
function indexTrip(trip){
  if(!trip||typeof trip!=="object")return;
  const vesselName=String(trip.vesselName||"").trim();
  if(!vesselName)return;
  const store=vesselStore();
  const id=trip._id||trip.id;
  if(id)store.byId[String(id)]=vesselName;
  if(trip.titleEn)store.byTitle[String(trip.titleEn).trim()]=vesselName;
  if(trip.titleAr)store.byTitle[String(trip.titleAr).trim()]=vesselName;
}
function indexPayload(payload){
  if(Array.isArray(payload)){payload.forEach(indexPayload);return payload;}
  if(!payload||typeof payload!=="object")return payload;
  indexTrip(payload);
  if(payload.tripId&&typeof payload.tripId==="object")indexTrip(payload.tripId);
  if(payload.trip&&typeof payload.trip==="object")indexTrip(payload.trip);
  if(payload.departure?.trip&&typeof payload.departure.trip==="object")indexTrip(payload.departure.trip);
  if(payload.items&&Array.isArray(payload.items))payload.items.forEach(indexPayload);
  if(payload.bookings&&Array.isArray(payload.bookings))payload.bookings.forEach(indexPayload);
  return payload;
}
function publishVessels(payload){
  indexPayload(payload);
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("seago:provider-vessels-updated"));
  return payload;
}
function rememberInspected(payload){
  if(payload?.vesselName){
    const store=vesselStore();
    store.lastInspected=String(payload.vesselName).trim();
    if(payload.trip)store.byTitle[String(payload.trip).trim()]=store.lastInspected;
  }
  return publishVessels(payload);
}
async function req(path,{token,...options}={}){
  const r=await fetch(API+path,{...options,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{ }),...(options.headers||{})}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){
    if(r.status===401&&token){
      localStorage.removeItem("seago_provider_auth");
      window.dispatchEvent(new CustomEvent("seago:session-expired"));
    }
    const e=new Error(j.error||"Request failed");
    e.status=r.status;
    throw e;
  }
  return j;
}
export const login=(email,password)=>req("/api/auth/login",{method:"POST",body:JSON.stringify({email,password})});
export const registerProvider=data=>req("/api/auth/register",{method:"POST",body:JSON.stringify({...data,role:"provider"})});
export const me=(token,{signal}={})=>req("/api/providers/me",{token,signal});
export const createProviderProfile=(token,data)=>req("/api/providers",{token,method:"POST",body:JSON.stringify(data)});
export const updateProviderSettings=(token,data)=>req("/api/providers/me/settings",{token,method:"PATCH",body:JSON.stringify(data)});
export const trips=async(token,{signal}={})=>publishVessels(await req("/api/providers/me/trips",{token,signal}));
export const departures=async(token,date,{signal}={})=>publishVessels(await req("/api/providers/me/departures"+(date?"?date="+encodeURIComponent(date):""),{token,signal}));
export const bookings=async(token,date,{signal}={})=>publishVessels(await req("/api/providers/me/bookings"+(date?"?date="+encodeURIComponent(date):""),{token,signal}));
export const checkIn=(token,ticketToken)=>req("/api/tickets/check-in",{token,method:"POST",body:JSON.stringify({token:ticketToken})});

export const inspectTicket=async(token,ticketToken)=>rememberInspected(await req("/api/tickets/inspect",{token,method:"POST",body:JSON.stringify({token:ticketToken})}));

export const createTrip=async(token,data)=>publishVessels(await req("/api/trips",{token,method:"POST",body:JSON.stringify(data)}));
export const updateTrip=async(token,id,data)=>publishVessels(await req("/api/trips/"+id,{token,method:"PATCH",body:JSON.stringify(data)}));
export const createDeparture=(token,data)=>req("/api/departures",{token,method:"POST",body:JSON.stringify(data)});
export const createDeparturesBulk=(token,data)=>req("/api/departures/bulk",{token,method:"POST",body:JSON.stringify(data)});
export const updateDeparture=(token,id,data)=>req("/api/departures/"+id,{token,method:"PATCH",body:JSON.stringify(data)});

export const bookingDetail=async(token,id)=>publishVessels(await req("/api/providers/me/bookings/"+id,{token}));
export const manualCheckInBooking=(token,id)=>req("/api/providers/me/bookings/"+id+"/check-in",{token,method:"POST"});

export const providerStats=(token,date)=>req("/api/providers/me/stats?date="+encodeURIComponent(date),{token});

export const departureManifest=async(token,id)=>publishVessels(await req("/api/providers/me/departures/"+id+"/manifest",{token}));

export const uploadTripImage=(token,dataUrl)=>req("/api/media/trip-image",{token,method:"POST",body:JSON.stringify({dataUrl})});
export const deleteTripImage=(token,publicId)=>req("/api/media/trip-image",{token,method:"DELETE",body:JSON.stringify({publicId})});

export const listNotifications=token=>req("/api/notifications",{token});
export const markNotificationRead=(token,id)=>req("/api/notifications/"+id+"/read",{token,method:"PATCH"});
export const markAllNotificationsRead=token=>req("/api/notifications/read-all",{token,method:"POST"});

function urlBase64ToUint8Array(base64String){const padding="=".repeat((4-base64String.length%4)%4);const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");const raw=atob(base64);return Uint8Array.from([...raw].map(ch=>ch.charCodeAt(0)))}
export async function enablePushNotifications(token){if(!("serviceWorker"in navigator)||!("PushManager"in window)||!("Notification"in window))throw new Error("Push notifications are not supported on this device/browser");const permission=await Notification.requestPermission();if(permission!=="granted")throw new Error("Notification permission was not granted");const registration=await navigator.serviceWorker.ready;let subscription=await registration.pushManager.getSubscription();if(!subscription){const{publicKey}=await req("/api/push/public-key");subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey)})}await req("/api/push/subscribe",{token,method:"POST",body:JSON.stringify({subscription:subscription.toJSON()})});return{permission,subscribed:true}}
export async function pushNotificationStatus(){if(!("serviceWorker"in navigator)||!("PushManager"in window)||!("Notification"in window))return{supported:false,permission:"unsupported",subscribed:false};const registration=await navigator.serviceWorker.ready;const subscription=await registration.pushManager.getSubscription();return{supported:true,permission:Notification.permission,subscribed:Boolean(subscription)}}
export const sendTestPush=token=>req("/api/push/test",{token,method:"POST"});

export const providerTeam=token=>req("/api/providers/me/team",{token});
export const createProviderTeamMember=(token,data)=>req("/api/providers/me/team",{token,method:"POST",body:JSON.stringify(data)});
export const updateProviderTeamMember=(token,id,data)=>req("/api/providers/me/team/"+id,{token,method:"PATCH",body:JSON.stringify(data)});

export const providerAuditLog=token=>req("/api/providers/me/audit-log",{token});

export const googleAuthConfig=()=>req("/api/auth/google/config");
export const googleSignIn=(credential,role="provider")=>req("/api/auth/google",{method:"POST",body:JSON.stringify({credential,role})});
