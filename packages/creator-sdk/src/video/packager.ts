/**
 * HLS playlist generation
 */

import type { EncryptedSegment } from '@streamlock/common';

/** HLS package output */
export interface HLSPackage {
  masterPlaylist: string;
  mediaPlaylists: Map<string, string>;
  segments: Map<string, Buffer>;
}

/**
 * Generate HLS package with encrypted segments
 */
export function generateHLSPackage(
  encryptedSegments: EncryptedSegment[],
  ivs: Buffer[],
  videoId: string,
  keyServerBaseUrl: string
): HLSPackage {
  const quality = '720p';
  const segmentDuration = 5; // Should come from actual segment durations

  // Generate master playlist
  const masterPlaylist = generateMasterPlaylist(quality);

  // Generate media playlist
  const mediaPlaylist = generateMediaPlaylist(
    encryptedSegments,
    ivs,
    videoId,
    keyServerBaseUrl,
    segmentDuration
  );

  // Build segments map
  const segments = new Map<string, Buffer>();
  for (const segment of encryptedSegments) {
    segments.set(`${quality}/segment_${segment.index.toString().padStart(3, '0')}.ts`, segment.data);
  }

  return {
    masterPlaylist,
    mediaPlaylists: new Map([[quality, mediaPlaylist]]),
    segments,
  };
}

/**
 * Generate master playlist (m3u8)
 */
function generateMasterPlaylist(quality: string): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    '',
    '# 720p variant',
    '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720',
    `${quality}/playlist.m3u8`,
  ];

  return lines.join('\n');
}

/**
 * Generate media playlist with EXT-X-KEY entries
 */
function generateMediaPlaylist(
  segments: EncryptedSegment[],
  ivs: Buffer[],
  videoId: string,
  keyServerBaseUrl: string,
  segmentDuration: number
): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    `#EXT-X-TARGETDURATION:${Math.ceil(segmentDuration)}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];

  for (let i = 0; i < segments.length; i++) {
    const iv = ivs[i];
    const ivHex = iv.toString('hex');

    // Add key entry for each segment (or could group them)
    // The key URI points to our x402-gated endpoint
    const keyUri = `${keyServerBaseUrl}/videos/${videoId}/key/${i}`;

    lines.push('');
    lines.push(`#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}",IV=0x${ivHex}`);
    lines.push(`#EXTINF:${segmentDuration.toFixed(3)},`);
    lines.push(`segment_${i.toString().padStart(3, '0')}.ts`);
  }

  lines.push('');
  lines.push('#EXT-X-ENDLIST');

  return lines.join('\n');
}

/**
 * Generate playlist with key rotation (one key per N segments)
 */
export function generatePlaylistWithKeyRotation(
  segments: EncryptedSegment[],
  ivs: Buffer[],
  videoId: string,
  keyServerBaseUrl: string,
  segmentDuration: number,
  keyRotationInterval: number = 1 // Key per segment by default
): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    `#EXT-X-TARGETDURATION:${Math.ceil(segmentDuration)}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];

  let currentKeyIndex = -1;

  for (let i = 0; i < segments.length; i++) {
    const keyIndex = Math.floor(i / keyRotationInterval);

    // Add key entry when key changes
    if (keyIndex !== currentKeyIndex) {
      const iv = ivs[i];
      const ivHex = iv.toString('hex');
      const keyUri = `${keyServerBaseUrl}/videos/${videoId}/key/${i}`;

      lines.push('');
      lines.push(`#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}",IV=0x${ivHex}`);
      currentKeyIndex = keyIndex;
    }

    lines.push(`#EXTINF:${segmentDuration.toFixed(3)},`);
    lines.push(`segment_${i.toString().padStart(3, '0')}.ts`);
  }

  lines.push('');
  lines.push('#EXT-X-ENDLIST');

  return lines.join('\n');
}
