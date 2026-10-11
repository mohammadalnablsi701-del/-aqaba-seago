import crypto from "node:crypto";
import { ticketOperationalCutoff } from "./ticketLifecycle.js";

const PUBLIC_TICKET_VERSION = 3;
const PUBLIC_IAT_FUTURE_TOLERANCE_MS = 60 * 1000;

function secret() {
  const value = process.env.TICKET_SIGNING_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error("TICKET_SIGNING_SECRET or JWT_SECRET is required");
  return value;
}

function invalid(message="Invalid ticket") {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function publicLinkError(code, statusCode = 400) {
  return Object.assign(new Error(code), { statusCode, code });
}

function bookingIdOf(booking) {
  const bookingId = String(booking?._id || "");
  return /^[a-f0-9]{24}$/i.test(bookingId) ? bookingId : null;
}

function timeMs(value) {
  const candidate = value instanceof Date ? value.getTime() : Number(value);
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : null;
}

function signaturesMatch(actual, expected) {
  const a = Buffer.from(String(actual || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function compactSignature(body) {
  return crypto.createHmac("sha256", secret()).update(body).digest().subarray(0, 12).toString("base64url");
}

function fullSignature(body) {
  return crypto.createHmac("sha256", secret()).update(body).digest("base64url");
}

/**
 * Boarding QR credential. This deliberately keeps the Task 8 compact v2
 * contract so public-link hardening cannot accidentally rewrite provider
 * check-in cryptography. Boardability remains a separate live lifecycle check.
 */
export function signTicketToken(booking) {
  const bookingId = bookingIdOf(booking);
  if (!bookingId) throw invalid();
  const body = "2." + bookingId;
  return body + "." + compactSignature(body);
}

/**
 * Boarding QR verifier. v1 remains supported for already-issued historical QR
 * codes; v2 is the current QR format. Public v3 link tokens are intentionally
 * not accepted here and therefore cannot become provider check-in credentials.
 */
export function verifyTicketToken(token) {
  const value = String(token || "");

  if (value.startsWith("2.")) {
    const parts = value.split(".");
    if (parts.length !== 3) throw invalid();
    const [version, bookingId, sig] = parts;
    if (version !== "2" || !/^[a-f0-9]{24}$/i.test(bookingId) || !sig) throw invalid();
    const body = "2." + bookingId;
    if (!signaturesMatch(sig, compactSignature(body))) throw invalid("Invalid ticket signature");
    return { v: 2, bookingId };
  }

  const parts = value.split(".");
  if (parts.length !== 2) throw invalid();
  const [body, sig] = parts;
  if (!body || !sig) throw invalid();
  if (!signaturesMatch(sig, fullSignature(body))) throw invalid("Invalid ticket signature");

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw invalid("Invalid ticket payload");
  }
  if (payload?.v !== 1 || !/^[a-f0-9]{24}$/i.test(String(payload.bookingId || ""))) {
    throw invalid("Invalid ticket payload");
  }
  return payload;
}

/**
 * Public bearer-link ceiling. There is intentionally no arbitrary grace: the
 * public credential is operational access and ends at the same planned end
 * already defined by Task 8 (startsAt + durationMinutes). Historical access is
 * available through authenticated customer booking history instead.
 */
export function publicTicketExpiry(booking) {
  const cutoff = ticketOperationalCutoff(booking);
  if (!cutoff) return null;
  const value = cutoff.getTime();
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * New public ticket bearer token: 3.<bookingId>.<iatMs>.<expMs>.<HMAC-SHA256>.
 * Payload data is deliberately minimal and readable; confidentiality is not
 * assumed. Only the server chooses iat/exp.
 */
export function signPublicTicketToken(booking, { now = Date.now() } = {}) {
  const bookingId = bookingIdOf(booking);
  const issuedAt = timeMs(now);
  const expiresAt = publicTicketExpiry(booking);
  if (!bookingId || issuedAt === null || expiresAt === null || issuedAt >= expiresAt) {
    throw publicLinkError("ticket_not_available", 404);
  }

  const body = `${PUBLIC_TICKET_VERSION}.${bookingId}.${issuedAt}.${expiresAt}`;
  return `${body}.${fullSignature(body)}`;
}

/**
 * Verify cryptographic integrity and token-level time bounds before loading the
 * referenced booking. Legacy QR/public tokens are returned only for the bounded
 * compatibility policy enforced after the booking lifecycle is loaded.
 */
export function verifyPublicTicketToken(token, { now = Date.now() } = {}) {
  const value = String(token || "").trim();
  const currentTime = timeMs(now);
  if (currentTime === null) throw publicLinkError("invalid_ticket_link");

  if (value.startsWith(`${PUBLIC_TICKET_VERSION}.`)) {
    const parts = value.split(".");
    if (parts.length !== 5) throw publicLinkError("invalid_ticket_link");
    const [version, bookingId, iatRaw, expRaw, sig] = parts;
    if (
      version !== String(PUBLIC_TICKET_VERSION) ||
      !/^[a-f0-9]{24}$/i.test(bookingId) ||
      !/^\d+$/.test(iatRaw) ||
      !/^\d+$/.test(expRaw) ||
      !sig
    ) {
      throw publicLinkError("invalid_ticket_link");
    }

    const body = `${version}.${bookingId}.${iatRaw}.${expRaw}`;
    if (!signaturesMatch(sig, fullSignature(body))) throw publicLinkError("invalid_ticket_link");

    const issuedAt = timeMs(iatRaw);
    const expiresAt = timeMs(expRaw);
    if (issuedAt === null || expiresAt === null || expiresAt <= issuedAt) {
      throw publicLinkError("invalid_ticket_link");
    }
    if (issuedAt > currentTime + PUBLIC_IAT_FUTURE_TOLERANCE_MS) {
      throw publicLinkError("invalid_ticket_link");
    }
    // Boundary contract: now < exp is accepted; exact exp and after are gone.
    if (currentTime >= expiresAt) throw publicLinkError("expired_ticket_link", 410);

    return { v: PUBLIC_TICKET_VERSION, kind: "public", bookingId, iat: issuedAt, exp: expiresAt };
  }

  // Controlled compatibility for already-issued v1/v2 links. Convert every
  // verifier failure to one public error so callers cannot distinguish signature,
  // payload, or resource-enumeration details.
  try {
    const payload = verifyTicketToken(value);
    return { ...payload, kind: "legacy_public", legacy: true };
  } catch {
    throw publicLinkError("invalid_ticket_link");
  }
}

/**
 * Enforce resource binding and the business maximum after the booking is loaded.
 * v3 cannot exceed the current planned end even with a valid signature. Legacy
 * public links have no embedded exp, so their bounded sunset is the planned end.
 */
export function enforcePublicTicketPolicy(payload, booking, { now = Date.now() } = {}) {
  const currentTime = timeMs(now);
  const expiresAt = publicTicketExpiry(booking);
  const bookingId = bookingIdOf(booking);
  if (currentTime === null || !bookingId || !payload || String(payload.bookingId || "") !== bookingId) {
    throw publicLinkError("invalid_ticket_link");
  }
  if (expiresAt === null) throw publicLinkError("ticket_not_available", 404);

  if (payload.v === PUBLIC_TICKET_VERSION) {
    if (!Number.isSafeInteger(payload.exp) || payload.exp > expiresAt) {
      throw publicLinkError("invalid_ticket_link");
    }
    if (currentTime >= Math.min(payload.exp, expiresAt)) {
      throw publicLinkError("expired_ticket_link", 410);
    }
    return true;
  }

  if (currentTime >= expiresAt) throw publicLinkError("expired_ticket_link", 410);
  return true;
}
