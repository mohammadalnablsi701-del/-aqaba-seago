import crypto from "crypto";

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_DATA_URL_LENGTH = 4_000_000;
const MAX_IMAGE_BYTES = 3_000_000;

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

function detectedImageMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function validateTripImageDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw Object.assign(new Error(dataUrl?.length > MAX_IMAGE_DATA_URL_LENGTH ? "Image is too large" : "Invalid image payload"), {
      statusCode: dataUrl?.length > MAX_IMAGE_DATA_URL_LENGTH ? 413 : 400
    });
  }

  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) {
    throw Object.assign(new Error("Invalid image payload"), { statusCode: 400 });
  }

  const [, declaredMime, encoded] = match;
  if (!ALLOWED_IMAGE_MIMES.has(declaredMime) || encoded.length % 4 !== 0) {
    throw Object.assign(new Error("Only JPG, PNG and WebP are allowed"), { statusCode: 400 });
  }

  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) {
    throw Object.assign(new Error("Invalid image payload"), { statusCode: 400 });
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error("Image is too large"), { statusCode: 413 });
  }

  const detectedMime = detectedImageMime(buffer);
  if (!detectedMime || detectedMime !== declaredMime) {
    throw Object.assign(new Error("Image content does not match its declared type"), { statusCode: 400 });
  }

  return { mime: detectedMime, size: buffer.length };
}

export async function uploadTripImage(dataUrl, ownerId) {
  validateTripImageDataUrl(dataUrl);

  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `aqaba-seago/trips/${String(ownerId)}`;
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
