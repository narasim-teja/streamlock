/**
 * Hex encoding utilities
 */

/** Convert Buffer/Uint8Array to hex string */
export function toHex(data: Buffer | Uint8Array): string {
  return Buffer.from(data).toString('hex');
}

/** Convert hex string to Buffer */
export function fromHex(hex: string): Buffer {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Buffer.from(cleanHex, 'hex');
}

/** Check if string is valid hex */
export function isValidHex(str: string): boolean {
  const cleanHex = str.startsWith('0x') ? str.slice(2) : str;
  return /^[0-9a-fA-F]*$/.test(cleanHex) && cleanHex.length % 2 === 0;
}

/** Convert Buffer to base64 */
export function toBase64(data: Buffer | Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

/** Convert base64 to Buffer */
export function fromBase64(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

/** Ensure hex string has 0x prefix */
export function ensureHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex : `0x${hex}`;
}

/** Remove 0x prefix from hex string */
export function removeHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}
