"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { emptyWorkout } from "@/lib/workout/start";
import { useActiveWorkout } from "@/lib/workout/use-active-workout";

/** Starts a session with no routine; exercises are added as you go. */
export function FreestyleButton({ uid }: { uid: string }) {
  const router = useRouter();
  const { workout, loaded, replace } = useActiveWorkout(uid);
  if (!loaded || workout) return null;
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await replace(emptyWorkout(uid));
        router.push("/workout");
      }}
    >
      Start an empty session
    </Button>
  );
}
