"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const THRESHOLD = 70;

export function usePullToRefresh(onRefresh: () => void) {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const active = useRef(false);
  const distanceRef = useRef(0);
  const onRefreshRef = useRef(onRefresh);
  // eslint-disable-next-line react-hooks/refs -- latest-ref for the gesture handler
  onRefreshRef.current = onRefresh;

  const finish = useCallback(() => {
    active.current = false;
    startY.current = null;
    distanceRef.current = 0;
    setDistance(0);
  }, []);

  useEffect(() => {
    function canPull(e: TouchEvent) {
      if (window.scrollY > 0) return false;
      const el = e.target as HTMLElement | null;
      const scrollable = el?.closest(".sec-table-wrap, .kanban-scroll, .activity-list, .project-strip, .agent-grid, .idea-list");
      return !(scrollable && scrollable.scrollTop > 0);
    }

    function onStart(e: TouchEvent) {
      if (e.touches.length !== 1 || !canPull(e)) return;
      startY.current = e.touches[0].clientY;
      active.current = true;
    }

    function onMove(e: TouchEvent) {
      if (!active.current || startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) { distanceRef.current = 0; setDistance(0); return; }
      distanceRef.current = Math.min(dy, THRESHOLD + 40);
      setDistance(distanceRef.current);
    }

    function onEnd() {
      if (!active.current) return;
      if (distanceRef.current >= THRESHOLD) {
        setRefreshing(true);
        Promise.resolve().then(() => onRefreshRef.current()).finally(() => setRefreshing(false));
      }
      finish();
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", finish, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", finish);
    };
  }, [finish]);

  return { distance, refreshing };
}
