/**
 * Custom HLS.js loader that intercepts key requests and handles x402 payment flow
 *
 * This loader is critical for StreamLock's payment-gated video playback:
 * - Intercepts all HLS.js HTTP requests
 * - For key requests: delegates to X402KeyLoader which handles 402 → pay → retry
 * - For other requests: uses default XHR loader
 */

import Hls from 'hls.js';
import type {
  Loader,
  LoaderContext,
  LoaderConfiguration,
  LoaderCallbacks,
  LoaderStats,
  LoaderResponse,
  HlsConfig,
} from 'hls.js';
import type { X402KeyLoader } from './hlsLoader.js';

/** Configuration for X402HlsLoader */
export interface X402HlsLoaderConfig {
  /** The key loader instance that handles x402 payment flow */
  keyLoader: X402KeyLoader;
  /** Called when starting to load a key */
  onKeyLoading?: (segmentIndex: number) => void;
  /** Called when a key is successfully loaded */
  onKeyLoaded?: (segmentIndex: number) => void;
  /** Called when payment is required for a segment */
  onPaymentRequired?: (segmentIndex: number) => void;
  /** Called when payment is complete */
  onPaymentComplete?: (segmentIndex: number, txHash: string) => void;
  /** Called on error */
  onError?: (segmentIndex: number, error: Error) => void;
}

/**
 * Custom HLS.js loader that handles x402 payment-gated key requests
 *
 * HLS.js uses the `loader` config option for all HTTP requests. By providing
 * a custom loader, we can intercept key requests and handle the async payment
 * flow before returning the decryption key to HLS.js.
 */
export class X402HlsLoader implements Loader<LoaderContext> {
  private x402Config: X402HlsLoaderConfig;
  private defaultLoader: Loader<LoaderContext>;
  private _stats: LoaderStats;
  private _context: LoaderContext | null = null;
  private aborted: boolean = false;
  private abortController: AbortController | null = null;

  constructor(hlsConfig: HlsConfig, x402Config: X402HlsLoaderConfig) {
    this.x402Config = x402Config;

    // Create default loader for non-key requests
    // Use XHRLoader from HLS.js default config
    const DefaultLoader = Hls.DefaultConfig.loader as new (config: HlsConfig) => Loader<LoaderContext>;
    this.defaultLoader = new DefaultLoader(hlsConfig);

    // Initialize stats
    this._stats = {
      aborted: false,
      loaded: 0,
      retry: 0,
      total: 0,
      chunkCount: 0,
      bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 },
      parsing: { start: 0, end: 0 },
      buffering: { start: 0, first: 0, end: 0 },
    };
  }

  get stats(): LoaderStats {
    return this._stats;
  }

  get context(): LoaderContext | null {
    return this._context;
  }

  destroy(): void {
    this.aborted = true;
    this.abortController?.abort();
    this.defaultLoader.destroy();
  }

  abort(): void {
    this.aborted = true;
    this._stats.aborted = true;
    this.abortController?.abort();
    this.defaultLoader.abort();
  }

  load(
    context: LoaderContext,
    config: LoaderConfiguration,
    callbacks: LoaderCallbacks<LoaderContext>
  ): void {
    this._context = context;
    this.aborted = false;
    this._stats.aborted = false;
    this._stats.loading.start = performance.now();

    // Check if this is a key request
    if (this.isKeyRequest(context)) {
      this.loadKey(context, config, callbacks);
    } else {
      // Delegate to default loader for manifest, segments, etc.
      this.defaultLoader.load(context, config, callbacks);
    }
  }

  /**
   * Detect if this is a key request
   * Key requests have responseType 'arraybuffer' and URL contains /key/
   */
  private isKeyRequest(context: LoaderContext): boolean {
    const isKey = context.responseType === 'arraybuffer' && context.url.includes('/key/');
    console.log(`[X402HlsLoader] Request: ${context.url}, responseType: ${context.responseType}, isKey: ${isKey}`);
    return isKey;
  }

  /**
   * Handle key request through x402 payment flow
   */
  private async loadKey(
    context: LoaderContext,
    _config: LoaderConfiguration,
    callbacks: LoaderCallbacks<LoaderContext>
  ): Promise<void> {
    const url = context.url;

    // Extract segment index from URL (format: /key/{segment})
    const segmentMatch = url.match(/\/key\/(\d+)/);
    const segmentIndex = segmentMatch ? parseInt(segmentMatch[1], 10) : 0;

    // Create abort controller for this request
    this.abortController = new AbortController();

    this.x402Config.onKeyLoading?.(segmentIndex);

    try {
      // Use X402KeyLoader to handle the complete payment flow:
      // 1. Fetch key endpoint
      // 2. If 402, pay on-chain
      // 3. Retry with payment header
      // 4. Return key with Merkle proof (verified)
      const keyResponse = await this.x402Config.keyLoader.loadKey(segmentIndex);

      // Check if aborted during async operation
      if (this.aborted) {
        return;
      }

      // Convert base64 key to ArrayBuffer for HLS.js
      const keyBytes = Uint8Array.from(
        atob(keyResponse.key),
        (c) => c.charCodeAt(0)
      );

      // Debug: Verify key length (should be 16 bytes for AES-128)
      console.log(`[X402HlsLoader] Key for segment ${segmentIndex}: ${keyBytes.length} bytes`);
      console.log(`[X402HlsLoader] Key hex: ${Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('')}`);

      // Update stats
      this._stats.loaded = keyBytes.length;
      this._stats.total = keyBytes.length;
      this._stats.loading.first = performance.now();
      this._stats.loading.end = performance.now();

      this.x402Config.onKeyLoaded?.(segmentIndex);

      // Create response for HLS.js
      const response: LoaderResponse = {
        url: url,
        data: keyBytes.buffer,
      };

      // Success callback to HLS.js
      callbacks.onSuccess(response, this._stats, context, null);
    } catch (error) {
      // Check if aborted
      if (this.aborted) {
        return;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      this.x402Config.onError?.(segmentIndex, err);

      // Determine error code - 402 for payment issues, 500 for others
      const isPaymentError = err.message.includes('402') ||
                            err.message.includes('payment') ||
                            err.message.includes('Payment');

      callbacks.onError(
        {
          code: isPaymentError ? 402 : 500,
          text: err.message
        },
        context,
        null,
        this._stats
      );
    } finally {
      this.abortController = null;
    }
  }
}

/**
 * Factory function to create a loader class for HLS.js config
 *
 * Usage:
 * ```typescript
 * const X402Loader = createX402LoaderClass({
 *   keyLoader: myKeyLoader,
 *   onKeyLoading: (segment) => console.log('Loading key for segment', segment),
 * });
 *
 * const hls = new Hls({
 *   loader: X402Loader,
 * });
 * ```
 */
export function createX402LoaderClass(
  x402Config: X402HlsLoaderConfig
): new (hlsConfig: HlsConfig) => Loader<LoaderContext> {
  // Return a class that wraps X402HlsLoader with the provided config
  // Using a function that creates instances rather than class extension
  // to avoid TypeScript issues with anonymous class types
  return class implements Loader<LoaderContext> {
    private loader: X402HlsLoader;

    constructor(hlsConfig: HlsConfig) {
      this.loader = new X402HlsLoader(hlsConfig, x402Config);
    }

    get stats(): LoaderStats {
      return this.loader.stats;
    }

    get context(): LoaderContext | null {
      return this.loader.context;
    }

    destroy(): void {
      this.loader.destroy();
    }

    abort(): void {
      this.loader.abort();
    }

    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>
    ): void {
      this.loader.load(context, config, callbacks);
    }
  };
}
