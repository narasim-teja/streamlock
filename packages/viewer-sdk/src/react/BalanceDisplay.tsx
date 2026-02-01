/**
 * Balance display component
 */

import { formatSegmentCount } from '@streamlock/common';
import { formatUsdc } from '@streamlock/aptos';

/** Balance display props */
export interface BalanceDisplayProps {
  balance: bigint;
  totalPaid: bigint;
  segmentsWatched: number;
  totalSegments: number;
  pricePerSegment: bigint;
}

/** Balance display component */
export function BalanceDisplay({
  balance,
  totalPaid,
  segmentsWatched,
  totalSegments,
  pricePerSegment,
}: BalanceDisplayProps): JSX.Element {
  const segmentsRemaining = Number(balance / pricePerSegment);

  return (
    <div
      style={{
        background: '#f5f5f5',
        padding: '15px',
        borderRadius: '8px',
        fontSize: '14px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '10px',
        }}
      >
        <span>Remaining Balance:</span>
        <span style={{ fontWeight: 'bold' }}>{formatUsdc(balance)} USDC</span>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '10px',
        }}
      >
        <span>Total Paid:</span>
        <span style={{ fontWeight: 'bold' }}>{formatUsdc(totalPaid)} USDC</span>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '10px',
        }}
      >
        <span>Segments Watched:</span>
        <span style={{ fontWeight: 'bold' }}>
          {formatSegmentCount(segmentsWatched, totalSegments)}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Segments Remaining:</span>
        <span
          style={{
            fontWeight: 'bold',
            color: segmentsRemaining <= 5 ? 'red' : 'inherit',
          }}
        >
          ~{segmentsRemaining}
        </span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          marginTop: '15px',
          background: '#ddd',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${(segmentsWatched / totalSegments) * 100}%`,
            height: '8px',
            background: '#4caf50',
            transition: 'width 0.3s',
          }}
        />
      </div>
    </div>
  );
}
