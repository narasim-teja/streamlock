/**
 * Video segmentation using FFmpeg
 */

import ffmpeg from 'fluent-ffmpeg';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, readdir, readFile, rm } from 'fs/promises';
import type { Segment } from '@streamlock/common';
import { VideoProcessingError } from '@streamlock/common';

/** Segmenter options */
export interface SegmenterOptions {
  segmentDuration: number;
  quality: '480p' | '720p' | '1080p';
}

/** Quality presets */
const QUALITY_PRESETS = {
  '480p': { width: 854, height: 480, bitrate: '1000k' },
  '720p': { width: 1280, height: 720, bitrate: '2500k' },
  '1080p': { width: 1920, height: 1080, bitrate: '5000k' },
} as const;

/**
 * Segment a video file into HLS-compatible segments
 */
export async function segmentVideo(
  input: File | Buffer | string,
  options: SegmenterOptions
): Promise<Segment[]> {
  const { segmentDuration, quality } = options;
  const preset = QUALITY_PRESETS[quality];

  // Create temp directory for processing
  const tempDir = join(tmpdir(), `streamlock-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  try {
    // Handle different input types
    let inputPath: string;

    if (typeof input === 'string') {
      inputPath = input;
    } else if (Buffer.isBuffer(input)) {
      inputPath = join(tempDir, 'input.mp4');
      await Bun.write(inputPath, input);
    } else {
      // File object
      inputPath = join(tempDir, 'input.mp4');
      const arrayBuffer = await input.arrayBuffer();
      await Bun.write(inputPath, Buffer.from(arrayBuffer));
    }

    const segmentPattern = join(tempDir, 'segment_%03d.ts');

    // Run FFmpeg segmentation
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          `-c:v libx264`,
          `-preset fast`,
          `-b:v ${preset.bitrate}`,
          `-vf scale=${preset.width}:${preset.height}`,
          `-c:a aac`,
          `-b:a 128k`,
          `-f segment`,
          `-segment_time ${segmentDuration}`,
          `-reset_timestamps 1`,
          `-map 0:v:0`,
          `-map 0:a:0?`, // Optional audio
        ])
        .output(segmentPattern)
        .on('end', () => resolve())
        .on('error', (err) =>
          reject(new VideoProcessingError(`FFmpeg error: ${err.message}`))
        )
        .run();
    });

    // Read segments
    const files = await readdir(tempDir);
    const segmentFiles = files
      .filter((f) => f.startsWith('segment_') && f.endsWith('.ts'))
      .sort();

    const segments: Segment[] = [];

    for (let i = 0; i < segmentFiles.length; i++) {
      const filePath = join(tempDir, segmentFiles[i]);
      const data = await readFile(filePath);

      // Get duration (approximate based on segment time)
      const isLast = i === segmentFiles.length - 1;
      const duration = isLast ? segmentDuration : segmentDuration; // Could probe for exact

      segments.push({
        index: i,
        duration,
        data: Buffer.from(data),
      });
    }

    return segments;
  } catch (error) {
    if (error instanceof VideoProcessingError) {
      throw error;
    }
    throw new VideoProcessingError(
      `Failed to segment video: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  } finally {
    // Cleanup temp directory
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Get video metadata (duration, resolution, etc.)
 */
export function getVideoMetadata(
  inputPath: string
): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
}> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(new VideoProcessingError(`Failed to probe video: ${err.message}`));
        return;
      }

      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      if (!videoStream) {
        reject(new VideoProcessingError('No video stream found'));
        return;
      }

      resolve({
        duration: metadata.format.duration ?? 0,
        width: videoStream.width ?? 0,
        height: videoStream.height ?? 0,
        fps: videoStream.r_frame_rate
          ? eval(videoStream.r_frame_rate) // "30/1" -> 30
          : 30,
      });
    });
  });
}
