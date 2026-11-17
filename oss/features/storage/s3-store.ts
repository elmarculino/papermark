import { S3Store } from "@tus/s3-store";

import { type StorageConfig, getStorageConfig } from "./config";

// Built at module load (tus routes create the store at import time), so don't throw when
// env is missing, e.g. during `next build`. Uploads then fail with a clear S3 error instead.
function readConfig(): StorageConfig {
  try {
    return getStorageConfig();
  } catch (error) {
    console.warn(
      `[storage] ${(error as Error).message}; tus uploads will fail`,
    );
    return {
      bucket: "",
      region: "us-east-1",
      accessKeyId: "",
      secretAccessKey: "",
      forcePathStyle: false,
    };
  }
}

/**
 * tus datastore for document uploads. Self-hosted there is a single region,
 * so this is a plain S3Store configured from env.
 */
export class MultiRegionS3Store extends S3Store {
  constructor() {
    const config = readConfig();
    super({
      partSize: 8 * 1024 * 1024,
      s3ClientConfig: {
        bucket: config.bucket,
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      },
    });
  }
}
