// Validate restored sessions before cached account screens can mount. This is
// separate from the visual clock: slow authentication keeps branded recovery up.
export async function validateStartupSession({ hasApi, storage, validate, timeoutMs = 8000 }) {
  const readToken = () => {
    try { return JSON.parse(storage.getItem("seago_auth") || "null")?.token || ""; }
    catch { return ""; }
  };
  if (!readToken()) return;
  if (!hasApi) throw new Error("Session verification is unavailable");

  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Session verification timed out"));
    }, timeoutMs);
  });
  try {
    while (true) {
      const token = readToken();
      if (!token) return;
      try {
        await Promise.race([validate(token, { signal: controller.signal }), deadline]);
      } catch (error) {
        if (error.status !== 401) throw error;
        // Never clear a newer account written while this request was in flight.
        if (readToken() === token) storage.removeItem("seago_auth");
        continue;
      }
      if (readToken() === token) return;
      // An account change needs its own check before protected content mounts.
    }
  } finally {
    clearTimeout(timer);
  }
}
