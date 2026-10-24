/** Date helpers that work in the viewer's timezone using plain YYYY-MM-DD day keys. */

export function dayKey(date: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
}

/** ISO weekday 1 (Mon) … 7 (Sun) of a day key. */
export function isoWeekday(key: string) {
  const d = new Date(`${key}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function addDays(key: string, n: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekStart(key: string) {
  return addDays(key, 1 - isoWeekday(key));
}

export function hourIn(timeZone: string, date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(date));
}

export function greeting(hour: number) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
