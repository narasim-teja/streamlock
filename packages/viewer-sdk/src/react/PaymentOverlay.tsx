/**
 * Payment overlay component
 */

import { formatUsdc } from '@streamlock/aptos';

/** Payment overlay props */
export interface PaymentOverlayProps {
  remainingBalance: bigint;
  pricePerSegment: bigint;
  isLowBalance: boolean;
  onTopUp: () => void;
  isVisible?: boolean;
}

/** Payment overlay component */
export function PaymentOverlay({
  remainingBalance,
  pricePerSegment,
  isLowBalance,
  onTopUp,
  isVisible = true,
}: PaymentOverlayProps): JSX.Element | null {
  if (!isVisible) return null;

  const segmentsRemaining = Number(remainingBalance / pricePerSegment);

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        background: isLowBalance
          ? 'rgba(255, 0, 0, 0.8)'
          : 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '10px 15px',
        borderRadius: '8px',
        fontSize: '14px',
        zIndex: 1000,
      }}
    >
      <div style={{ marginBottom: '5px' }}>
        Balance: {formatUsdc(remainingBalance)} USDC
      </div>
      <div style={{ marginBottom: '5px' }}>
        ~{segmentsRemaining} segments remaining
      </div>
      {isLowBalance && (
        <button
          onClick={onTopUp}
          style={{
            background: '#fff',
            color: '#000',
            border: 'none',
            padding: '5px 10px',
            borderRadius: '4px',
            cursor: 'pointer',
            marginTop: '5px',
          }}
        >
          Top Up
        </button>
      )}
    </div>
  );
}
