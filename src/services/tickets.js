import crypto from "node:crypto";

function secret() {
  const value = process.env.TICKET_SIGNING_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error("TICKET_SIGNING_SECRET or JWT_SECRET is required");
  return value;
}

function invalid(message="Invalid ticket") {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function signTicketToken(booking) {
  const bookingId=booking._id.toString();
  const body="2."+bookingId;
  const sig=crypto.createHmac("sha256", secret()).update(body).digest().subarray(0,12).toString("base64url");
  return body+"."+sig;
}

export function verifyTicketToken(token) {
  const value=String(token||"");

  // Compact v2 token: 2.<24-char Mongo booking id>.<96-bit HMAC>
  if(value.startsWith("2.")){
    const [version,bookingId,sig]=value.split(".");
    if(version!=="2"||!/^[a-f0-9]{24}$/i.test(bookingId)||!sig) throw invalid();
    const body="2."+bookingId;
    const expected=crypto.createHmac("sha256", secret()).update(body).digest().subarray(0,12).toString("base64url");
    const a=Buffer.from(sig);
    const b=Buffer.from(expected);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) throw invalid("Invalid ticket signature");
    return {v:2,bookingId};
  }

  // Legacy v1 support for already-issued QR codes.
  const [body, sig] = value.split(".");
  if (!body || !sig) throw invalid();
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw invalid("Invalid ticket signature");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (payload.v !== 1 || !payload.bookingId) throw invalid("Invalid ticket payload");
  return payload;
}
