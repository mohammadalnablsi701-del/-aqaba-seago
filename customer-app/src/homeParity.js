const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatCustomerDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return "";
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function customerHeroAssetUrl(baseUrl = "/", documentUrl = "http://localhost/") {
  const base = String(baseUrl || "/");
  const assetPath = `${base.endsWith("/") ? base : `${base}/`}aqaba-hero.jpg`;
  return new URL(assetPath, documentUrl).href;
}

export function syncCustomerDateInput(input) {
  if (!input) return 0;
  const valueHost = input.parentElement;
  const row = input.closest?.(".search-row");
  if (!valueHost?.dataset || !row?.classList) return 0;

  let writes = 0;
  if (!row.classList.contains("search-row--date")) {
    row.classList.add("search-row--date");
    writes += 1;
  }

  const display = formatCustomerDate(input.value);
  if (valueHost.dataset.seagoDateDisplay !== display) {
    valueHost.dataset.seagoDateDisplay = display;
    writes += 1;
  }
  return writes;
}

export function syncCustomerDateDisplay(root = document) {
  let writes = 0;
  root.querySelectorAll?.('.search-card input[type="date"]').forEach((input) => {
    writes += syncCustomerDateInput(input);
  });
  return writes;
}

export function enableCustomerHomeParity(root = document) {
  const mount = root.getElementById?.("root") || root;
  const sync = () => syncCustomerDateDisplay(root);
  const onDateInput = (event) => {
    if (event.target?.matches?.('.search-card input[type="date"]')) {
      syncCustomerDateInput(event.target);
    }
  };

  sync();
  if (!mount?.addEventListener || typeof MutationObserver === "undefined") return () => {};

  mount.addEventListener("input", onDateInput, true);
  mount.addEventListener("change", onDateInput, true);
  const observer = new MutationObserver(sync);
  observer.observe(mount, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    mount.removeEventListener("input", onDateInput, true);
    mount.removeEventListener("change", onDateInput, true);
  };
}
