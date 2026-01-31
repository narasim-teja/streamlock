/**
 * Video upload constraints and validation
 *
 * Enforces limits based on Vercel serverless function constraints:
 * - Pro tier: 60s timeout, 512MB /tmp storage
 */

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  fileSize: number;
}

export interface VideoConstraints {
  maxDurationSeconds: number;
  maxFileSizeMB: number;
  allowedFormats: string[];
}

// Vercel Pro tier constraints
// Processing estimate: ~30-45s for a 3-minute video
// Leave 15s buffer for upload to storage
const DEFAULT_CONSTRAINTS: VideoConstraints = {
  maxDurationSeconds: 180, // 3 minutes = ~36 segments at 5s each
  maxFileSizeMB: 200, // 200MB max file size
  allowedFormats: ['mp4', 'webm', 'mov', 'avi', 'mkv'],
};

/**
 * Custom error for video processing failures
 */
export class VideoProcessingError extends Error {
  constructor(
    message: string,
    public stage: string
  ) {
    super(message);
    this.name = 'VideoProcessingError';
  }
}

/**
 * Error when video exceeds duration limit
 */
export class VideoTooLongError extends VideoProcessingError {
  constructor(
    public actualDuration: number,
    public maxDuration: number
  ) {
    super(
      `Video duration ${actualDuration.toFixed(1)}s exceeds limit of ${maxDuration}s`,
      'validation'
    );
    this.name = 'VideoTooLongError';
  }
}

/**
 * Error when video file exceeds size limit
 */
export class VideoTooLargeError extends VideoProcessingError {
  constructor(
    public actualSizeMB: number,
    public maxSizeMB: number
  ) {
    super(
      `Video size ${actualSizeMB.toFixed(1)}MB exceeds limit of ${maxSizeMB}MB`,
      'validation'
    );
    this.name = 'VideoTooLargeError';
  }
}

/**
 * Error when video format is not supported
 */
export class UnsupportedFormatError extends VideoProcessingError {
  constructor(
    public format: string,
    public allowedFormats: string[]
  ) {
    super(
      `Video format "${format}" is not supported. Allowed formats: ${allowedFormats.join(', ')}`,
      'validation'
    );
    this.name = 'UnsupportedFormatError';
  }
}

/**
 * Get constraints based on environment
 */
export function getConstraints(): VideoConstraints {
  const maxDuration = process.env.MAX_VIDEO_DURATION_SECONDS
    ? parseInt(process.env.MAX_VIDEO_DURATION_SECONDS, 10)
    : DEFAULT_CONSTRAINTS.maxDurationSeconds;

  const maxSize = process.env.MAX_VIDEO_SIZE_MB
    ? parseInt(process.env.MAX_VIDEO_SIZE_MB, 10)
    : DEFAULT_CONSTRAINTS.maxFileSizeMB;

  return {
    maxDurationSeconds: maxDuration,
    maxFileSizeMB: maxSize,
    allowedFormats: DEFAULT_CONSTRAINTS.allowedFormats,
  };
}

/**
 * Validate video metadata against constraints
 * @throws VideoTooLongError if duration exceeds limit
 * @throws VideoTooLargeError if file size exceeds limit
 */
export function validateVideoConstraints(
  metadata: VideoMetadata,
  constraints: VideoConstraints = getConstraints()
): void {
  // Check duration
  if (metadata.duration > constraints.maxDurationSeconds) {
    throw new VideoTooLongError(metadata.duration, constraints.maxDurationSeconds);
  }

  // Check file size
  const fileSizeMB = metadata.fileSize / (1024 * 1024);
  if (fileSizeMB > constraints.maxFileSizeMB) {
    throw new VideoTooLargeError(fileSizeMB, constraints.maxFileSizeMB);
  }
}

/**
 * Validate video file format by extension
 * @throws UnsupportedFormatError if format is not allowed
 */
export function validateVideoFormat(
  filename: string,
  constraints: VideoConstraints = getConstraints()
): void {
  const extension = filename.split('.').pop()?.toLowerCase() || '';

  if (!constraints.allowedFormats.includes(extension)) {
    throw new UnsupportedFormatError(extension, constraints.allowedFormats);
  }
}

/**
 * Calculate expected number of segments based on duration
 */
export function calculateSegmentCount(durationSeconds: number, segmentDuration: number = 5): number {
  return Math.ceil(durationSeconds / segmentDuration);
}
