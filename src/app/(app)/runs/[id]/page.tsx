import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RouteTrace } from "@/components/run/route-trace";
import { OverlayShare } from "@/components/run/overlay-share";
import { RunView } from "@/components/run/run-view";
import { IconArrowLeft } from "@/components/icons";
import { bestEffort, bestPace, EFFORTS, elevationGain, splits } from "@/lib/run/analysis";
import { formatClockTime, formatKm, formatPace, formatRunTime, paceOf } from "@/lib/run/recorder";
import { requireUser } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { routePoints, runTitle } from "../data";
import { RunActions } from "./run-actions";

export const metadata: Metadata = { title: "Run" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RunDetailPage({ params }: PageProps<"/runs/[id]">) {
  const [{ id }, { supabase }, tz] = await Promise.all([params, requireUser(), getTimeZone()]);
  if (!UUID.test(id)) notFound();
  const { data: r, error } = await supabase.from("runs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!r) notFound();

  const points = routePoints(r.route) ?? [];
  const gps = r.source === "gps" && points.length >= 2;
  const meters = Number(r.distance_m);
  const avg = paceOf(r.moving_seconds, meters);
  const best = gps ? bestPace(points) : null;
  const gain = r.elevation_gain_m != null ? Number(r.elevation_gain_m) : gps ? elevationGain(points) : null;
  const sp = gps ? splits(points) : [];
  const efforts = gps ? EFFORTS.flatMap((e) => (meters >= e.meters ? [{ ...e, effort: bestEffort(points, e.meters) }] : [])).filter((e) => e.effort) : [];
  const title = runTitle({ title: r.title, kind: r.kind, startedAt: r.started_at }, tz);
  const when = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(r.started_at));

  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-8 sm:px-8 md:pt-14 lg:px-14">
      <Link href="/runs" className="flex w-fit items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <IconArrowLeft /> Runs
      </Link>
      <header className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="eyebrow">
            {r.kind === "treadmill" ? "Treadmill run" : "Outdoor run"}
            {r.source === "manual" ? " · logged by hand" : " · GPS"}
            {r.is_sample ? " · sample" : ""}
          </p>
          <h1 className="mt-3 break-words font-serif text-[34px] leading-[1.05] tracking-[-0.02em] sm:text-[48px]">{title}</h1>
          <p className="mt-2 text-[14px] text-ink-3">{when}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OverlayShare
            stats={[
              { label: "Distance", value: `${formatKm(meters)} km` },
              { label: "Pace", value: `${formatPace(avg)} /km` },
              { label: "Time", value: formatRunTime(r.moving_seconds * 1000) },
            ]}
            points={gps ? points : null}
            fileName={`trace-run-${r.started_at.slice(0, 10)}.png`}
          />
          <RunActions id={r.id} title={r.title} />
        </div>
      </header>

      {/* the three numbers that matter, large, beside the route's shape */}
      <section aria-label="Summary" className="mt-10 grid grid-cols-[minmax(0,1fr)] items-center gap-8 border-t border-ink/80 pt-8 md:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <dl className="num grid gap-6">
          {[
            { label: "Distance", value: `${formatKm(meters)} km` },
            { label: "Pace", value: `${formatPace(avg)} /km` },
            { label: "Time", value: formatRunTime(r.moving_seconds * 1000) },
          ].map((s) => (
            <div key={s.label}>
              <dt className="text-[12px] uppercase tracking-[0.16em] text-ink-3">{s.label}</dt>
              <dd className="mt-1 text-[44px] font-medium leading-none tracking-[-0.02em] sm:text-[56px]">{s.value}</dd>
            </div>
          ))}
        </dl>
        {gps ? <RouteTrace points={points} width={320} height={260} className="h-auto w-full max-w-sm justify-self-center" /> : null}
      </section>

      <dl className="num mt-10 grid grid-cols-2 gap-x-8 gap-y-5 border-y border-line py-5 sm:grid-cols-5">
        <Fact label="Moving time" value={formatClockTime(r.moving_seconds * 1000)} note="Pauses and standing still left out" />
        <Fact label="Elapsed time" value={formatClockTime(r.elapsed_seconds * 1000)} note="Start to finish, pauses included" />
        <Fact label="Average pace" value={`${formatPace(avg)} /km`} note="Over moving time" />
        <Fact label="Best pace" value={best ? `${formatPace(best)} /km` : "—"} note={best ? "Fastest 400 m" : gps ? "No 400 m stretch" : "Needs a GPS route"} />
        <Fact label="Elevation gain" value={gain != null ? `${gain} m` : "—"} note={gain != null ? "From the device's altitude" : "No reliable altitude"} />
      </dl>

      {gps ? (
        <section aria-label="Route and splits" className="mt-12">
          <RunView points={points} splits={sp} hasAltitude={points.filter((p) => p[4] != null).length / points.length >= 0.8} />
        </section>
      ) : (
        <p className="mt-10 max-w-lg border-l-2 border-line-strong pl-4 text-[14px] text-ink-3">
          {r.kind === "treadmill"
            ? "A treadmill run has no route. Its distance is the treadmill's, so it isn't compared with GPS-measured runs for best efforts."
            : "This run was logged by hand, without a route, so there are no splits or best efforts for it."}
        </p>
      )}

      {efforts.length ? (
        <section aria-labelledby="efforts" className="mt-12">
          <h2 id="efforts" className="text-[13px] font-medium">
            Best efforts in this run
          </h2>
          <ul className="num mt-2 max-w-md">
            {efforts.map((e) => (
              <li key={e.id} className="flex justify-between border-b border-line py-2.5 text-[14px] last:border-0">
                <span>{e.label}</span>
                <span className="font-medium">{formatClockTime(e.effort!.seconds * 1000)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-ink-3">Measured on recorded GPS points only; a stretch crossing a pause or a long GPS gap doesn&apos;t count.</p>
        </section>
      ) : null}
    </main>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="mt-1 text-[20px] font-medium leading-none">{value}</dd>
      <dd className="mt-1.5 text-[11px] leading-snug text-ink-3">{note}</dd>
    </div>
  );
}
