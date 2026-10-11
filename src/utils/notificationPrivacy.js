import crypto from "node:crypto";

const SAFE_PUSH_SCREENS = new Set(["notifications", "tickets", "bookings", "manifest"]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function credentialFingerprint(value) {
  const raw = String(value || "");
  if (!raw) return "none";
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export function maskEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "redacted";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1) || "*"}***@${domain}`.slice(0, 254);
}

export function safeProviderStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

export function pushFailureCode(error) {
  const status = safeProviderStatus(error?.statusCode || error?.status);
  if (status === 404 || status === 410) return "push_subscription_invalid";
  return "push_delivery_transient";
}

export function emailFailureCode(status) {
  const safeStatus = safeProviderStatus(status);
  if (!safeStatus) return "email_delivery_transient";
  return safeStatus >= 500 || safeStatus === 429
    ? "email_delivery_transient"
    : "email_delivery_rejected";
}

export function safePushData(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next = {};
  const screen = String(value.screen || "").trim();
  if (SAFE_PUSH_SCREENS.has(screen)) next.screen = screen;
  for (const key of ["notificationId", "departureId"]) {
    const item = String(value[key] || "").trim();
    if (SAFE_ID.test(item)) next[key] = item;
  }
  return next;
}

export function minimizedPushEnvelope({ data = {}, notificationId } = {}) {
  return {
    title: "Aqaba SeaGo",
    body: "You have a new SeaGo update. Open the app to view details.",
    data: safePushData({ ...data, notificationId })
  };
}
