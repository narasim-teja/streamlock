/**
 * FFmpeg setup for serverless environments
 *
 * Configures fluent-ffmpeg to use the ffmpeg-static binary
 * which is bundled with the application for Vercel deployment.
 */

import ffmpeg from 'fluent-ffmpeg';

let isConfigured = false;

/**
 * Configure FFmpeg to use the static binary from ffmpeg-static package.
 * This must be called before any FFmpeg operations.
 */
export function setupFFmpeg(): void {
  if (isConfigured) return;

  // Dynamic import to handle the ESM/CJS interop
  // ffmpeg-static exports the path to the binary
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegPath = require('ffmpeg-static') as string;
    if (ffmpegPath) {
      ffmpeg.setFfmpegPath(ffmpegPath);
      isConfigured = true;
      console.log('[FFmpeg] Configured with path:', ffmpegPath);
    }
  } catch (error) {
    console.warn('[FFmpeg] Could not load ffmpeg-static, using system FFmpeg:', error);
    // Fall back to system FFmpeg if available
  }
}

/**
 * Get the configured FFmpeg instance
 */
export function getFFmpeg(): typeof ffmpeg {
  setupFFmpeg();
  return ffmpeg;
}
