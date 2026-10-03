const API_BASE = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

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

export async function getQuote(departureId, adults, children = 0, mealPlan = "without_buffet") {
  const qs = new URLSearchParams({ adults: String(adults), children: String(children), mealPlan });
  return request(`/api/departures/${departureId}/quote?${qs}`);
}

export async function registerCustomer({ name, email, phone, password }) {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, phone, password, role: "customer" })
  });
}

export async function loginCustomer({ email, password }) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
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
  return request("/api/bookings", { token });
}

export async function createPaymentCheckout({ departureId, adults, children = 0, mealPlan = "without_buffet", token }) {
  const key = globalThis.crypto?.randomUUID?.() ||
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
export async function enablePushNotifications(token){
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
export async function pushNotificationStatus(){
  if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window))return {supported:false,permission:"unsupported",subscribed:false};
  const registration=await navigator.serviceWorker.ready;
  const subscription=await registration.pushManager.getSubscription();
  return {supported:true,permission:Notification.permission,subscribed:Boolean(subscription)};
}
export async function sendTestPush(token){
  return request("/api/push/test",{method:"POST",token});
}

export const requestPhoneOtp=(phone,role,mode)=>request("/api/auth/otp/request",{method:"POST",body:JSON.stringify({phone,role,mode})});
export const verifyPhoneOtp=(data)=>request("/api/auth/otp/verify",{method:"POST",body:JSON.stringify(data)});

export const googleAuthConfig=()=>request("/api/auth/google/config");
export const googleSignIn=(credential,role="customer")=>request("/api/auth/google",{method:"POST",body:JSON.stringify({credential,role})});
