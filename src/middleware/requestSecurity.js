const forbiddenPrototypeKeys = new Set(["__proto__", "prototype", "constructor"]);

function hasUnsafeKey(value) {
  if (value == null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasUnsafeKey);

  for (const [key, child] of Object.entries(value)) {
    if (key.includes("$") || key.includes(".") || forbiddenPrototypeKeys.has(key)) return true;
    if (hasUnsafeKey(child)) return true;
  }
  return false;
}

export function rejectUnsafeRequestKeys(req, res, next) {
  if (hasUnsafeKey(req.body) || hasUnsafeKey(req.query) || hasUnsafeKey(req.params)) {
    return res.status(400).json({ error: "Invalid request field" });
  }
  next();
}

export { hasUnsafeKey };
