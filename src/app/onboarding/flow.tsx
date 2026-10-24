"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { EQUIPMENT_OPTIONS, EXPERIENCE_OPTIONS, GOAL_OPTIONS, PROGRAMS, recommendedProgram } from "@/lib/programs";
import { cn } from "@/lib/utils";
import { completeOnboarding } from "./actions";

const DAYS = [
  { id: 1, short: "M", label: "Monday" },
  { id: 2, short: "T", label: "Tuesday" },
  { id: 3, short: "W", label: "Wednesday" },
  { id: 4, short: "T", label: "Thursday" },
  { id: 5, short: "F", label: "Friday" },
  { id: 6, short: "S", label: "Saturday" },
  { id: 7, short: "S", label: "Sunday" },
];

const STEPS = ["About you", "Goal", "Experience", "Equipment", "Schedule", "Routine"] as const;

export function OnboardingFlow({ defaultName }: { defaultName: string }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(defaultName);
  const [goal, setGoal] = useState<string>("");
  const [experience, setExperience] = useState<string>("");
  const [equipment, setEquipment] = useState<string[]>(["barbell", "dumbbell", "cable", "machine", "bodyweight"]);
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [programId, setProgramId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const recommended = recommendedProgram(days.length);
  const program = PROGRAMS.find((p) => p.id === (programId ?? recommended.id))!;

  const canContinue = [true, Boolean(goal), Boolean(experience), true, days.length > 0, true][step];

  function next() {
    if (!canContinue) return;
    if (step < STEPS.length - 1) return setStep(step + 1);
    setError(null);
    startTransition(async () => {
      const result = await completeOnboarding({
        displayName: name,
        goal,
        experience,
        equipment,
        trainingDays: days,
        programId: program.id,
      });
      if (result?.error) setError(result.error);
    });
  }

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        next();
      }}
    >
      <div className="mt-12 flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <span key={s} className={cn("h-0.5 flex-1 rounded-full transition-colors duration-300", i <= step ? "bg-ink" : "bg-line")} />
        ))}
      </div>
      <p className="eyebrow mt-4">
        {step + 1} / {STEPS.length} · {STEPS[step]}
      </p>

      <div className="relative mt-6 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === 0 && (
              <Step title="What should we call you?" hint="Shown on your Today screen. Optional.">
                <Label htmlFor="name" className="sr-only">
                  Name
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your first name"
                  maxLength={60}
                  autoFocus
                />
              </Step>
            )}
            {step === 1 && (
              <Step title="What are you training for?">
                <Choices options={GOAL_OPTIONS} value={goal} onChange={setGoal} />
              </Step>
            )}
            {step === 2 && (
              <Step title="How long have you been lifting?">
                <Choices options={EXPERIENCE_OPTIONS} value={experience} onChange={setExperience} />
              </Step>
            )}
            {step === 3 && (
              <Step title="What do you have access to?" hint="We'll pick exercise alternatives for anything missing.">
                <div className="grid gap-2 sm:grid-cols-2">
                  {EQUIPMENT_OPTIONS.map((o) => {
                    const on = equipment.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => setEquipment(toggle(equipment, o.id))}
                        className={cn(
                          "flex h-12 items-center justify-between rounded-md border px-4 text-left text-sm transition-colors",
                          on ? "border-ink bg-surface text-ink" : "border-line text-ink-2 hover:border-line-strong",
                        )}
                      >
                        {o.label}
                        <Check on={on} />
                      </button>
                    );
                  })}
                </div>
              </Step>
            )}
            {step === 4 && (
              <Step
                title="Which days do you plan to train?"
                hint="A plan, not a promise. Rest days and missed sessions never erase progress."
              >
                <div className="flex gap-2">
                  {DAYS.map((d) => {
                    const on = days.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        aria-label={d.label}
                        onClick={() => setDays(toggle(days, d.id).sort())}
                        className={cn(
                          "num flex aspect-square flex-1 items-center justify-center rounded-md border text-sm font-medium transition-colors",
                          on ? "border-ink bg-ink text-paper" : "border-line text-ink-2 hover:border-line-strong",
                        )}
                      >
                        {d.short}
                      </button>
                    );
                  })}
                </div>
                <p className="num mt-3 text-sm text-ink-3">
                  {days.length} {days.length === 1 ? "day" : "days"} a week
                </p>
              </Step>
            )}
            {step === 5 && (
              <Step title="Start with a routine" hint="It becomes yours. Edit it any time without changing past sessions.">
                <div className="space-y-2">
                  {PROGRAMS.map((p) => {
                    const on = p.id === program.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setProgramId(p.id)}
                        className={cn(
                          "w-full rounded-md border px-4 py-3.5 text-left transition-colors",
                          on ? "border-ink bg-surface" : "border-line hover:border-line-strong",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{p.name}</span>
                          {p.id === recommended.id ? <span className="text-xs text-sage">Fits {days.length} days</span> : null}
                        </div>
                        <p className="mt-0.5 text-sm text-ink-3">{p.summary}</p>
                        {on ? (
                          <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[13px] text-ink-2">
                            {p.days.map((d) => (
                              <li key={d.name} className="flex justify-between gap-3">
                                <span>{d.name}</span>
                                <span className="text-ink-3">{d.focus}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </Step>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <p role="alert" className="min-h-5 text-sm text-clay">
        {error}
      </p>
      <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-3 bg-paper py-4">
        <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} className={step === 0 ? "invisible" : ""}>
          Back
        </Button>
        <Button type="submit" size="lg" disabled={!canContinue || pending} className="min-w-40">
          {step === STEPS.length - 1 ? (pending ? "Setting up…" : "Start training") : "Continue"}
        </Button>
      </div>
    </form>
  );
}

function Step({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h1 className="font-serif text-[30px] leading-[1.15] tracking-[-0.01em]">{title}</h1>
      {hint ? <p className="mt-2 text-ink-2">{hint}</p> : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Choices({
  options,
  value,
  onChange,
}: {
  options: readonly { id: string; label: string; detail: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div role="radiogroup" className="space-y-2">
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={cn(
              "flex w-full items-center justify-between gap-4 rounded-md border px-4 py-3.5 text-left transition-colors",
              on ? "border-ink bg-surface" : "border-line hover:border-line-strong",
            )}
          >
            <span>
              <span className="block font-medium">{o.label}</span>
              <span className="block text-sm text-ink-3">{o.detail}</span>
            </span>
            <Check on={on} />
          </button>
        );
      })}
    </div>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
        on ? "border-ink bg-ink text-paper" : "border-line-strong",
      )}
    >
      {on ? (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M2 5.2l2 2L8 3" />
        </svg>
      ) : null}
    </span>
  );
}
