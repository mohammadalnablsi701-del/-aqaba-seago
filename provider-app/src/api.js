const API=String(import.meta.env.VITE_API_BASE_URL||"").replace(/\/$/,"");
async function req(path,{token,...options}={}){
  const r=await fetch(API+path,{...options,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{}),...(options.headers||{})}});
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
export const me=token=>req("/api/providers/me",{token});
export const createProviderProfile=(token,data)=>req("/api/providers",{token,method:"POST",body:JSON.stringify(data)});
export const trips=token=>req("/api/providers/me/trips",{token});
export const departures=(token,date)=>req("/api/providers/me/departures?date="+encodeURIComponent(date),{token});
export const bookings=(token,date)=>req("/api/providers/me/bookings"+(date?"?date="+encodeURIComponent(date):""),{token});
export const checkIn=(token,ticketToken)=>req("/api/tickets/check-in",{token,method:"POST",body:JSON.stringify({token:ticketToken})});

export const inspectTicket=(token,ticketToken)=>req("/api/tickets/inspect",{token,method:"POST",body:JSON.stringify({token:ticketToken})});

export const createTrip=(token,data)=>req("/api/trips",{token,method:"POST",body:JSON.stringify(data)});
export const updateTrip=(token,id,data)=>req("/api/trips/"+id,{token,method:"PATCH",body:JSON.stringify(data)});
export const createDeparture=(token,data)=>req("/api/departures",{token,method:"POST",body:JSON.stringify(data)});
export const createDeparturesBulk=(token,data)=>req("/api/departures/bulk",{token,method:"POST",body:JSON.stringify(data)});
export const updateDeparture=(token,id,data)=>req("/api/departures/"+id,{token,method:"PATCH",body:JSON.stringify(data)});

export const bookingDetail=(token,id)=>req("/api/providers/me/bookings/"+id,{token});

export const providerStats=(token,date)=>req("/api/providers/me/stats?date="+encodeURIComponent(date),{token});

export const departureManifest=(token,id)=>req("/api/providers/me/departures/"+id+"/manifest",{token});

export const uploadTripImage=(token,dataUrl)=>req("/api/media/trip-image",{token,method:"POST",body:JSON.stringify({dataUrl})});
export const deleteTripImage=(token,publicId)=>req("/api/media/trip-image",{token,method:"DELETE",body:JSON.stringify({publicId})});

export const listNotifications=token=>req("/api/notifications",{token});
export const markNotificationRead=(token,id)=>req("/api/notifications/"+id+"/read",{token,method:"PATCH"});
export const markAllNotificationsRead=token=>req("/api/notifications/read-all",{token,method:"POST"});

function urlBase64ToUint8Array(base64String){const padding="=".repeat((4-base64String.length%4)%4);const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");const raw=atob(base64);return Uint8Array.from([...raw].map(ch=>ch.charCodeAt(0)))}
export async function enablePushNotifications(token){if(!("serviceWorker"in navigator)||!("PushManager"in window)||!("Notification"in window))throw new Error("Push notifications are not supported on this device/browser");const permission=await Notification.requestPermission();if(permission!=="granted")throw new Error("Notification permission was not granted");const registration=await navigator.serviceWorker.ready;let subscription=await registration.pushManager.getSubscription();if(!subscription){const{publicKey}=await req("/api/push/public-key");subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey)})}await req("/api/push/subscribe",{token,method:"POST",body:JSON.stringify({subscription:subscription.toJSON()})});return{permission,subscribed:true}}
export async function pushNotificationStatus(){if(!("serviceWorker"in navigator)||!("PushManager"in window)||!("Notification"in window))return{supported:false,permission:"unsupported",subscribed:false};const registration=await navigator.serviceWorker.ready;const subscription=await registration.pushManager.getSubscription();return{supported:true,permission:Notification.permission,subscribed:Boolean(subscription)}}
export const sendTestPush=token=>req("/api/push/test",{token,method:"POST"});
