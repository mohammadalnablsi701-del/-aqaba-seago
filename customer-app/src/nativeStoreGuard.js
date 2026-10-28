export const NATIVE_STORE_AUTH_COPY = "Use your email and password to continue securely.";

export function syncNativeStorePanel(panel) {
  const google = panel.querySelector(".google-auth-wrap");
  const divider = panel.querySelector(".auth-divider");
  if (google && google.style.display !== "none") google.style.display = "none";
  if (divider && divider.style.display !== "none") divider.style.display = "none";
  const copy = panel.querySelector(".auth-panel__head p");
  if (copy && copy.textContent !== NATIVE_STORE_AUTH_COPY) copy.textContent = NATIVE_STORE_AUTH_COPY;
}

export function syncNativeStorePanels(root = document) {
  root.querySelectorAll(".auth-panel").forEach(syncNativeStorePanel);
}
