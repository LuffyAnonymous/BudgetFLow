import { StorageProvider } from "./storage-provider";
import { LocalStorageProvider } from "./local-storage.provider";
import { ObjectStorageProvider } from "./object-storage.provider";

let _provider: StorageProvider | null = null;

/**
 * Returns the configured storage provider singleton.
 *
 * - In development (default): uses LocalStorageProvider (local filesystem /uploads).
 * - In production or when STORAGE_TYPE=s3: uses ObjectStorageProvider (S3/R2).
 *   Throws immediately if required S3 credentials are not configured.
 *   Never falls back to local disk silently.
 */
export function getStorageProvider(): StorageProvider {
  if (_provider) return _provider;

  const storageType = process.env.STORAGE_TYPE;

  if (storageType === "s3" || storageType === "r2") {
    _provider = new ObjectStorageProvider();
  } else {
    _provider = new LocalStorageProvider();
  }

  return _provider;
}

// Reset for testing purposes
export function _resetStorageProvider() {
  _provider = null;
}
