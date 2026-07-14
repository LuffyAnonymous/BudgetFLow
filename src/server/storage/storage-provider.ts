export abstract class StorageProvider {
  /**
   * Uploads a file buffer to storage.
   */
  abstract upload(key: string, buffer: Buffer, mimeType: string): Promise<void>;

  /**
   * Opens a readable stream for a file from storage.
   */
  abstract openStream(key: string): Promise<NodeJS.ReadableStream>;

  /**
   * Deletes a file from storage.
   */
  abstract delete(key: string): Promise<void>;

  /**
   * Checks if a file exists in storage.
   */
  abstract exists(key: string): Promise<boolean>;

  /**
   * Retrieves metadata for a file in storage.
   */
  abstract getMetadata(key: string): Promise<{ size: number; contentType: string } | null>;
}
