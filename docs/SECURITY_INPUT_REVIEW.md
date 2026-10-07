# Aqaba SeaGo — Input, XSS and CSRF Security Review

Reviewed: 2026-10-07

## Request input hardening

The API now rejects unsafe request keys centrally after JSON parsing and before normal API routes execute. The guard recursively rejects:

- keys containing `$` (Mongo operator-style input)
- dotted keys
- `__proto__`, `prototype`, and `constructor` keys

String values containing `$` remain allowed. The payment webhook route stays mounted before this middleware so its raw request body remains available for future provider signature verification.

Mutation routes additionally use bounded/type/allowed-field validation for high-risk booking, payment, support, and media payloads.

## Media uploads

Trip image data URLs are restricted to supported raster formats and checked against their binary signatures before cloud upload. SVG, malformed base64, MIME/signature mismatches, disguised text/script payloads, and oversized payloads are rejected.

## XSS review

Repository searches found no `dangerouslySetInnerHTML` or direct `innerHTML` sinks in the current customer, provider, or admin frontends. Current React text rendering therefore benefits from React's default escaping.

This is a scoped review, not a guarantee against every future XSS path. Any future raw-HTML rendering, rich-text editor, third-party HTML widget, or unsafe URL handling must receive a separate security review.

## CSRF assumptions

Current application authentication uses bearer JWTs rather than cookie-backed authenticated sessions. CORS is configured with `credentials: false`. Under this architecture, classic browser CSRF against authenticated mutations is materially reduced because browsers do not automatically attach bearer tokens to cross-site requests.

This conclusion must be revisited if authenticated cookies, session cookies, or credentialed cross-origin requests are introduced later.

## Automated regression coverage

Current tests cover:

- Mongo operator-style body keys
- dotted keys and prototype-pollution style keys
- operator-shaped query input
- legitimate `$` characters inside values
- request validation helper behavior
- image MIME/signature verification and upload size restrictions
- baseline HTTP security headers

These controls complement route-level authorization and do not replace authorization checks or selected-gateway webhook signature verification.
