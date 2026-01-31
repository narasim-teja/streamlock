/**
 * Video Processing Pipeline
 *
 * Orchestrates the full video processing flow:
 * 1. Write video to temp directory
 * 2. Get video metadata (duration)
 * 3. Validate against constraints
 * 4. Segment video with FFmpeg
 * 5. Generate cryptographic material (master secret, keys, Merkle tree)
 * 6. Encrypt each segment with AES-128-CBC
 * 7. Generate HLS playlists with EXT-X-KEY entries
 * 8. Cleanup temp files
 */

import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  segmentVideo,
  getVideoMetadata,
  encryptVideoSegments,
  generateHLSPackage,
  type HLSPackage,
} from '@streamlock/creator-sdk';
import {
  generateMasterSecret,
  deriveAllSegmentKeys,
  buildMerkleTree,
  getMerkleRoot,
  type MerkleTree,
} from '@streamlock/crypto';
import { setupFFmpeg } from './ffmpeg-setup';
import {
  validateVideoConstraints,
  validateVideoFormat,
  VideoProcessingError,
  type VideoMetadata,
} from './video-constraints';

/** Options for video processing */
export interface ProcessVideoOptions {
  /** Segment duration in seconds (default: 5) */
  segmentDuration?: number;
  /** Video quality preset (default: '720p') */
  quality?: '480p' | '720p' | '1080p';
  /** Max duration in seconds (default: 180 for Vercel Pro) */
  maxDurationSeconds?: number;
  /** Base URL for the key server (for HLS playlist EXT-X-KEY URIs) */
  keyServerBaseUrl?: string;
}

/** Result of video processing */
export interface ProcessVideoResult {
  /** Total number of segments */
  totalSegments: number;
  /** Video duration in seconds */
  durationSeconds: number;
  /** HLS package with playlists and encrypted segments */
  hlsPackage: HLSPackage;
  /** Master secret (32 bytes) */
  masterSecret: Buffer;
  /** Merkle root hash (hex string) */
  merkleRoot: string;
  /** Full Merkle tree for proof generation */
  merkleTree: MerkleTree;
}

/**
 * Process a video file through the full pipeline
 *
 * @param videoFile - Video file from form upload
 * @param videoId - Unique video identifier
 * @param options - Processing options
 * @returns Processing result with HLS package and crypto material
 */
export async function processVideo(
  videoFile: File,
  videoId: string,
  options: ProcessVideoOptions = {}
): Promise<ProcessVideoResult> {
  const {
    segmentDuration = 5,
    quality = '720p',
    keyServerBaseUrl = '/api',
  } = options;

  // Setup FFmpeg binary path
  setupFFmpeg();

  // Validate file format
  validateVideoFormat(videoFile.name);

  // Create temp directory for processing
  const tempDir = join(tmpdir(), `streamlock-${videoId}`);
  await mkdir(tempDir, { recursive: true });

  try {
    // 1. Write video file to temp directory
    const inputPath = join(tempDir, 'input.mp4');
    const videoBuffer = Buffer.from(await videoFile.arrayBuffer());
    await writeFile(inputPath, videoBuffer);

    // 2. Get video metadata
    const metadata = await getVideoMetadata(inputPath);
    const videoMetadata: VideoMetadata = {
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      fileSize: videoFile.size,
    };

    // 3. Validate against constraints
    validateVideoConstraints(videoMetadata);

    // 4. Segment video with FFmpeg
    console.log(`[VideoProcessor] Segmenting video: ${videoId}`);
    const segments = await segmentVideo(inputPath, {
      segmentDuration,
      quality,
    });
    console.log(`[VideoProcessor] Created ${segments.length} segments`);

    const totalSegments = segments.length;
    const durationSeconds = Math.ceil(metadata.duration);

    // 5. Generate cryptographic material
    console.log(`[VideoProcessor] Generating crypto material`);
    const masterSecret = generateMasterSecret();
    const keys = deriveAllSegmentKeys(masterSecret, videoId, totalSegments);
    const merkleTree = buildMerkleTree(keys);
    const merkleRoot = getMerkleRoot(merkleTree);

    // 6. Encrypt segments
    console.log(`[VideoProcessor] Encrypting ${totalSegments} segments`);
    const { encryptedSegments, ivs } = await encryptVideoSegments(
      segments,
      keys,
      videoId,
      masterSecret
    );

    // 7. Generate HLS package
    console.log(`[VideoProcessor] Generating HLS package`);
    const hlsPackage = generateHLSPackage(
      encryptedSegments,
      ivs,
      videoId,
      keyServerBaseUrl
    );

    console.log(`[VideoProcessor] Processing complete for video: ${videoId}`);

    return {
      totalSegments,
      durationSeconds,
      hlsPackage,
      masterSecret,
      merkleRoot,
      merkleTree,
    };
  } catch (error) {
    if (error instanceof VideoProcessingError) {
      throw error;
    }
    throw new VideoProcessingError(
      `Video processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'processing'
    );
  } finally {
    // 8. Cleanup temp directory
    await rm(tempDir, { recursive: true, force: true }).catch((err) => {
      console.warn(`[VideoProcessor] Failed to cleanup temp directory: ${err}`);
    });
  }
}

/**
 * Get video metadata without full processing
 * Useful for validation before upload
 */
export async function getVideoInfo(
  videoFile: File
): Promise<VideoMetadata & { estimatedSegments: number }> {
  setupFFmpeg();

  const tempDir = join(tmpdir(), `streamlock-probe-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  try {
    const inputPath = join(tempDir, 'input.mp4');
    const videoBuffer = Buffer.from(await videoFile.arrayBuffer());
    await writeFile(inputPath, videoBuffer);

    const metadata = await getVideoMetadata(inputPath);

    return {
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      fileSize: videoFile.size,
      estimatedSegments: Math.ceil(metadata.duration / 5),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
