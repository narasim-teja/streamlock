/**
 * Local file system storage provider
 */

import { mkdir, writeFile, unlink, access } from 'fs/promises';
import { dirname, join } from 'path';
import type { StorageProvider, UploadFile } from './provider';

/** Local storage configuration */
export interface LocalStorageConfig {
  /** Base path on disk to store files */
  basePath: string;
  /** Base URL for serving files (e.g., http://localhost:3000/videos) */
  baseUrl: string;
}

/**
 * Local file system storage provider
 *
 * Stores files on the local disk and returns URLs based on a configured base URL.
 * Useful for development and testing.
 */
export class LocalStorageProvider implements StorageProvider {
  private basePath: string;
  private baseUrl: string;

  constructor(config: LocalStorageConfig) {
    this.basePath = config.basePath;
    // Remove trailing slash from baseUrl
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  async upload(path: string, data: Buffer, _contentType: string): Promise<string> {
    const fullPath = join(this.basePath, path);
    const dir = dirname(fullPath);

    // Ensure directory exists
    await mkdir(dir, { recursive: true });

    // Write file
    await writeFile(fullPath, data);

    return this.getUrl(path);
  }

  async uploadBatch(files: UploadFile[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    // Upload files concurrently
    await Promise.all(
      files.map(async (file) => {
        const url = await this.upload(file.path, file.data, file.contentType);
        results.set(file.path, url);
      })
    );

    return results;
  }

  async delete(path: string): Promise<void> {
    const fullPath = join(this.basePath, path);
    try {
      await unlink(fullPath);
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    const fullPath = join(this.basePath, path);
    try {
      await access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  getUrl(path: string): string {
    return `${this.baseUrl}/${path}`;
  }
}
