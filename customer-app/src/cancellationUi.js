import { cancelBooking, getCancellationPolicy, listBookings } from "./api.js";
import { formatServerMoney } from "./pricingTruth.js";
import {
  cancellationDialogModel,
  cancellationErrorCopy,
  isSelfServiceCancellationEligible,
  normalizeCancellationPolicy,
  refundStatusPresentation
} from "./cancellationPresentation.js";

function readAuth() {
  try { return JSON.parse(localStorage.getItem("seago_auth") || "null"); }
  catch { return null; }
}

function bookingReference(bookingId) {
  return `SG-${String(bookingId || "").slice(-8).toUpperCase()}`;
}

function departureCopy(value) {
  if (!value) return "TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBA";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Amman",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function makeButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function ticketReferenceFromCard(card) {
  return [...card.querySelectorAll(".ticket-card__footer strong")]
    .map(node => node.textContent?.trim().toUpperCase())
    .find(value => /^SG-[A-F0-9]{8}$/.test(value || "")) || null;
}

function createCancellationModal({ booking, auth, trigger, onTruthChanged }) {
  const layer = document.createElement("div");
  layer.className = "cancellation-modal-layer";
  layer.dataset.seagoCancellationModal = "1";

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "cancellation-modal-backdrop";
  backdrop.setAttribute("aria-label", "Keep booking and close cancellation dialog");

  const dialog = document.createElement("section");
  dialog.className = "cancellation-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "seago-cancellation-title");

  const header = document.createElement("div");
  header.className = "cancellation-modal__header";
  const eyebrow = document.createElement("span");
  eyebrow.textContent = "CANCELLATION";
  const title = document.createElement("h2");
  title.id = "seago-cancellation-title";
  title.textContent = "Cancel this booking?";
  const warning = document.createElement("p");
  warning.textContent = "Review the current cancellation policy before confirming. This action cannot be undone.";
  header.append(eyebrow, title, warning);

  const summary = document.createElement("div");
  summary.className = "cancellation-modal__summary";
  const tripRow = document.createElement("div");
  const tripLabel = document.createElement("small");
  tripLabel.textContent = "Trip";
  const tripValue = document.createElement("strong");
  tripValue.textContent = booking.tripId?.titleEn || booking.tripId?.titleAr || "Aqaba Sea Experience";
  tripRow.append(tripLabel, tripValue);
  const departureRow = document.createElement("div");
  const departureLabel = document.createElement("small");
  departureLabel.textContent = "Departure";
  const departureValue = document.createElement("strong");
  departureValue.textContent = departureCopy(booking.departureId?.startsAt);
  departureRow.append(departureLabel, departureValue);
  summary.append(tripRow, departureRow);

  const content = document.createElement("div");
  content.className = "cancellation-modal__content";
  const actions = document.createElement("div");
  actions.className = "cancellation-modal__actions";
  dialog.append(header, summary, content, actions);
  layer.append(backdrop, dialog);
  document.body.appendChild(layer);

  let policy = null;
  let submitting = false;
  let completed = false;
  let closed = false;

  function close() {
    if (submitting || closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeyDown);
    layer.remove();
    if (trigger?.isConnected) trigger.focus();
  }

  function onKeyDown(event) {
    if (event.key === "Escape" && !submitting) close();
  }
  document.addEventListener("keydown", onKeyDown);
  backdrop.addEventListener("click", close);

  function clearRegions() {
    content.replaceChildren();
    actions.replaceChildren();
  }

  function secondaryButton(label = "Keep booking") {
    const button = makeButton(label, "cancellation-button cancellation-button--secondary", close);
    button.disabled = submitting;
    return button;
  }

  function renderLoading() {
    clearRegions();
    const state = document.createElement("div");
    state.className = "cancellation-policy-state cancellation-policy-state--loading";
    const spinner = document.createElement("span");
    spinner.className = "cancellation-spinner";
    const copy = document.createElement("span");
    copy.textContent = "Loading cancellation policy...";
    state.append(spinner, copy);
    content.appendChild(state);
    actions.appendChild(secondaryButton());
  }

  function renderPolicyError(error) {
    policy = null;
    clearRegions();
    const state = document.createElement("div");
    state.className = "cancellation-policy-state cancellation-policy-state--error";
    const message = document.createElement("strong");
    const knownEligibilityFailure = [404, 409].includes(Number(error?.status || 0));
    message.textContent = knownEligibilityFailure
      ? cancellationErrorCopy(error)
      : "Unable to load cancellation policy. Please try again.";
    state.appendChild(message);
    content.appendChild(state);
    actions.append(secondaryButton(), makeButton("Try again", "cancellation-button cancellation-button--secondary", loadPolicy));
  }

  function makePolicyPanel(model) {
    const panel = document.createElement("div");
    panel.className = "cancellation-policy-preview";
    const heading = document.createElement("div");
    heading.className = "cancellation-policy-preview__heading";
    const headingLabel = document.createElement("span");
    headingLabel.textContent = "Cancellation policy";
    const headingValue = document.createElement("strong");
    headingValue.textContent = `${model.refundPercentage}% refund`;
    heading.append(headingLabel, headingValue);

    const amount = document.createElement("div");
    amount.className = "cancellation-policy-preview__amount";
    const amountLabel = document.createElement("span");
    amountLabel.textContent = "Refund amount";
    const amountValue = document.createElement("strong");
    amountValue.textContent = formatServerMoney(model.refundAmount, model.currency);
    amount.append(amountLabel, amountValue);
    panel.append(heading, amount);

    if (model.rules.length) {
      const rules = document.createElement("div");
      rules.className = "cancellation-policy-preview__rules";
      model.rules.forEach(rule => {
        const row = document.createElement("span");
        row.textContent = `${rule.label}: ${rule.refundPercentage}%`;
        rules.appendChild(row);
      });
      panel.appendChild(rules);
    }
    return panel;
  }

  function renderPolicy() {
    const model = cancellationDialogModel(booking, policy);
    if (!model) {
      renderPolicyError({ status: 0 });
      return;
    }
    clearRegions();
    content.appendChild(makePolicyPanel(model));
    const note = document.createElement("p");
    note.className = "cancellation-authority-note";
    note.textContent = "The final refund is rechecked by SeaGo when you confirm cancellation.";
    content.appendChild(note);
    const confirm = makeButton("Cancel booking", "cancellation-button cancellation-button--danger", submitCancellation);
    confirm.dataset.seagoConfirmCancellation = "1";
    confirm.disabled = submitting;
    actions.append(secondaryButton(), confirm);
  }

  function renderSubmitting() {
    renderPolicy();
    actions.querySelectorAll("button").forEach(button => { button.disabled = true; });
    const confirm = actions.querySelector("[data-seago-confirm-cancellation]");
    if (confirm) confirm.textContent = "Cancelling...";
  }

  function renderActionError(error) {
    clearRegions();
    const state = document.createElement("div");
    state.className = "cancellation-policy-state cancellation-policy-state--error";
    const message = document.createElement("strong");
    message.textContent = cancellationErrorCopy(error);
    state.appendChild(message);
    content.appendChild(state);

    const finalEligibilityFailure = [404, 409].includes(Number(error?.status || 0));
    if (!finalEligibilityFailure && policy) {
      actions.append(
        secondaryButton(),
        makeButton("Try cancellation again", "cancellation-button cancellation-button--danger", submitCancellation)
      );
    } else {
      policy = null;
      actions.appendChild(secondaryButton("Close"));
    }
  }

  function renderSuccess(result) {
    completed = true;
    clearRegions();
    title.textContent = "Booking cancelled";
    warning.textContent = "Your booking history remains available in My Tickets.";
    const refund = refundStatusPresentation(result?.refundStatus);
    const state = document.createElement("div");
    state.className = "cancellation-success";
    const label = document.createElement("strong");
    label.textContent = refund.label;
    const amount = document.createElement("span");
    const percentage = Number(result?.refundPercentage);
    amount.textContent = `${Number.isFinite(percentage) ? percentage : 0}% · ${formatServerMoney(result?.refundAmount, result?.currency || "JOD")}`;
    const copy = document.createElement("p");
    copy.textContent = refund.copy;
    state.append(label, amount, copy);
    content.appendChild(state);
    actions.appendChild(secondaryButton("Done"));
  }

  async function loadPolicy() {
    if (submitting || completed) return;
    renderLoading();
    try {
      const response = await getCancellationPolicy(booking._id, auth.token);
      const normalized = normalizeCancellationPolicy(response);
      if (!normalized) throw Object.assign(new Error("Invalid cancellation policy"), { status: 502 });
      policy = normalized;
      renderPolicy();
    } catch (error) {
      renderPolicyError(error);
      if ([404, 409].includes(Number(error?.status || 0))) onTruthChanged?.();
    }
  }

  async function submitCancellation() {
    if (submitting || completed || !policy) return;
    submitting = true;
    renderSubmitting();
    try {
      const result = await cancelBooking(booking._id, undefined, auth.token);
      submitting = false;
      renderSuccess(result);
      onTruthChanged?.(true);
    } catch (error) {
      submitting = false;
      renderActionError(error);
      if ([404, 409].includes(Number(error?.status || 0))) onTruthChanged?.();
    }
  }

  renderLoading();
  loadPolicy();
  actions.querySelector("button")?.focus();
}

export function enableCancellationUi() {
  let cachedToken = null;
  let cachedBookings = [];
  let loadPromise = null;
  let lastLoadedAt = 0;
  let syncQueued = false;
  let forceNextSync = false;

  function clearControls() {
    document.querySelectorAll("[data-seago-cancel-control]").forEach(node => node.remove());
  }

  function invalidate() {
    lastLoadedAt = 0;
    cachedBookings = [];
  }

  async function loadBookings(force = false) {
    const auth = readAuth();
    if (!auth?.token) {
      cachedToken = null;
      cachedBookings = [];
      clearControls();
      return [];
    }
    if (cachedToken !== auth.token) {
      cachedToken = auth.token;
      invalidate();
    }
    if (!force && cachedBookings.length && Date.now() - lastLoadedAt < 30000) return cachedBookings;
    if (loadPromise) return loadPromise;
    loadPromise = listBookings(auth.token)
      .then(rows => {
        cachedBookings = Array.isArray(rows) ? rows : [];
        lastLoadedAt = Date.now();
        return cachedBookings;
      })
      .catch(() => {
        cachedBookings = [];
        return [];
      })
      .finally(() => { loadPromise = null; });
    return loadPromise;
  }

  function updateFaq() {
    document.querySelectorAll(".support-faq details").forEach(details => {
      if (details.querySelector("summary")?.textContent?.trim() !== "What if I need to cancel?") return;
      const paragraph = details.querySelector("p");
      if (paragraph) paragraph.textContent = "Open My Tickets and choose Cancel booking when the booking is eligible. If self-service cancellation is unavailable, send a support request linked to the booking.";
    });
  }

  function installControls(bookings) {
    const byReference = new Map();
    for (const booking of bookings) {
      if (!isSelfServiceCancellationEligible(booking)) continue;
      const reference = bookingReference(booking._id);
      if (byReference.has(reference)) byReference.set(reference, null);
      else byReference.set(reference, booking);
    }

    document.querySelectorAll(".ticket-card").forEach(card => {
      const existing = card.querySelector("[data-seago-cancel-control]");
      const reference = ticketReferenceFromCard(card);
      const booking = reference ? byReference.get(reference) : null;
      const cardReady = card.classList.contains("ticket-card--confirmed") && Boolean(card.querySelector(".ticket-ready-banner"));
      if (!booking || !cardReady) {
        existing?.remove();
        return;
      }
      if (existing) return;

      const control = document.createElement("div");
      control.className = "customer-cancellation-control";
      control.dataset.seagoCancelControl = "1";
      const copy = document.createElement("span");
      const label = document.createElement("small");
      label.textContent = "Need to change plans?";
      const hint = document.createElement("em");
      hint.textContent = "View the current refund policy before cancelling.";
      copy.append(label, hint);
      const button = makeButton("Cancel booking", "customer-cancel-booking", () => {
        const auth = readAuth();
        if (!auth?.token) return;
        createCancellationModal({
          booking,
          auth,
          trigger: button,
          onTruthChanged: success => {
            invalidate();
            if (success) control.remove();
            window.dispatchEvent(new Event("focus"));
            window.setTimeout(() => queueSync(true), 80);
          }
        });
      });
      control.append(copy, button);
      const cancellationHistory = card.querySelector(".ticket-cancellation");
      if (cancellationHistory) cancellationHistory.before(control);
      else card.appendChild(control);
    });
  }

  async function sync() {
    syncQueued = false;
    const force = forceNextSync;
    forceNextSync = false;
    updateFaq();
    if (!document.querySelector(".tickets-screen")) {
      clearControls();
      return;
    }
    const bookings = await loadBookings(force);
    if (document.querySelector(".tickets-screen")) installControls(bookings);
  }

  function queueSync(force = false) {
    forceNextSync ||= force;
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(sync);
  }

  const root = document.getElementById("root");
  if (!root) return () => {};
  const observer = new MutationObserver(() => queueSync(false));
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  window.addEventListener("storage", invalidate);
  queueSync(true);

  return () => {
    observer.disconnect();
    window.removeEventListener("storage", invalidate);
    clearControls();
    document.querySelector("[data-seago-cancellation-modal]")?.remove();
  };
}
