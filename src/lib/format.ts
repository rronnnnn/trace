const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export const formatNumber = (n: number) => nf0.format(n);
export const formatWeight = (n: number | null | undefined) => (n == null ? "—" : nf1.format(n));
export const formatVolume = (n: number, unit = "kg") => `${nf0.format(Math.round(n))} ${unit}`;

export function formatShortDate(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
}

export function formatLongDate(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone });
}

export function formatDuration(ms: number) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 1) return "under a minute";
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatClock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

export function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = m.toString().padStart(2, "0");
  const ss = sec.toString().padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
