"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type LiveRouteRefreshProps = {
  enabled: boolean;
  intervalMs?: number;
};

export function LiveRouteRefresh({ enabled, intervalMs = 2000 }: LiveRouteRefreshProps) {
  const router = useRouter();
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const refresh = () => {
      if (inFlight.current) return;
      inFlight.current = true;
      router.refresh();
      window.setTimeout(() => {
        inFlight.current = false;
      }, 250);
    };

    const interval = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(interval);
  }, [enabled, intervalMs, router]);

  return null;
}
