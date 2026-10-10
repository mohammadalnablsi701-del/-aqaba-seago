// Customer-facing payment status contract.
// Keep this as an explicit whitelist: persistence/gateway fields must never flow
// to the browser automatically when the Payment schema grows.
export function toCustomerPaymentDto(payment) {
  return {
    status: payment.status,
    bookingId: payment.bookingId ? String(payment.bookingId) : null
  };
}
