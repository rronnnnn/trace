import Link from "next/link";
import { LandscapeMap } from "@/components/landscape/landscape-map";
import { IconArrowRight } from "@/components/icons";
import { addDays, dayKey, greeting, hourIn, isoWeekday, weekStart } from "@/lib/dates";
import { formatDuration, formatLongDate, formatNumber, formatShortDate, formatVolume, formatWeight } from "@/lib/format";
import type { LandscapeSession } from "@/lib/landscape/terrain";
import { requireProfile } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { SampleHistoryButton } from "./sample-history-button";
import { StartWorkoutButton } from "./start-workout-button";

const WINDOW_WEEKS = 12;
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export default async function TodayPage() {
  const [{ supabase, userId, profile }, tz] = await Promise.all([requireProfile(), getTimeZone()]);
  const now = new Date();
  const today = dayKey(now, tz);
  const windowStart = addDays(weekStart(today), -7 * (WINDOW_WEEKS - 1));

  const [templatesRes, sessionsRes] = await Promise.all([
    supabase
      .from("workout_templates")
      .select("id, name, focus, est_minutes, position, template_exercises(position, exercise:exercises(name))")
      .is("archived_at", null)
      .order("position"),
    supabase
      .from("workout_sessions")
      .select(
        "id, template_id, template_name, started_at, ended_at, total_volume, completed_sets, is_sample, personal_records(kind, is_baseline)",
      )
      .gte("ended_at", new Date(`${windowStart}T00:00:00Z`).toISOString())
      .order("ended_at", { ascending: false })
      .limit(200),
  ]);
  if (templatesRes.error) throw templatesRes.error;
  if (sessionsRes.error) throw sessionsRes.error;

  const templates = templatesRes.data;
  const sessions = sessionsRes.data;
  const last = sessions[0] ?? null;

  // Planned workout: the routine after the last one trained, in template order.
  const lastIndex = last ? templates.findIndex((t) => t.id === last.template_id) : -1;
  const planned = templates.length ? templates[(lastIndex + 1) % templates.length] : null;
  const trainedToday = sessions.some((s) => !s.is_sample && dayKey(s.ended_at, tz) === today);
  const isTrainingDay = profile.training_days.includes(isoWeekday(today));

  // Highlights of the last session: records set, measured values only.
  const { data: lastRecords } = last
    ? await supabase
        .from("personal_records")
        .select("kind, weight, reps, value, exercise:exercises(name)")
        .eq("session_id", last.id)
        .eq("is_baseline", false)
        .in("kind", ["heaviest_weight", "most_reps"])
    : { data: [] };

  // This week, in the viewer's timezone.
  const monday = weekStart(today);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const perDay = new Map<string, number>();
  for (const s of sessions) {
    const k = dayKey(s.ended_at, tz);
    if (k >= monday) perDay.set(k, (perDay.get(k) ?? 0) + Number(s.total_volume));
  }
  const weekCount = sessions.filter((s) => dayKey(s.ended_at, tz) >= monday).length;
  const weekTarget = profile.weekly_target ?? 0;
  const maxDayVolume = Math.max(1, ...perDay.values());

  const landscape: LandscapeSession[] = sessions.map((s) => ({
    id: s.id,
    endedAt: s.ended_at,
    templateKey: s.template_id ?? s.template_name ?? "session",
    label: s.template_name ?? "Session",
    volume: Number(s.total_volume),
    sets: s.completed_sets,
    prCount: s.personal_records.filter((p) => p.kind !== "estimated_1rm" && !p.is_baseline).length,
  }));
  const hasSample = sessions.some((s) => s.is_sample);
  const hasReal = sessions.some((s) => !s.is_sample);

  const name = profile.display_name?.split(" ")[0];
  const unit = profile.unit;

  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-8 sm:px-8 md:pt-14 lg:px-14">
      <header>
        <p className="eyebrow num">{formatLongDate(now.toISOString(), tz)}</p>
        <h1 className="mt-3 font-serif text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[52px]">
          {greeting(hourIn(tz, now))}
          {name ? `, ${name}` : ""}.
        </h1>
        <p className="mt-3 text-[15px] text-ink-2">
          {sessions.length
            ? `${sessions.length} session${sessions.length === 1 ? "" : "s"} recorded in the last ${WINDOW_WEEKS} weeks.`
            : "Your record begins with the first session."}
        </p>
      </header>

      {/* Today's workout beside the landscape. No container: type and hairlines carry the structure. */}
      <section
        aria-labelledby="today-workout"
        className="mt-10 grid gap-10 border-t border-ink/80 pt-8 md:mt-12 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12"
      >
        <div className="flex flex-col">
          <p className="eyebrow" id="today-workout">
            {trainedToday ? "Next up" : isTrainingDay ? "Today's workout" : "Rest day · next up"}
          </p>
          {planned ? (
            <>
              <h2 className="mt-4 font-serif text-[34px] leading-[1.05] tracking-[-0.015em] sm:text-[40px]">{planned.name}</h2>
              <p className="num mt-2 text-sm text-ink-3">
                {planned.est_minutes ? `About ${planned.est_minutes} min · ` : ""}
                {planned.template_exercises.length} exercises
              </p>
              <ol className="mt-7 text-[15px]">
                {[...planned.template_exercises]
                  .sort((a, b) => a.position - b.position)
                  .map((te, i) => (
                    <li key={i} className="flex gap-4 border-t border-line py-2.5 last:border-b">
                      <span className="num w-5 text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                      <span className="text-ink-2">{te.exercise.name}</span>
                    </li>
                  ))}
              </ol>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                <StartWorkoutButton uid={userId} templateId={planned.id} templateName={planned.name} />
                <Link
                  href="/train"
                  className="text-sm text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-ink"
                >
                  Choose another
                </Link>
              </div>
              {!isTrainingDay && !trainedToday ? (
                <p className="mt-5 max-w-xs text-[13px] leading-relaxed text-ink-3">
                  Rest is part of the plan. Train if you feel like it; nothing is lost if you don&apos;t.
                </p>
              ) : null}
            </>
          ) : (
            <div className="mt-4">
              <h2 className="font-serif text-[30px] leading-tight">No routines yet</h2>
              <p className="mt-2 text-sm text-ink-2">Create a routine to plan your sessions.</p>
              <Link href="/train" className="mt-6 inline-flex text-sm underline underline-offset-4">
                Go to Train
              </Link>
            </div>
          )}
        </div>

        <figure className="flex flex-col">
          <div className="relative aspect-[6/5] min-h-[420px] overflow-hidden rounded-md border border-line bg-surface/60 md:aspect-auto md:flex-1">
            <LandscapeMap
              sessions={landscape}
              seed={userId}
              start={new Date(`${windowStart}T00:00:00Z`).toISOString()}
              end={now.toISOString()}
              width={600}
              height={500}
              levels={15}
              compact
              cover
              unit={unit}
              className="absolute inset-0"
              label="Training landscape, last 12 weeks"
              trainingDays={profile.training_days}
              timeZone={tz}
            />
          </div>
          <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px] text-ink-3">
            <span className="flex items-center gap-4">
              <Link href="/landscape" className="text-ink-2 hover:text-ink">
                Your landscape · {WINDOW_WEEKS} weeks
              </Link>
              <Link href="/landscape/explore" className="group flex items-center gap-1.5 font-medium text-ink hover:text-ink">
                Explore landscape
                <IconArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </span>
            <span className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-sage-deep ring-2 ring-sage-soft" aria-hidden /> Record
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full border border-ink-2 bg-surface" aria-hidden /> Session
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-full border border-[var(--water-edge)] bg-[var(--water)]" aria-hidden /> Rest
              </span>
            </span>
          </figcaption>
        </figure>
      </section>

      {/* Last session · This week: one strip divided by a hairline. */}
      <div className="mt-14 grid border-t border-line md:grid-cols-2">
        <section aria-labelledby="last-session" className="py-7 md:pr-10">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="last-session" className="eyebrow">
              Last session
            </h2>
            {last ? (
              <Link href={`/history/${last.id}`} className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
                Details <IconArrowRight />
              </Link>
            ) : null}
          </div>
          {last ? (
            <>
              <p className="mt-4 text-[17px] font-medium">
                {last.template_name ?? "Session"}
                {last.is_sample ? <SampleTag /> : null}
              </p>
              <p className="num mt-0.5 text-sm text-ink-3">
                {formatShortDate(last.ended_at, tz)} ·{" "}
                {formatDuration(new Date(last.ended_at).getTime() - new Date(last.started_at).getTime())}
              </p>
              <dl className="mt-6 flex gap-12">
                <Figure label="Volume" value={formatNumber(Math.round(Number(last.total_volume)))} unit={unit} />
                <Figure label="Working sets" value={String(last.completed_sets)} />
              </dl>
              {lastRecords?.length ? (
                <ul className="mt-6 border-t border-line text-sm">
                  {lastRecords.map((r, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 border-b border-line py-2">
                      <span className="flex items-center gap-2 text-ink-2">
                        <span className="size-1.5 rounded-full bg-sage" aria-hidden />
                        {r.exercise.name}
                      </span>
                      <span className="num font-medium">
                        {r.kind === "most_reps" ? `${r.reps} reps` : `${formatWeight(r.weight)} ${unit} × ${r.reps}`}
                        <span className="ml-2 text-xs font-normal text-sage-deep">Record</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <EmptyHint>Finish a workout and it will appear here, with its volume and any records you set.</EmptyHint>
          )}
        </section>

        <section aria-labelledby="this-week" className="border-t border-line py-7 md:border-l md:border-t-0 md:pl-10">
          <h2 id="this-week" className="eyebrow">
            This week
          </h2>
          <dl className="mt-4">
            <Figure
              label={weekTarget ? "of your planned workouts" : "workouts completed"}
              value={String(weekCount)}
              suffix={weekTarget ? ` / ${weekTarget}` : undefined}
              labelBelow
            />
          </dl>
          <div className="mt-6 grid max-w-sm grid-cols-7 gap-2" role="list" aria-label="Training this week">
            {weekDays.map((k, i) => {
              const vol = perDay.get(k);
              const plannedDay = profile.training_days.includes(i + 1);
              const isToday = k === today;
              const h = vol ? 12 + 44 * (vol / maxDayVolume) : 0;
              return (
                <div
                  key={k}
                  role="listitem"
                  aria-label={`${k}${vol != null ? `: trained, ${formatVolume(vol, unit)}` : plannedDay ? ": planned" : ": rest"}`}
                  className="flex flex-col items-center gap-2"
                >
                  <div className="flex h-14 w-full items-end justify-center">
                    {vol != null ? (
                      <div className="w-2 rounded-[2px] bg-sage-deep" style={{ height: h }} />
                    ) : (
                      <div
                        className={cn(
                          "w-2 rounded-[2px]",
                          plannedDay && k > today ? "h-3 border border-dashed border-line-strong" : "h-px bg-line-strong",
                        )}
                      />
                    )}
                  </div>
                  <span className={cn("num text-[11px]", isToday ? "font-semibold text-ink" : "text-ink-3")}>{WEEKDAYS[i]}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {!hasReal ? (
        <section className="flex flex-col justify-between gap-4 border-t border-line pt-6 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-medium">{hasSample ? "You're viewing sample history" : "Want to see where this goes?"}</p>
            <p className="mt-0.5 max-w-xl text-sm text-ink-3">
              {hasSample
                ? "Sample sessions are marked and kept apart from your own. Remove them whenever you like."
                : "Load ten weeks of clearly marked sample sessions to explore TRACE before your own history builds up."}
            </p>
          </div>
          <SampleHistoryButton uid={userId} mode={hasSample ? "remove" : "load"} />
        </section>
      ) : null}
    </main>
  );
}

function SampleTag() {
  return (
    <span className="ml-2 rounded-sm bg-sunken px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wider text-ink-3">
      Sample
    </span>
  );
}

/** A large measured number with its label. */
function Figure({
  label,
  value,
  unit,
  suffix,
  labelBelow,
}: {
  label: string;
  value: string;
  unit?: string;
  suffix?: string;
  labelBelow?: boolean;
}) {
  const number = (
    <dd className="num text-[34px] font-medium leading-none tracking-[-0.02em]">
      {value}
      {suffix ? <span className="text-ink-3">{suffix}</span> : null}
      {unit ? <span className="ml-1 text-sm font-normal tracking-normal text-ink-3">{unit}</span> : null}
    </dd>
  );
  return (
    <div className="flex flex-col">
      {labelBelow ? null : <dt className="mb-2 text-xs text-ink-3">{label}</dt>}
      {number}
      {labelBelow ? <dt className="mt-2 text-sm text-ink-3">{label}</dt> : null}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 max-w-xs text-sm text-ink-3">{children}</p>;
}
