/**
 * HLS package upload utilities
 *
 * Handles uploading the HLS package (playlists and encrypted segments)
 * to storage in batches for efficient parallel uploads.
 */

import type { StorageProvider, UploadFile } from '@streamlock/creator-sdk';
import type { HLSPackage } from '@streamlock/creator-sdk';

/** Batch size for parallel uploads */
const UPLOAD_BATCH_SIZE = 5;

/**
 * Upload an HLS package to storage
 *
 * @param storage - Storage provider instance
 * @param videoId - Unique video identifier
 * @param hlsPackage - HLS package containing playlists and segments
 * @returns URL to the master playlist
 */
export async function uploadHLSPackage(
  storage: StorageProvider,
  videoId: string,
  hlsPackage: HLSPackage
): Promise<string> {
  const files: UploadFile[] = [];

  // 1. Add master playlist
  files.push({
    path: `${videoId}/master.m3u8`,
    data: Buffer.from(hlsPackage.masterPlaylist, 'utf-8'),
    contentType: 'application/vnd.apple.mpegurl',
  });

  // 2. Add media playlists (one per quality level)
  for (const [quality, playlist] of hlsPackage.mediaPlaylists) {
    files.push({
      path: `${videoId}/${quality}/playlist.m3u8`,
      data: Buffer.from(playlist, 'utf-8'),
      contentType: 'application/vnd.apple.mpegurl',
    });
  }

  // 3. Add encrypted segments
  // Use video/mp2t (lowercase) to match Supabase bucket MIME type configuration
  for (const [segmentPath, data] of hlsPackage.segments) {
    files.push({
      path: `${videoId}/${segmentPath}`,
      data,
      contentType: 'video/mp2t',
    });
  }

  // Upload all files in batches
  const results = await uploadInBatches(storage, files, UPLOAD_BATCH_SIZE);

  // Return URL to master playlist
  const masterUrl = results.get(`${videoId}/master.m3u8`);
  if (!masterUrl) {
    throw new Error('Failed to get master playlist URL after upload');
  }

  return masterUrl;
}

/**
 * Upload files in parallel batches
 *
 * @param storage - Storage provider
 * @param files - Files to upload
 * @param batchSize - Number of concurrent uploads
 * @returns Map of path to URL
 */
async function uploadInBatches(
  storage: StorageProvider,
  files: UploadFile[],
  batchSize: number
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  // Process files in batches
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);

    // Upload batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        const url = await storage.upload(file.path, file.data, file.contentType);
        return { path: file.path, url };
      })
    );

    // Collect results
    for (const { path, url } of batchResults) {
      results.set(path, url);
    }
  }

  return results;
}

/**
 * Upload a thumbnail image
 *
 * @param storage - Storage provider
 * @param videoId - Unique video identifier
 * @param thumbnailFile - Thumbnail file
 * @returns URL to the uploaded thumbnail
 */
export async function uploadThumbnail(
  storage: StorageProvider,
  videoId: string,
  thumbnailFile: File
): Promise<string> {
  const extension = thumbnailFile.name.split('.').pop() || 'jpg';
  const buffer = Buffer.from(await thumbnailFile.arrayBuffer());

  return storage.upload(
    `${videoId}/thumbnail.${extension}`,
    buffer,
    thumbnailFile.type || 'image/jpeg'
  );
}
