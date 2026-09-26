import { useEffect, useRef } from "react";

/** Calls `onDone` after `ms` of unpaused time. Pausing keeps the remaining time. */
export function useCountdown(ms: number, paused: boolean, onDone: () => void) {
  const remaining = useRef(ms);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    if (paused) return;
    const start = Date.now();
    const timer = setTimeout(() => done.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - start;
    };
  }, [paused]);
}
