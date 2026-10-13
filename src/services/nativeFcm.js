import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import NativePushToken from "../models/NativePushToken.js";
import User from "../models/User.js";
import { NATIVE_PUSH_CONTEXT } from "../../shared/nativePushContext.js";
import { credentialFingerprint, minimizedPushEnvelope } from "../utils/notificationPrivacy.js";

export function fcmEnabled(env = process.env) { return env.FCM_ENABLED === "true"; }
const empty = () => ({sent:0,failed:0,skipped:true,permanentFailures:0,transientFailures:0});

export async function probeNativeFcmCredentials(env = process.env, {credentialFactory = cert} = {}) {
  const result = {
    event:"fcm_credential_probe",
    credential_present:Boolean(env.GOOGLE_APPLICATION_CREDENTIALS),
    env_project_ok:env.FIREBASE_PROJECT_ID === NATIVE_PUSH_CONTEXT.firebaseProjectId,
    credential_project_ok:false,
    service_account_type_ok:false,
    client_email_present:false,
    private_key_present:false,
    private_key_parseable:false,
    google_auth_ok:false
  };
  if (!result.credential_present) return result;
  try {
    const key = JSON.parse(readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
    result.credential_project_ok = key.project_id === NATIVE_PUSH_CONTEXT.firebaseProjectId;
    result.service_account_type_ok = key.type === "service_account";
    result.client_email_present = typeof key.client_email === "string" && key.client_email.trim().length > 0;
    result.private_key_present = typeof key.private_key === "string" && key.private_key.length > 0;
    if (result.private_key_present) {
      try {
        createPrivateKey(key.private_key);
        result.private_key_parseable = true;
      } catch {}
    }
    if (!(result.env_project_ok && result.credential_project_ok && result.service_account_type_ok && result.client_email_present && result.private_key_parseable)) {
      return result;
    }
    const token = await credentialFactory(key).getAccessToken();
    result.google_auth_ok = Boolean(token?.access_token);
  } catch {}
  return result;
}

export function configuredMessaging(env = process.env) {
  // Do not fall back to a developer's ambient Google credentials or another project.
  if (env.FIREBASE_PROJECT_ID !== NATIVE_PUSH_CONTEXT.firebaseProjectId || !env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("fcm_configuration_invalid");
  }
  const name = "seago-customer-android";
  let app = getApps().find(item => item.name === name);
  if (!app) {
    try {
      const key = JSON.parse(readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
      if (key.type !== "service_account" || key.project_id !== NATIVE_PUSH_CONTEXT.firebaseProjectId || !key.client_email || !key.private_key) {
        throw new Error();
      }
      app = initializeApp({credential:cert(key),projectId:NATIVE_PUSH_CONTEXT.firebaseProjectId}, name);
    } catch { throw new Error("fcm_configuration_invalid"); }
  }
  return getMessaging(app);
}

export function validateNativeFcmStartup(env = process.env) {
  if (!fcmEnabled(env)) return {enabled:false,ready:true};
  try {
    configuredMessaging(env);
    return {enabled:true,ready:true};
  } catch {
    throw new Error("fcm_configuration_invalid");
  }
}

export function nativeFailure(code) {
  if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(code)) return "fcm_token_invalid";
  if (["messaging/server-unavailable", "messaging/internal-error", "messaging/quota-exceeded", "messaging/unknown-error"].includes(code)) return "fcm_delivery_transient";
  // Invalid payloads, credentials and project mismatch are NOT proof that a token is dead.
  return "fcm_delivery_failed";
}

export async function sendNativePushToUser(userId, payload, {
  env = process.env, tokens = NativePushToken, users = User,
  messaging = configuredMessaging, log = record => console.warn(JSON.stringify(record))
} = {}) {
  if (!userId || !fcmEnabled(env)) return empty();
  const customer = await users.findOne({_id:userId,role:"customer",isActive:true});
  if (!customer) return empty();
  let sender;
  try { sender = messaging(env); }
  catch {
    log({event:"push_delivery",channel:"android_fcm",result:"skipped",code:"fcm_configuration_invalid"});
    return {...empty(),code:"fcm_configuration_invalid"};
  }
  const context = {...NATIVE_PUSH_CONTEXT,userId};
  const rows = await tokens.find(context);
  const result = {...empty(),skipped:false};
  const envelope = minimizedPushEnvelope({data:payload?.data,notificationId:payload?.data?.notificationId});
  for (const row of rows) {
    // Compare-and-delete/update prevents an in-flight response removing a refreshed binding.
    const binding = {...context,_id:row._id,token:row.token,installationId:row.installationId};
    try {
      await sender.send({
        token:row.token,
        notification:{title:envelope.title,body:envelope.body},
        data:envelope.data,
        android:{restrictedPackageName:NATIVE_PUSH_CONTEXT.appId,notification:{channelId:"seago_updates"}}
      });
      result.sent++;
    } catch (error) {
      result.failed++;
      const code = nativeFailure(error?.code);
      if (code === "fcm_token_invalid") {
        await tokens.deleteOne(binding);
        result.permanentFailures++;
      } else result.transientFailures++;
      log({event:"push_delivery",channel:"android_fcm",result:code === "fcm_token_invalid" ? "revoked" : "failed",code,credentialFingerprint:credentialFingerprint(row.token)});
      continue;
    }
    try{await tokens.updateOne(binding,{$set:{lastUsedAt:new Date()}});}
    catch{
      log({event:"push_delivery",channel:"android_fcm",result:"sent",code:"fcm_last_used_update_failed",credentialFingerprint:credentialFingerprint(row.token)});
    }
  }
  return result;
}
