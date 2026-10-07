function boundedToken(value, maxLength = 80) {
  const token = String(value || "").trim();
  if (!token || !/^[A-Za-z0-9_.:-]+$/.test(token)) return undefined;
  return token.slice(0, maxLength);
}

export function productionErrorMetadata(err) {
  const statusCode = Number(err?.statusCode || err?.status || 500);
  const safeStatusCode = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500;

  const metadata = {
    event: "request_error",
    statusCode: safeStatusCode,
    errorName: boundedToken(err?.name, 60) || "Error",
    at: new Date().toISOString()
  };

  const code = boundedToken(err?.code, 80);
  if (code) metadata.code = code;
  return metadata;
}

export function logRequestError(err) {
  if (process.env.NODE_ENV === "production") {
    console.error(JSON.stringify(productionErrorMetadata(err)));
    return;
  }
  console.error(err);
}
