"use client";

import { MotionConfig } from "motion/react";
import { useEffect } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  // iOS Safari ignores user-scalable=no: block its page pinch-zoom so the app keeps its frame
  // (the map's own pinch is handled on its canvas, which already takes every touch)
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    const pinch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    document.addEventListener("gesturestart", block);
    document.addEventListener("gesturechange", block);
    document.addEventListener("touchmove", pinch, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", block);
      document.removeEventListener("gesturechange", block);
      document.removeEventListener("touchmove", pinch);
    };
  }, []);
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
