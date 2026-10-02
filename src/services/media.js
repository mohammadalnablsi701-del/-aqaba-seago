import crypto from "crypto";

function cloudinaryConfig() {
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  const apiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();
  if (!cloudName || !apiKey || !apiSecret) {
    throw Object.assign(new Error("Cloud image storage is not configured"), { statusCode: 503 });
  }
  return { cloudName, apiKey, apiSecret };
}

function sign(params, secret) {
  const base = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + secret;
  return crypto.createHash("sha1").update(base).digest("hex");
}

export async function uploadTripImage(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw Object.assign(new Error("Invalid image payload"), { statusCode: 400 });
  }
  if (dataUrl.length > 4_000_000) {
    throw Object.assign(new Error("Image is too large"), { statusCode: 413 });
  }
  const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
  if (!["image/jpeg","image/png","image/webp"].includes(mime)) {
    throw Object.assign(new Error("Only JPG, PNG and WebP are allowed"), { statusCode: 400 });
  }

  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "aqaba-seago/trips";
  const params = { folder, timestamp };
  const signature = sign(params, apiSecret);

  const body = new URLSearchParams({
    file: dataUrl,
    api_key: apiKey,
    timestamp: String(timestamp),
    folder,
    signature
  });

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(json?.error?.message || "Image upload failed"), { statusCode: 502 });
  }

  return {
    url: json.secure_url,
    publicId: json.public_id,
    source: "cloudinary",
    width: json.width,
    height: json.height
  };
}

export async function deleteTripImage(publicId) {
  if (!publicId) return { deleted: false };
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { public_id: publicId, timestamp };
  const signature = sign(params, apiSecret);

  const body = new URLSearchParams({
    public_id: publicId,
    api_key: apiKey,
    timestamp: String(timestamp),
    signature
  });

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(json?.error?.message || "Image delete failed"), { statusCode: 502 });
  }
  return { deleted: json.result === "ok" || json.result === "not found", result: json.result };
}
