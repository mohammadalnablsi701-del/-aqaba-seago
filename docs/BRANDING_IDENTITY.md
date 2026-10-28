# Aqaba SeaGo branding identity

The Customer and Provider experiences intentionally use related but clearly distinct app identities:

- Customer: light marine background with blue helm, yacht, sun, birds and cyan/blue waves.
- Provider: dark navy marine background with white helm/yacht, sun, birds and cyan/blue waves.

Production source-of-truth:

- Customer native Android/iOS: `customer-app/assets/logo.svg`
- Customer web/PWA: `customer-app/public/app-customer.svg`, plus 192×192 and 512×512 raster fallbacks and a dedicated 180×180 Apple Touch PNG.
- Provider web/PWA: `provider-app/public/app-provider.svg`, plus 192×192 and 512×512 raster fallbacks and a dedicated 180×180 Apple Touch PNG.

Do not bake operating-system corner masks into the master artwork. Android/iOS/browser surfaces own the final mask shape.
