// Retired one-time migration.
//
// Historical pilot code used this helper to convert selected providers to a
// blanket 20% commission. That assumption is no longer valid: current pilot
// providers use explicitly approved commission models, and Aladdin remains
// activation-blocked pending operator confirmation.
//
// Keep the export as a fail-closed no-op so any stale/manual caller cannot
// mutate business data accidentally.
export async function applyCommission20Migration(){
  return {skipped:true,reason:"retired"};
}
