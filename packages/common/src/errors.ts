/**
 * Custom error classes for StreamLock protocol
 */

/** Base error class for StreamLock errors */
export class StreamLockError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'StreamLockError';
  }
}

/** Video not found */
export class VideoNotFoundError extends StreamLockError {
  constructor(videoId: string) {
    super(`Video not found: ${videoId}`, 'VIDEO_NOT_FOUND', { videoId });
    this.name = 'VideoNotFoundError';
  }
}

/** Session not found */
export class SessionNotFoundError extends StreamLockError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND', { sessionId });
    this.name = 'SessionNotFoundError';
  }
}

/** Session expired */
export class SessionExpiredError extends StreamLockError {
  constructor(sessionId: string) {
    super(`Session expired: ${sessionId}`, 'SESSION_EXPIRED', { sessionId });
    this.name = 'SessionExpiredError';
  }
}

/** Insufficient balance */
export class InsufficientBalanceError extends StreamLockError {
  constructor(required: bigint, available: bigint) {
    super(
      `Insufficient balance: required ${required}, available ${available}`,
      'INSUFFICIENT_BALANCE',
      { required: required.toString(), available: available.toString() }
    );
    this.name = 'InsufficientBalanceError';
  }
}

/** Payment verification failed */
export class PaymentVerificationError extends StreamLockError {
  constructor(txHash: string, reason: string) {
    super(`Payment verification failed: ${reason}`, 'PAYMENT_VERIFICATION_FAILED', {
      txHash,
      reason,
    });
    this.name = 'PaymentVerificationError';
  }
}

/** Invalid Merkle proof */
export class InvalidProofError extends StreamLockError {
  constructor(segmentIndex: number) {
    super(`Invalid Merkle proof for segment ${segmentIndex}`, 'INVALID_PROOF', {
      segmentIndex,
    });
    this.name = 'InvalidProofError';
  }
}

/** Creator not registered */
export class CreatorNotRegisteredError extends StreamLockError {
  constructor(address: string) {
    super(`Creator not registered: ${address}`, 'CREATOR_NOT_REGISTERED', { address });
    this.name = 'CreatorNotRegisteredError';
  }
}

/** Video not active */
export class VideoNotActiveError extends StreamLockError {
  constructor(videoId: string) {
    super(`Video is not active: ${videoId}`, 'VIDEO_NOT_ACTIVE', { videoId });
    this.name = 'VideoNotActiveError';
  }
}

/** Segment already paid */
export class SegmentAlreadyPaidError extends StreamLockError {
  constructor(segmentIndex: number) {
    super(`Segment already paid: ${segmentIndex}`, 'SEGMENT_ALREADY_PAID', { segmentIndex });
    this.name = 'SegmentAlreadyPaidError';
  }
}

/** Encryption error */
export class EncryptionError extends StreamLockError {
  constructor(message: string) {
    super(message, 'ENCRYPTION_ERROR');
    this.name = 'EncryptionError';
  }
}

/** Decryption error */
export class DecryptionError extends StreamLockError {
  constructor(message: string) {
    super(message, 'DECRYPTION_ERROR');
    this.name = 'DecryptionError';
  }
}

/** Video processing error */
export class VideoProcessingError extends StreamLockError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VIDEO_PROCESSING_ERROR', details);
    this.name = 'VideoProcessingError';
  }
}

/** Contract error (mapped from Move abort codes) */
export class ContractError extends StreamLockError {
  constructor(abortCode: number, message: string) {
    super(message, 'CONTRACT_ERROR', { abortCode });
    this.name = 'ContractError';
  }

  static fromAbortCode(code: number): ContractError {
    const messages: Record<number, string> = {
      1: 'Creator not registered',
      2: 'Creator already registered',
      3: 'Video not found',
      4: 'Video not active',
      5: 'Session not found',
      6: 'Session expired',
      7: 'Invalid segment index',
      8: 'Insufficient balance',
      9: 'Unauthorized',
      10: 'Invalid proof',
      11: 'Dispute exists',
      12: 'Invalid commitment',
      13: 'Protocol paused',
      14: 'Price too low',
      15: 'Segment already paid',
    };
    return new ContractError(code, messages[code] || `Unknown error code: ${code}`);
  }
}
