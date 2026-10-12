import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../customer-app/src/App.jsx", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../customer-app/src/main.jsx", import.meta.url), "utf8");
const nativeCss = fs.readFileSync(new URL("../customer-app/src/native-parity.css", import.meta.url), "utf8");

test("unauthenticated booking continues to AuthForm instead of payment", () => {
  assert.match(app, /if\(!auth\?\.token\) return setError\("AUTH_REQUIRED"\)/);
  assert.match(app, /if\(error==="AUTH_REQUIRED"\)[\s\S]{0,700}<AuthForm onAuthenticated=/);
});

test("email/password login controls and submit path remain wired", () => {
  assert.match(app, /<form onSubmit=\{submit\}>/);
  assert.match(app, /<input type="email"[^>]*value=\{form\.email\}/);
  assert.match(app, /<input type="password"[^>]*value=\{form\.password\}/);
  assert.match(app, /className="primary-button auth-submit"/);
  assert.match(app, /mode === "login"[\s\S]{0,120}await loginCustomer\(\{email:form\.email,password:form\.password\}\)/);
});

test("native runtime fix contains no speculative touch workaround", () => {
  assert.doesNotMatch(main, /native-touch-fix/);
  assert.doesNotMatch(nativeCss, /pointer-events|touch-action/i);
});
