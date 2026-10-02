import { createMockProvider } from "./providers/mock.js";

export function getPaymentProvider(name) {
  const providerName = name || process.env.PAYMENT_PROVIDER || "mock";

  if (providerName === "mock") return createMockProvider();

  throw new Error(`Unsupported payment provider: ${providerName}`);
}
