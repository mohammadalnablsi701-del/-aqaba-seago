// Public app identity, never credentials. Phase 1 is Android only.
export const NATIVE_PUSH_CONTEXT = Object.freeze({
  platform: "android",
  provider: "fcm",
  appId: "com.aqabaseago.app",
  firebaseProjectId: "aqaba-seago-7c92",
  firebaseAppId: "1:173154283669:android:3553d4df3e888968772b9c"
});

export function matchesNativePushContext(value) {
  return Object.entries(NATIVE_PUSH_CONTEXT).every(([key, expected]) => value?.[key] === expected);
}
