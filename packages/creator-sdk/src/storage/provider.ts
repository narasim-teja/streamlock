/**
 * Storage provider interface for uploading video content
 */

/** File to upload */
export interface UploadFile {
  path: string;
  data: Buffer;
  contentType: string;
}

/** Storage provider interface */
export interface StorageProvider {
  /**
   * Upload a single file
   * @param path - File path/key
   * @param data - File data
   * @param contentType - MIME type
   * @returns Public URL of the uploaded file
   */
  upload(path: string, data: Buffer, contentType: string): Promise<string>;

  /**
   * Upload multiple files in batch
   * @param files - Array of files to upload
   * @returns Map of path to public URL
   */
  uploadBatch(files: UploadFile[]): Promise<Map<string, string>>;

  /**
   * Delete a file
   * @param path - File path/key
   */
  delete(path: string): Promise<void>;

  /**
   * Check if a file exists
   * @param path - File path/key
   */
  exists(path: string): Promise<boolean>;

  /**
   * Get the public URL for a file
   * @param path - File path/key
   */
  getUrl(path: string): string;
}
