import crypto from "node:crypto";

function secret() {
  const value = process.env.TICKET_SIGNING_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error("TICKET_SIGNING_SECRET or JWT_SECRET is required");
  return value;
}

export function signTicketToken(booking) {
  const payload = JSON.stringify({
    v: 1,
    bookingId: booking._id.toString(),
    departureId: booking.departureId?._id?.toString?.() || booking.departureId?.toString?.() || "",
    seats: booking.seats,
    issuedAt: Math.floor(Date.now() / 1000)
  });
  const body = Buffer.from(payload).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + sig;
}

export function verifyTicketToken(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) throw Object.assign(new Error("Invalid ticket"), { statusCode: 400 });
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw Object.assign(new Error("Invalid ticket signature"), { statusCode: 400 });
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (payload.v !== 1 || !payload.bookingId) {
    throw Object.assign(new Error("Invalid ticket payload"), { statusCode: 400 });
  }
  return payload;
}
