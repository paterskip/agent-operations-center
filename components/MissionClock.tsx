"use client";

import { useEffect, useState } from "react";

/** Zegar „mission control" w nagłówku — aktualizuje się co sekundę. */
export function MissionClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    const first = setTimeout(() => setNow(new Date()), 0);
    return () => { clearInterval(id); clearTimeout(first); };
  }, []);

  return <span className="mission-clock" aria-label="Aktualny czas">{now ? now.toLocaleTimeString("pl-PL", { hour12: false }) : "—"}</span>;
}
