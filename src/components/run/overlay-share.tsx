"use client";

import { Archivo } from "next/font/google";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/dialog";
import type { TrackPoint } from "@/lib/run/recorder";
import { cn } from "@/lib/utils";
import { drawOverlay, ROUTE_COLORS, type OverlayStat } from "./overlay";

// self-hosted at build time: the PNG is made on the device, with nothing fetched from elsewhere
const archivo = Archivo({ subsets: ["latin"], weight: ["600", "800"], display: "swap" });

/**
 * A transparent PNG of the run to lay over your own photo: distance, pace, time and the route
 * drawn from its GPS points. Made in the browser; the route never leaves the device unless you
 * share the image yourself.
 */
export function OverlayShare({ stats, points, fileName }: { stats: OverlayStat[]; points: TrackPoint[] | null; fileName: string }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState<string>(ROUTE_COLORS[0]);
  const [showRoute, setShowRoute] = useState(Boolean(points && points.length > 1));
  const [backdrop, setBackdrop] = useState<"dark" | "check">("dark");
  const [png, setPng] = useState<{ url: string; blob: Blob } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const hasRoute = Boolean(points && points.length > 1);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let url: string | null = null;
    (async () => {
      // the canvas only uses a font once it has loaded
      await Promise.all([document.fonts.load(`600 17px ${archivo.style.fontFamily}`), document.fonts.load(`800 44px ${archivo.style.fontFamily}`)]).catch(() => {});
      const canvas = drawOverlay({ stats, points, showRoute: showRoute && hasRoute, routeColor: color, fontFamily: archivo.style.fontFamily });
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!alive || !blob) return;
      url = URL.createObjectURL(blob);
      setPng((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url: url!, blob };
      });
    })();
    return () => {
      alive = false;
    };
  }, [open, stats, points, showRoute, hasRoute, color]);
  useEffect(() => () => void (png && URL.revokeObjectURL(png.url)), [png]);

  const file = () => (png ? new File([png.blob], fileName, { type: "image/png" }) : null);
  const canShareFile = typeof navigator !== "undefined" && "canShare" in navigator && png ? navigator.canShare({ files: [file()!] }) : false;

  const download = () => {
    if (!png) return;
    const a = document.createElement("a");
    a.href = png.url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setNote("Saved as a transparent PNG. Place it over a photo in your editor or story.");
  };
  const share = async () => {
    const f = file();
    if (!f) return;
    try {
      await navigator.share({ files: [f] });
    } catch {
      // cancelled: nothing to say
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Share overlay
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="Share overlay" description="A transparent PNG to lay over your own photo. It's made on this device.">
        <div className="space-y-5">
          <div
            className={cn("grid min-h-80 place-items-center rounded-lg p-4", backdrop === "dark" ? "bg-[#262626]" : "")}
            style={
              backdrop === "check"
                ? { backgroundColor: "#bbb", backgroundImage: "linear-gradient(45deg,#999 25%,transparent 25%,transparent 75%,#999 75%),linear-gradient(45deg,#999 25%,transparent 25%,transparent 75%,#999 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0,8px 8px" }
                : undefined
            }
          >
            {png ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local blob, not an optimisable asset
              <img src={png.url} alt={`Overlay: ${stats.map((s) => `${s.label} ${s.value}`).join(", ")}`} className="h-auto max-h-[52dvh] w-auto max-w-full" />
            ) : (
              <p className="text-sm text-white/70">Drawing…</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <fieldset className="flex items-center gap-2" disabled={!showRoute || !hasRoute}>
              <legend className="sr-only">Route colour</legend>
              {ROUTE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Route colour ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={cn("size-8 rounded-full border-2 transition-transform disabled:opacity-40", color === c ? "scale-110 border-ink" : "border-line-strong")}
                  style={{ background: c }}
                />
              ))}
            </fieldset>
            <div className="flex items-center gap-4 text-[13px] text-ink-2">
              {hasRoute ? (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={showRoute} onChange={(e) => setShowRoute(e.target.checked)} className="size-4 accent-[var(--sage-deep)]" />
                  Route
                </label>
              ) : null}
              <button type="button" className="underline-offset-4 hover:text-ink hover:underline" onClick={() => setBackdrop(backdrop === "dark" ? "check" : "dark")}>
                {backdrop === "dark" ? "Show transparency" : "Dark preview"}
              </button>
            </div>
          </div>
          {!hasRoute ? <p className="text-[12px] text-ink-3">This run has no GPS route, so the overlay shows the stats only.</p> : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <Button size="lg" onClick={download} disabled={!png}>
              Download PNG
            </Button>
            {canShareFile ? (
              <Button size="lg" variant="secondary" onClick={share} disabled={!png}>
                Share…
              </Button>
            ) : null}
          </div>
          {note ? (
            <p role="status" className="text-[13px] text-ink-2">
              {note}
            </p>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}
