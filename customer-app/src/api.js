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
  return request("/api/payments/checkout", {
    method: "POST",
    token,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ departureId, adults, children, mealPlan })
  });
}

export async function getPayment(paymentId, token) {
  return request(`/api/payments/${paymentId}`, { token });
}
