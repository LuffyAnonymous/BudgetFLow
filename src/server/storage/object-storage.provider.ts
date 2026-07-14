import "server-only";
import { StorageProvider } from "./storage-provider";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

/**
 * ObjectStorageProvider implements S3-compatible object storage.
 *
 * Compatible with AWS S3, Cloudflare R2, Supabase Storage, and any
 * S3-compatible provider.
 *
 * Configuration (all required when STORAGE_TYPE=s3):
 *   STORAGE_S3_BUCKET           Bucket name
 *   STORAGE_S3_REGION           AWS/provider region
 *   STORAGE_S3_ACCESS_KEY_ID    Access key
 *   STORAGE_S3_SECRET_ACCESS_KEY  Secret key
 *   STORAGE_S3_ENDPOINT         Optional: custom endpoint for R2/MinIO
 *
 * Startup behavior:
 *   - Throws immediately if any required credential is missing.
 *   - Does NOT fall back to local disk storage.
 *   - Does NOT expose credential values in error messages.
 */
export class ObjectStorageProvider extends StorageProvider {
  private bucket: string;
  private s3Client: S3Client;

  constructor() {
    super();

    const bucket = process.env.STORAGE_S3_BUCKET;
    const region = process.env.STORAGE_S3_REGION;
    const accessKeyId = process.env.STORAGE_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.STORAGE_S3_SECRET_ACCESS_KEY;
    const endpoint = process.env.STORAGE_S3_ENDPOINT;

    const missing: string[] = [];
    if (!bucket) missing.push("STORAGE_S3_BUCKET");
    if (!region) missing.push("STORAGE_S3_REGION");
    if (!accessKeyId) missing.push("STORAGE_S3_ACCESS_KEY_ID");
    if (!secretAccessKey) missing.push("STORAGE_S3_SECRET_ACCESS_KEY");

    if (missing.length > 0) {
      throw new Error(
        `STORAGE_CONFIG_MISSING: Object storage is not fully configured. ` +
        `The following environment variables are required: ${missing.join(", ")}. ` +
        `See deployment documentation for setup instructions.`
      );
    }

    this.bucket = bucket!;
    this.s3Client = new S3Client({
      region: region!,
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
      },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ServerSideEncryption: "AES256",
      })
    );
  }

  async openStream(key: string): Promise<NodeJS.ReadableStream> {
    const response = await this.s3Client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );

    if (!response.Body) {
      throw new Error(`Object not found in storage: ${key}`);
    }

    // @aws-sdk/client-s3 v3 returns a Readable stream via response.Body
    return response.Body as unknown as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3Client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(key: string): Promise<{ size: number; contentType: string } | null> {
    try {
      const response = await this.s3Client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return {
        size: response.ContentLength ?? 0,
        contentType: response.ContentType ?? "application/octet-stream",
      };
    } catch {
      return null;
    }
  }
}
