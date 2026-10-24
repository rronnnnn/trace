"use client";

import { ErrorState } from "@/components/error-state";

export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorState error={error} retry={retry} />;
}
