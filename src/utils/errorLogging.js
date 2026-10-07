function boundedToken(value, maxLength = 80) {
  const token = String(value || "").trim();
  if (!token || !/^[A-Za-z0-9_.:-]+$/.test(token)) return undefined;
  return token.slice(0, maxLength);
}

function normalizeStatusCode(err) {
  const statusCode = Number(err?.statusCode || err?.status || 500);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500;
}

export function productionErrorMetadata(err) {
  const metadata = {
    event: "request_error",
    statusCode: normalizeStatusCode(err),
    errorName: boundedToken(err?.name, 60) || "Error",
    at: new Date().toISOString()
  };

  const code = boundedToken(err?.code, 80);
  if (code) metadata.code = code;
  return metadata;
}

export function publicErrorResponse(err) {
  const statusCode = normalizeStatusCode(err);
  if (statusCode >= 500) {
    return { statusCode, error: "Internal server error" };
  }

  const rawMessage = String(err?.message || "Request rejected")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  const error = (rawMessage || "Request rejected").slice(0, 240);
  return { statusCode, error };
}

export function logRequestError(err) {
  if (process.env.NODE_ENV === "production") {
    console.error(JSON.stringify(productionErrorMetadata(err)));
    return;
  }
  console.error(err);
}
