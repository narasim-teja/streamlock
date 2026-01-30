/**
 * Display formatting utilities
 */

import { OCTAS_PER_APT } from '../constants.js';

/** Format octas to APT with specified decimals */
export function formatApt(octas: bigint, decimals: number = 4): string {
  const apt = Number(octas) / Number(OCTAS_PER_APT);
  return apt.toFixed(decimals);
}

/** Convert APT to octas */
export function aptToOctas(apt: number): bigint {
  return BigInt(Math.floor(apt * Number(OCTAS_PER_APT)));
}

/** Format duration in seconds to human readable */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/** Format timestamp to ISO string */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

/** Truncate address for display */
export function truncateAddress(address: string, chars: number = 6): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/** Format file size */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/** Format segment count */
export function formatSegmentCount(current: number, total: number): string {
  return `${current}/${total}`;
}
