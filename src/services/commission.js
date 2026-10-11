export const SUPPORTED_COMMISSION_TYPES = Object.freeze([
  "percentage",
  "fixed_per_person",
  "fixed_per_booking"
]);

const SUPPORTED_TYPES = new Set(SUPPORTED_COMMISSION_TYPES);
const TIER_KEYS = ["adultCommission","childCommission","buffetAdultCommission","buffetChildCommission"];
const MAX_FIXED_COMMISSION = Number.MAX_SAFE_INTEGER;

export class InvalidCommissionConfiguration extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidCommissionConfiguration";
    this.code = "financial_config_invalid";
    this.statusCode = 503;
    this.publicMessage = "Unable to complete booking right now";
  }
}

function invalid(message) {
  throw new InvalidCommissionConfiguration(message);
}

function present(value) {
  return value !== undefined && value !== null;
}

function strictAmount(value, label, { max = MAX_FIXED_COMMISSION, maxDecimals = 2 } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    invalid(`${label} is invalid`);
  }
  const factor = 10 ** maxDecimals;
  if (Math.abs(value * factor - Math.round(value * factor)) > 1e-8) {
    invalid(`${label} supports up to ${maxDecimals} decimal places`);
  }
  return value;
}

export function validateCommissionConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    invalid("Commission configuration is missing or malformed");
  }

  const commissionType = config.commissionType;
  if (typeof commissionType !== "string" || !SUPPORTED_TYPES.has(commissionType)) {
    invalid("Unsupported commission type");
  }

  if (!present(config.commissionValue)) {
    invalid("Commission value is required");
  }
  const commissionValue = strictAmount(
    config.commissionValue,
    commissionType === "percentage" ? "Commission percentage" : "Commission value",
    { max: commissionType === "percentage" ? 100 : MAX_FIXED_COMMISSION }
  );

  const validated = { commissionType, commissionValue };
  if (commissionType !== "fixed_per_person") return validated;

  for (const key of TIER_KEYS) {
    if (present(config[key])) validated[key] = strictAmount(config[key], key);
  }

  const adultPresent = present(validated.adultCommission);
  const childPresent = present(validated.childCommission);
  const buffetAdultPresent = present(validated.buffetAdultCommission);
  const buffetChildPresent = present(validated.buffetChildCommission);

  if (adultPresent !== childPresent) {
    invalid("Adult and child commissions must be configured together");
  }
  if (buffetAdultPresent !== buffetChildPresent) {
    invalid("Buffet adult and child commissions must be configured together");
  }
  if (buffetAdultPresent && !adultPresent) {
    invalid("Buffet commission tiers require adult and child commission tiers");
  }

  return validated;
}

export function fixedPerPersonRates(config, { buffet = false } = {}) {
  const validated = validateCommissionConfig(config);
  if (validated.commissionType !== "fixed_per_person") {
    invalid("Fixed per-person commission configuration is required");
  }
  return {
    adultCommission: buffet
      ? (validated.buffetAdultCommission ?? validated.adultCommission ?? validated.commissionValue)
      : (validated.adultCommission ?? validated.commissionValue),
    childCommission: buffet
      ? (validated.buffetChildCommission ?? validated.childCommission ?? validated.commissionValue)
      : (validated.childCommission ?? validated.commissionValue)
  };
}
