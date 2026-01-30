/**
 * useSession hook
 */

import { useState, useCallback } from 'react';
import type { SessionInfo } from '@streamlock/common';

/** Session state */
export interface UseSessionState {
  session: SessionInfo | null;
  isActive: boolean;
  isExpired: boolean;
  remainingBalance: bigint;
  segmentsPaid: number;
}

/** Session actions */
export interface UseSessionActions {
  setSession: (session: SessionInfo | null) => void;
  updateBalance: (newBalance: bigint) => void;
  incrementSegmentsPaid: () => void;
}

/** useSession hook */
export function useSession(): [UseSessionState, UseSessionActions] {
  const [session, setSessionState] = useState<SessionInfo | null>(null);

  const isActive = session?.sessionId !== undefined;
  const isExpired = session ? Date.now() / 1000 > session.expiresAt : false;
  const remainingBalance = session?.prepaidBalance ?? 0n;
  const segmentsPaid = session?.segmentsPaid ?? 0;

  const setSession = useCallback((newSession: SessionInfo | null) => {
    setSessionState(newSession);
  }, []);

  const updateBalance = useCallback((newBalance: bigint) => {
    setSessionState((prev) =>
      prev
        ? {
            ...prev,
            prepaidBalance: newBalance,
          }
        : null
    );
  }, []);

  const incrementSegmentsPaid = useCallback(() => {
    setSessionState((prev) =>
      prev
        ? {
            ...prev,
            segmentsPaid: prev.segmentsPaid + 1,
          }
        : null
    );
  }, []);

  const state: UseSessionState = {
    session,
    isActive,
    isExpired,
    remainingBalance,
    segmentsPaid,
  };

  const actions: UseSessionActions = {
    setSession,
    updateBalance,
    incrementSegmentsPaid,
  };

  return [state, actions];
}
