import { StorageProvider } from "./storage-provider";
import * as fs from "fs/promises";
import * as path from "path";
import { createReadStream, existsSync } from "fs";

export class LocalStorageProvider extends StorageProvider {
  private uploadDir: string;

  constructor(uploadDir?: string) {
    super();
    // Default to a folder named "uploads" in the project root
    this.uploadDir = uploadDir || path.join(process.cwd(), "uploads");
  }

  private async ensureDir() {
    try {
      await fs.mkdir(this.uploadDir, { recursive: true });
    } catch {
      // Ignore directory creation failures
    }
  }

  private getFilePath(key: string): string {
    // Sanitize the storage key to prevent directory traversal
    const safeKey = path.basename(key);
    return path.join(this.uploadDir, safeKey);
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    // mimeType is stored in DB metadata; local storage writes raw bytes only
    void mimeType;
    await this.ensureDir();
    const filePath = this.getFilePath(key);
    await fs.writeFile(filePath, buffer);
  }

  async openStream(key: string): Promise<NodeJS.ReadableStream> {
    const filePath = this.getFilePath(key);
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${key}`);
    }
    return createReadStream(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    if (existsSync(filePath)) {
      await fs.unlink(filePath);
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key);
    return existsSync(filePath);
  }

  async getMetadata(key: string): Promise<{ size: number; contentType: string } | null> {
    const filePath = this.getFilePath(key);
    if (!existsSync(filePath)) {
      return null;
    }
    const stat = await fs.stat(filePath);
    return {
      size: stat.size,
      contentType: "application/octet-stream", // local storage does not save original content types
    };
  }
}
