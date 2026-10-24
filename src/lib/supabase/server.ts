import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Database } from "./database.types";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(toSet) {
        // Server Components cannot write cookies; the proxy refreshes the session instead.
        try {
          toSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {}
      },
    },
  });
}

/** The signed-in user for this request, or a redirect to sign-in. Deduplicated per request. */
export const requireUser = cache(async () => {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/sign-in");
  return { supabase, userId: data.claims.sub, email: (data.claims.email as string | undefined) ?? null };
});

/** The user's profile; sends un-onboarded users to onboarding. */
export const requireProfile = cache(async () => {
  const { supabase, userId, email } = await requireUser();
  const { data: profile, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!profile?.onboarded_at) redirect("/onboarding");
  return { supabase, userId, email, profile };
});
