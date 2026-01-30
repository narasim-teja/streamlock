/**
 * usePayment hook
 */

import { useState, useCallback } from 'react';
import type { PaymentEvent } from '@streamlock/common';

/** Payment state */
export interface UsePaymentState {
  payments: PaymentEvent[];
  totalPaid: bigint;
  lastPayment: PaymentEvent | null;
  isPaying: boolean;
}

/** Payment actions */
export interface UsePaymentActions {
  addPayment: (payment: PaymentEvent) => void;
  clearPayments: () => void;
  setIsPaying: (isPaying: boolean) => void;
}

/** usePayment hook */
export function usePayment(): [UsePaymentState, UsePaymentActions] {
  const [payments, setPayments] = useState<PaymentEvent[]>([]);
  const [isPaying, setIsPaying] = useState(false);

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0n);
  const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null;

  const addPayment = useCallback((payment: PaymentEvent) => {
    setPayments((prev) => [...prev, payment]);
  }, []);

  const clearPayments = useCallback(() => {
    setPayments([]);
  }, []);

  const state: UsePaymentState = {
    payments,
    totalPaid,
    lastPayment,
    isPaying,
  };

  const actions: UsePaymentActions = {
    addPayment,
    clearPayments,
    setIsPaying,
  };

  return [state, actions];
}
