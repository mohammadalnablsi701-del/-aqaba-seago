export const TICKETS_POLL_INTERVAL_MS = 30000;
export const TICKETS_MAX_BACKOFF_MS = 120000;
export const TICKETS_FOREGROUND_DEDUPE_MS = 1000;

export function shouldPollTickets(tickets) {
  return Array.isArray(tickets) && tickets.some(ticket =>
    ticket?.ticketPresentation?.state === "ready" && ticket?.ticketPresentation?.ready === true
  );
}

export function getTicketsPollDelay(failureCount = 0) {
  const failures = Math.max(0, Number(failureCount) || 0);
  return Math.min(TICKETS_POLL_INTERVAL_MS * (2 ** failures), TICKETS_MAX_BACKOFF_MS);
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

export function createTicketsRefreshController({
  loadTickets,
  onData = () => {},
  onInitialLoading = () => {},
  onError = () => {},
  isVisible = () => true,
  scheduleTimeout = (fn, delay) => setTimeout(fn, delay),
  cancelTimeout = id => clearTimeout(id),
  now = () => Date.now()
} = {}) {
  if (typeof loadTickets !== "function") throw new TypeError("loadTickets is required");

  let active = false;
  let generation = 0;
  let inFlight = null;
  let abortController = null;
  let inFlightWasInitial = false;
  let timerId = null;
  let lastTickets = [];
  let failureCount = 0;
  let lastForegroundRefreshAt = -Infinity;

  function clearScheduledPoll() {
    if (timerId === null) return;
    cancelTimeout(timerId);
    timerId = null;
  }

  function abortCurrent() {
    if (!inFlight && !abortController) return;
    generation += 1;
    abortController?.abort();
    abortController = null;
    inFlight = null;
    if (inFlightWasInitial) onInitialLoading(false);
    inFlightWasInitial = false;
  }

  function schedulePoll() {
    clearScheduledPoll();
    if (!active || !isVisible() || !shouldPollTickets(lastTickets)) return;
    const delay = getTicketsPollDelay(failureCount);
    timerId = scheduleTimeout(() => {
      timerId = null;
      void refresh("poll");
    }, delay);
  }

  function refresh(reason = "manual", { initial = false } = {}) {
    if (!active || !isVisible()) return Promise.resolve(null);
    if (inFlight) return inFlight;

    const sequence = ++generation;
    const requestAbortController = new AbortController();
    abortController = requestAbortController;
    inFlightWasInitial = initial;
    if (initial) onInitialLoading(true);

    const requestPromise = Promise.resolve()
      .then(() => loadTickets({ signal: requestAbortController.signal, reason }))
      .then(rows => {
        if (!active || sequence !== generation) return null;
        lastTickets = Array.isArray(rows) ? rows : [];
        failureCount = 0;
        onData(lastTickets, { reason });
        schedulePoll();
        return lastTickets;
      })
      .catch(error => {
        if (!active || sequence !== generation || isAbortError(error)) return null;
        failureCount += 1;
        onError(error, { hasData: lastTickets.length > 0, reason, failureCount });
        schedulePoll();
        return null;
      })
      .finally(() => {
        if (sequence !== generation) return;
        inFlight = null;
        abortController = null;
        if (inFlightWasInitial) onInitialLoading(false);
        inFlightWasInitial = false;
      });

    inFlight = requestPromise;
    return requestPromise;
  }

  function refreshForeground(reason = "foreground") {
    if (!active || !isVisible()) return Promise.resolve(null);
    const timestamp = now();
    if (timestamp - lastForegroundRefreshAt < TICKETS_FOREGROUND_DEDUPE_MS) {
      return inFlight || Promise.resolve(null);
    }
    lastForegroundRefreshAt = timestamp;
    failureCount = 0;
    return refresh(reason);
  }

  function start(initialTickets = []) {
    active = true;
    lastTickets = Array.isArray(initialTickets) ? initialTickets : [];
    failureCount = 0;
    return refresh("entry", { initial: true });
  }

  function handleVisibility(visible) {
    if (!active) return Promise.resolve(null);
    if (!visible) {
      clearScheduledPoll();
      abortCurrent();
      return Promise.resolve(null);
    }
    return refreshForeground("visible");
  }

  function stop() {
    active = false;
    clearScheduledPoll();
    abortCurrent();
  }

  function snapshot() {
    return {
      active,
      polling: timerId !== null,
      inFlight: Boolean(inFlight),
      failureCount,
      ticketCount: lastTickets.length,
      mutable: shouldPollTickets(lastTickets)
    };
  }

  return { start, refresh, refreshForeground, handleVisibility, stop, snapshot };
}
