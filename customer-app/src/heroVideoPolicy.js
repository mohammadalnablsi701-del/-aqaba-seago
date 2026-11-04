// Restrict hero media to first-party built assets and conserve mobile data.
export function heroAssetUrl(base, filename) {
  const safeBase = typeof base === "string" && base.startsWith("/") ? base : "/";
  const folder = safeBase.endsWith("/") ? safeBase : safeBase + "/";
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(filename || "") || filename.includes("..")) return "";
  return folder + filename;
}

export function shouldPlayHeroVideo(context = {}) {
  if (context.reducedMotion || context.saveData || context.isHidden) return false;
  return !["slow-2g", "2g"].includes(String(context.effectiveType || "").toLowerCase());
}
