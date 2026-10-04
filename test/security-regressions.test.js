import test from "node:test";
import assert from "node:assert/strict";
import { normalizeJordanPhone } from "../src/services/phoneOtp.js";
import { isAllowedPushEndpoint } from "../src/services/push.js";
import { isSuccessfulTerminalPaymentStatus } from "../src/services/payments.js";

test("normalizes valid Jordan mobile numbers",()=>{
  assert.equal(normalizeJordanPhone("0791234567"),"+962791234567");
  assert.equal(normalizeJordanPhone("791234567"),"+962791234567");
  assert.equal(normalizeJordanPhone("+962791234567"),"+962791234567");
});

test("rejects malformed Jordan numbers",()=>{
  assert.equal(normalizeJordanPhone("+962"),"");
  assert.equal(normalizeJordanPhone("+96279123456789"),"");
  assert.equal(normalizeJordanPhone("962612345678"),"");
});

test("allows known browser push services",()=>{
  assert.equal(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/example"),true);
  assert.equal(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/example"),true);
  assert.equal(isAllowedPushEndpoint("https://web.push.apple.com/Qexample"),true);
});

test("blocks unsafe push destinations",()=>{
  assert.equal(isAllowedPushEndpoint("http://127.0.0.1:8080/test"),false);
  assert.equal(isAllowedPushEndpoint("https://localhost/test"),false);
  assert.equal(isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data"),false);
  assert.equal(isAllowedPushEndpoint("https://example.com/push"),false);
});

test("successful payment states are terminal against failure regressions",()=>{
  assert.equal(isSuccessfulTerminalPaymentStatus("paid"),true);
  assert.equal(isSuccessfulTerminalPaymentStatus("partially_refunded"),true);
  assert.equal(isSuccessfulTerminalPaymentStatus("refunded"),true);
  assert.equal(isSuccessfulTerminalPaymentStatus("pending"),false);
  assert.equal(isSuccessfulTerminalPaymentStatus("failed"),false);
});
