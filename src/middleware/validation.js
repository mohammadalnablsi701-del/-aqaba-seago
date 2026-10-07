export function isPlainObject(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function validateAllowedFields(body, allowedFields) {
  if (!isPlainObject(body)) return "Request body must be a JSON object";
  const allowed = allowedFields instanceof Set ? allowedFields : new Set(allowedFields);
  const unknown = Object.keys(body).find(key => !allowed.has(key));
  return unknown ? `Unexpected field: ${unknown}` : null;
}

export function isBoundedString(value, { min = 0, max = 1000, optional = false } = {}) {
  if (value === undefined && optional) return true;
  if (typeof value !== "string") return false;
  const text = value.trim();
  return text.length >= min && text.length <= max;
}

export function isIntegerInRange(value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function isOneOf(value, values, { optional = false } = {}) {
  if (value === undefined && optional) return true;
  return values.includes(value);
}
