import { applyCustomerTicketState } from "./ticketLifecycle.js";
import { nativePushFeatureEnabled, resolvePushChannel } from "./nativePushConfig.js";

const API_BASE = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

async function runtimePushContext(){
  try{
    const {Capacitor}=await import("@capacitor/core");
    const isNative=Capacitor.isNativePlatform();
    const platform=Capacitor.getPlatform();
    const enabled=nativePushFeatureEnabled();
    return {isNative,platform,channel:resolvePushChannel({enabled,isNative,platform})};
  }catch{
    return {isNative:false,platform:"web",channel:"web"};
  }
}

async function request(path, options = {}) {
  if (!API_BASE) throw new Error("API_NOT_CONFIGURED");

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if(response.status===401&&options.token){
      localStorage.removeItem("seago_auth");
      window.dispatchEvent(new CustomEvent("seago:session-expired"));
    }
    const error = new Error(payload.error || `Request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function hasApi() {
  return Boolean(API_BASE);
}

export function getApiBase() {
  return API_BASE;
}

export async function listTrips() {
  return request("/api/trips");
}

export async function listDepartures(tripId) {
  const qs = new URLSearchParams({ tripId, limit: "30" });
  return request(`/api/departures?${qs}`);
}

export async function getQuote(departureId, adults, children = 0, mealPlan = "without_buffet", options = {}) {
  const qs = new URLSearchParams({ adults: String(adults), children: String(children), mealPlan });
  return request(`/api/departures/${departureId}/quote?${qs}`, options);
}

function reconcileAuthPush(result){
  if(result?.token)void reconcileExistingPushSubscription(result.token).catch(()=>{});
  return result;
}

export async function registerCustomer({ name, email, phone, password }) {
  const result=await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, phone, password, role: "customer" })
  });
  return reconcileAuthPush(result);
}

export async function loginCustomer({ email, password }) {
  const result=await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  return reconcileAuthPush(result);
}

export async function requestPasswordReset(email) {
  return request("/api/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export async function confirmPasswordReset(token, password) {
  return request("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token, password })
  });
}

export async function createBooking({ departureId, seats, token }) {
  const key = globalThis.crypto?.randomUUID?.() ||
    `booking-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return request("/api/bookings", {
    method: "POST",
    token,
    headers: { "Idempotency-Key": key },
    body: JSON.stringify({ departureId, seats })
  });
}

export async function listBookings(token) {
  const rows = await request("/api/bookings", { token });
  return Array.isArray(rows) ? rows.map(applyCustomerTicketState) : rows;
}

export async function createPaymentCheckout({ departureId, adults, children = 0, mealPlan = "without_buffet", token, idempotencyKey }) {
  const key = idempotencyKey || globalThis.crypto?.randomUUID?.() ||
    `checkout-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return request("/api/payments/checkout", {
    method: "POST",
    token,
    headers: { "Idempotency-Key": key },
    body: JSON.stringify({ departureId, adults, children, mealPlan })
  });
}

export async function getPayment(paymentId, token) {
  return request(`/api/payments/${paymentId}`, { token });
}

export async function getCancellationPolicy(bookingId, token) {
  return request(`/api/bookings/${bookingId}/cancellation-policy`, { token });
}
export async function cancelBooking(bookingId, reason, token) {
  return request(`/api/bookings/${bookingId}/cancel`, {
    method: "POST",
    token,
    body: JSON.stringify({ reason })
  });
}

export const listNotifications=token=>request("/api/notifications",{token});
export const markNotificationRead=(id,token)=>request("/api/notifications/"+id+"/read",{method:"PATCH",token});
export const markAllNotificationsRead=token=>request("/api/notifications/read-all",{method:"POST",token});

function urlBase64ToUint8Array(base64String){
  const padding="=".repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(base64);
  return Uint8Array.from([...raw].map(ch=>ch.charCodeAt(0)));
}

async function currentWebPushSubscription(){
  if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window))return null;
  const registration=await navigator.serviceWorker.getRegistration();
  if(!registration)return null;
  return registration.pushManager.getSubscription();
}

export async function enablePushNotifications(token){
  const runtime=await runtimePushContext();
  if(runtime.channel==="native-android")return (await import("./nativePush.js")).enableNativePush(token);
  if(runtime.isNative)throw new Error("Native push is disabled for this build");
  if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window))throw new Error("Push notifications are not supported on this device/browser");
  const permission=await Notification.requestPermission();
  if(permission!=="granted")throw new Error("Notification permission was not granted");
  const registration=await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription){
    const {publicKey}=await request("/api/push/public-key");
    subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey)});
  }
  await request("/api/push/subscribe",{method:"POST",token,body:JSON.stringify({subscription:subscription.toJSON()})});
  return {permission,subscribed:true};
}

export async function reconcileExistingPushSubscription(token){
  const runtime=await runtimePushContext();
  if(runtime.isNative)return {reconciled:false};
  if(!token||typeof Notification==="undefined"||Notification.permission!=="granted")return {reconciled:false};
  const subscription=await currentWebPushSubscription();
  if(!subscription)return {reconciled:false};
  await request("/api/push/subscribe",{method:"POST",token,body:JSON.stringify({subscription:subscription.toJSON()})});
  return {reconciled:true};
}

export async function disablePushNotifications(token,{timeoutMs=1500}={}){
  const runtime=await runtimePushContext();
  if(runtime.isNative){
    if(runtime.platform==="android")return (await import("./nativePush.js")).disableNativePush(token);
    return {serverRevoked:false,native:true};
  }
  const subscription=await currentWebPushSubscription().catch(()=>null);
  if(!subscription)return {serverRevoked:false,browserUnsubscribed:false,hadSubscription:false};

  let serverRevoked=false;
  if(token){
    const controller=typeof AbortController!=="undefined"?new AbortController():null;
    const timeout=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
    try{
      await request("/api/push/unsubscribe",{
        method:"POST",token,signal:controller?.signal,
        body:JSON.stringify({endpoint:subscription.endpoint})
      });
      serverRevoked=true;
    }catch{}
    finally{if(timeout)clearTimeout(timeout);}
  }

  let browserUnsubscribed=false;
  try{browserUnsubscribed=Boolean(await subscription.unsubscribe());}catch{}
  return {serverRevoked,browserUnsubscribed,hadSubscription:true};
}

export async function pushNotificationStatus(){
  const runtime=await runtimePushContext();
  if(runtime.channel==="native-android")return (await import("./nativePush.js")).nativePushPermission();
  if(runtime.isNative)return {supported:false,permission:"disabled",subscribed:false,native:true};
  if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window))return {supported:false,permission:"unsupported",subscribed:false};
  const registration=await navigator.serviceWorker.ready;
  const subscription=await registration.pushManager.getSubscription();
  return {supported:true,permission:Notification.permission,subscribed:Boolean(subscription)};
}
export async function sendTestPush(token){
  return request("/api/push/test",{method:"POST",token});
}

export const saveAccountPhone=(phone,token)=>request("/api/auth/phone",{method:"PATCH",token,body:JSON.stringify({phone})});

export const createSupportRequest=(data,token)=>request("/api/support",{method:"POST",token,body:JSON.stringify(data)});
export const listMySupportRequests=token=>request("/api/support/mine",{token});

export const googleAuthConfig=()=>request("/api/auth/google/config");
export async function googleSignIn(credential,role="customer"){
  const result=await request("/api/auth/google",{method:"POST",body:JSON.stringify({credential,role})});
  return reconcileAuthPush(result);
}

export const deleteAccount=token=>request("/api/auth/account",{method:"DELETE",token});
export const registerNativePushToken=({token:deviceToken,platform,installationId},token)=>request("/api/push/native-subscribe",{method:"POST",token,body:JSON.stringify({token:deviceToken,platform,installationId})});
export const unregisterNativePushToken=(installationId,token)=>request("/api/push/native-unsubscribe",{method:"POST",token,body:JSON.stringify({installationId})});
