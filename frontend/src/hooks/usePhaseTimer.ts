import { useState, useEffect, useRef } from 'react';

interface UsePhaseTimerOptions {
  phaseEndsAt: string | null;
  serverNow: string;
}

interface UsePhaseTimerReturn {
  remainingMs: number;
  remainingFormatted: string;
}

/**
 * countdown timer for game phases.
 * syncs with server time and counts down locally.
 */
export function usePhaseTimer({
  phaseEndsAt,
  serverNow,
}: UsePhaseTimerOptions): UsePhaseTimerReturn {
  const [remainingMs, setRemainingMs] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!phaseEndsAt) {
      setRemainingMs(0);
      return;
    }

    // initial remaining time from server timestamps
    const endsAt = new Date(phaseEndsAt).getTime();
    const now = new Date(serverNow).getTime();
    const initialRemaining = Math.max(0, endsAt - now);

    setRemainingMs(initialRemaining);

    const startTime = Date.now();
    const startRemaining = initialRemaining;

    // tick every 100ms for smooth countdown, stop at zero
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newRemaining = Math.max(0, startRemaining - elapsed);
      setRemainingMs(newRemaining);

      if (newRemaining <= 0 && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [phaseEndsAt, serverNow]);

  const remainingFormatted = formatTime(remainingMs);

  return { remainingMs, remainingFormatted };
}

function formatTime(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

