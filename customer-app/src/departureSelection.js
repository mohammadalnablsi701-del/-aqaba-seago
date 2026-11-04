// Use Aqaba dates for both search and departure selection, independent of device timezone.
export function aqabaDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone:"Asia/Amman", year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(date);
  const part = key => parts.find(item => item.type === key)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function availableDepartures(rows, now = new Date()) {
  return (Array.isArray(rows) ? rows : [])
    .filter(row => row?.status === "scheduled"
      && Number(row.availableSeats || 0) > 0
      && Number.isFinite(new Date(row.startsAt).getTime())
      && new Date(row.startsAt) > now)
    .sort((a,b) => new Date(a.startsAt)-new Date(b.startsAt));
}

export function selectInitialDeparture(rows, criteria = {}, now = new Date()) {
  const date = typeof criteria?.date === "string" ? criteria.date : "";
  const guests = Math.max(1, Number(criteria?.guests || 1));
  const candidates = availableDepartures(rows,now).filter(row =>
    Number(row.availableSeats || 0) >= guests && (!date || aqabaDateKey(row.startsAt) === date));
  if (criteria?.departureId) {
    const selected = candidates.find(row => String(row.id) === String(criteria.departureId));
    if (selected) return selected;
  }
  // Fail closed: never silently switch the date chosen in a search.
  return candidates[0] || null;
}
