import crypto from "node:crypto";
import PasswordResetToken from "../models/PasswordResetToken.js";

const DEFAULT_RESET_MINUTES = 30;

function resetMinutes() {
  const value = Number(process.env.PASSWORD_RESET_MINUTES || DEFAULT_RESET_MINUTES);
  if (!Number.isFinite(value)) return DEFAULT_RESET_MINUTES;
  return Math.min(60, Math.max(10, Math.floor(value)));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function frontendBaseUrl() {
  return String(process.env.FRONTEND_BASE_URL || "https://mohammadalnablsi701-del.github.io/-aqaba-seago").replace(/\/$/, "");
}

export async function issuePasswordReset(user) {
  await PasswordResetToken.deleteMany({ userId: user._id, usedAt: null });

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + resetMinutes() * 60_000);
  await PasswordResetToken.create({ userId: user._id, tokenHash: hashToken(rawToken), expiresAt });

  const delivered = await sendPasswordResetEmail({ to: user.email, token: rawToken });
  return { delivered, expiresAt };
}

export async function claimPasswordResetToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;

  return PasswordResetToken.findOneAndUpdate(
    { tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: false }
  );
}

export async function invalidatePasswordResetTokens(userId) {
  await PasswordResetToken.deleteMany({ userId });
}

async function sendPasswordResetEmail({ to, token }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = process.env.EMAIL_FROM || "Aqaba SeaGo <onboarding@resend.dev>";
  if (!apiKey || !to) return false;

  const resetUrl = `${frontendBaseUrl()}/?resetToken=${encodeURIComponent(token)}`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#15364b"><div style="max-width:620px;margin:auto;padding:24px"><h1>Aqaba SeaGo</h1><p>A password reset was requested for your account.</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 16px;background:#0b6fa4;color:#fff;text-decoration:none;border-radius:10px">Reset password</a></p><p>This link expires in ${resetMinutes()} minutes and can be used once.</p><p>If you did not request this, you can ignore this email.</p></div></body></html>`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: "Aqaba SeaGo — Reset your password", html })
    });
    if (!response.ok) {
      console.error(JSON.stringify({ event: "password_reset_email_failure", statusCode: response.status, at: new Date().toISOString() }));
      return false;
    }
    return true;
  } catch {
    console.error(JSON.stringify({ event: "password_reset_email_failure", statusCode: 503, at: new Date().toISOString() }));
    return false;
  }
}

export const passwordRecoveryInternals = { hashToken, resetMinutes };
