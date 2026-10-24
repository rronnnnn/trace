import "server-only";
import { cookies } from "next/headers";

export const TZ_COOKIE = "trace_tz";

/** The viewer's IANA timezone, reported by the browser via cookie. Falls back to UTC. */
export async function getTimeZone() {
  const tz = (await cookies()).get(TZ_COOKIE)?.value;
  if (tz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {}
  }
  return "UTC";
}
