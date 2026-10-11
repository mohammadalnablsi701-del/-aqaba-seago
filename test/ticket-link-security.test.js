import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  enforcePublicTicketPolicy,
  publicTicketExpiry,
  signPublicTicketToken,
  signTicketToken,
  verifyPublicTicketToken,
  verifyTicketToken
} from "../src/services/tickets.js";

const SECRET = "task9-ticket-link-test-secret-at-least-32-characters";
const BOOKING_ID = "507f1f77bcf86cd799439011";
const OTHER_BOOKING_ID = "507f191e810c19729de860ea";
const START = Date.parse("2030-01-01T10:00:00.000Z");
const END = Date.parse("2030-01-01T11:00:00.000Z");
const ISSUED = Date.parse("2030-01-01T09:00:00.000Z");

function booking({ id = BOOKING_ID, startsAt = new Date(START), durationMinutes = 60 } = {}) {
  return {
    _id: id,
    tripId: durationMinutes === undefined ? {} : { durationMinutes },
    departureId: startsAt === undefined ? { status: "scheduled" } : { startsAt, status: "scheduled" }
  };
}

function signedPublicBody(body) {
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("Expected function to throw");
}

test("public ticket v3 is signed, minimal, resource-bound and expires at planned end", t => {
  const oldTicketSecret = process.env.TICKET_SIGNING_SECRET;
  const oldJwtSecret = process.env.JWT_SECRET;
  process.env.TICKET_SIGNING_SECRET = SECRET;
  process.env.JWT_SECRET = SECRET;
  t.after(() => {
    if (oldTicketSecret === undefined) delete process.env.TICKET_SIGNING_SECRET; else process.env.TICKET_SIGNING_SECRET = oldTicketSecret;
    if (oldJwtSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldJwtSecret;
  });

  const source = booking();
  assert.equal(publicTicketExpiry(source), END);

  const token = signPublicTicketToken(source, { now: ISSUED });
  const parts = token.split(".");
  assert.equal(parts.length, 5);
  assert.equal(parts[0], "3");
  assert.equal(parts[1], BOOKING_ID);
  assert.equal(Number(parts[2]), ISSUED);
  assert.equal(Number(parts[3]), END);
  assert.match(parts[4], /^[A-Za-z0-9_-]+$/);
  assert.equal(token.includes("customer"), false);
  assert.equal(token.includes("email"), false);

  const before = verifyPublicTicketToken(token, { now: END - 1 });
  assert.deepEqual(before, { v: 3, kind: "public", bookingId: BOOKING_ID, iat: ISSUED, exp: END });
  assert.equal(enforcePublicTicketPolicy(before, source, { now: END - 1 }), true);

  const atExpiry = captureError(() => verifyPublicTicketToken(token, { now: END }));
  assert.equal(atExpiry.code, "expired_ticket_link");
  assert.equal(atExpiry.statusCode, 410);

  const afterExpiry = captureError(() => verifyPublicTicketToken(token, { now: END + 1 }));
  assert.equal(afterExpiry.code, "expired_ticket_link");

  const tamperedExpiry = [...parts];
  tamperedExpiry[3] = String(END + 1);
  assert.equal(captureError(() => verifyPublicTicketToken(tamperedExpiry.join("."), { now: ISSUED })).code, "invalid_ticket_link");

  const tamperedResource = [...parts];
  tamperedResource[1] = OTHER_BOOKING_ID;
  assert.equal(captureError(() => verifyPublicTicketToken(tamperedResource.join("."), { now: ISSUED })).code, "invalid_ticket_link");

  const wrongBooking = booking({ id: OTHER_BOOKING_ID });
  assert.equal(captureError(() => enforcePublicTicketPolicy(before, wrongBooking, { now: ISSUED })).code, "invalid_ticket_link");

  assert.equal(captureError(() => verifyPublicTicketToken(`3.${BOOKING_ID}.${ISSUED}`, { now: ISSUED })).code, "invalid_ticket_link");
  assert.equal(captureError(() => verifyPublicTicketToken(`3.${BOOKING_ID}.${ISSUED}.NaN.signature`, { now: ISSUED })).code, "invalid_ticket_link");

  const oversizedBody = `3.${BOOKING_ID}.${ISSUED}.${END + 86400000}`;
  const oversizedToken = signedPublicBody(oversizedBody);
  const oversizedPayload = verifyPublicTicketToken(oversizedToken, { now: ISSUED });
  assert.equal(captureError(() => enforcePublicTicketPolicy(oversizedPayload, source, { now: ISSUED })).code, "invalid_ticket_link");

  const futureIssuedBody = `3.${BOOKING_ID}.${ISSUED + 120000}.${END}`;
  const futureIssuedToken = signedPublicBody(futureIssuedBody);
  assert.equal(captureError(() => verifyPublicTicketToken(futureIssuedToken, { now: ISSUED })).code, "invalid_ticket_link");
});

test("public issuance fails closed without valid lifecycle clock data", t => {
  const oldTicketSecret = process.env.TICKET_SIGNING_SECRET;
  process.env.TICKET_SIGNING_SECRET = SECRET;
  t.after(() => {
    if (oldTicketSecret === undefined) delete process.env.TICKET_SIGNING_SECRET; else process.env.TICKET_SIGNING_SECRET = oldTicketSecret;
  });

  const missingStart = booking({ startsAt: undefined });
  const missingDuration = booking({ durationMinutes: undefined });
  const invalidDuration = booking({ durationMinutes: "not-a-number" });

  for (const source of [missingStart, missingDuration, invalidDuration]) {
    const error = captureError(() => signPublicTicketToken(source, { now: ISSUED }));
    assert.equal(error.code, "ticket_not_available");
    assert.equal(error.statusCode, 404);
  }
});

test("legacy public links have a bounded planned-end sunset while boarding QR stays separate", t => {
  const oldTicketSecret = process.env.TICKET_SIGNING_SECRET;
  const oldJwtSecret = process.env.JWT_SECRET;
  process.env.TICKET_SIGNING_SECRET = SECRET;
  process.env.JWT_SECRET = SECRET;
  t.after(() => {
    if (oldTicketSecret === undefined) delete process.env.TICKET_SIGNING_SECRET; else process.env.TICKET_SIGNING_SECRET = oldTicketSecret;
    if (oldJwtSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldJwtSecret;
  });

  const source = booking();
  const boardingToken = signTicketToken(source);
  const legacyPayload = verifyPublicTicketToken(boardingToken, { now: ISSUED });
  assert.equal(legacyPayload.v, 2);
  assert.equal(legacyPayload.legacy, true);
  assert.equal(enforcePublicTicketPolicy(legacyPayload, source, { now: END - 1 }), true);

  const legacyExpired = captureError(() => enforcePublicTicketPolicy(legacyPayload, source, { now: END }));
  assert.equal(legacyExpired.code, "expired_ticket_link");
  assert.equal(legacyExpired.statusCode, 410);

  const publicToken = signPublicTicketToken(source, { now: ISSUED });
  assert.equal(publicToken.startsWith("3."), true, "new public issuance must never emit legacy indefinite tokens");
  assert.equal(verifyTicketToken(boardingToken).v, 2);
  assert.equal(captureError(() => verifyTicketToken(publicToken)).statusCode, 400, "public links must not authenticate as boarding QR tokens");
});
