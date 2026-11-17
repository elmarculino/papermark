/**
 * Single-region S3-compatible storage config from env (AWS S3, MinIO, Garage, R2…).
 * Self-hosted: every team uses the same bucket; there are no per-team regions.
 */
export interface StorageConfig {
  bucket: string;
  /** Optional second bucket (upstream uses it for advanced Excel viewing). */
  advancedBucket?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  /** Path-style URLs (`endpoint/bucket/key`). Needed by MinIO/Garage without wildcard DNS. */
  forcePathStyle: boolean;
  /** Optional CloudFront host for signed downloads. */
  distributionHost?: string;
  distributionKeyId?: string;
  distributionKeyContents?: string;
  /** AWS Lambda used for bulk ZIP downloads (AWS only; not available with other providers). */
  lambdaFunctionName?: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required storage env var: ${name}`);
  }
  return value;
}

/** `_storageRegion` is accepted for interface parity and ignored: there is one region. */
export function getStorageConfig(_storageRegion?: string): StorageConfig {
  return {
    bucket: required("NEXT_PRIVATE_UPLOAD_BUCKET"),
    advancedBucket:
      process.env.NEXT_PRIVATE_ADVANCED_UPLOAD_BUCKET || undefined,
    region: process.env.NEXT_PRIVATE_UPLOAD_REGION || "us-east-1",
    accessKeyId: required("NEXT_PRIVATE_UPLOAD_ACCESS_KEY_ID"),
    secretAccessKey: required("NEXT_PRIVATE_UPLOAD_SECRET_ACCESS_KEY"),
    endpoint: process.env.NEXT_PRIVATE_UPLOAD_ENDPOINT || undefined,
    forcePathStyle: process.env.NEXT_PRIVATE_UPLOAD_FORCE_PATH_STYLE === "true",
    distributionHost:
      process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST || undefined,
    distributionKeyId:
      process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_KEY_ID || undefined,
    distributionKeyContents:
      process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_KEY_CONTENTS || undefined,
    lambdaFunctionName:
      process.env.NEXT_PRIVATE_DOWNLOAD_LAMBDA_FUNCTION_NAME || undefined,
  };
}

export async function getTeamStorageConfigById(
  _teamId: string,
): Promise<StorageConfig> {
  return getStorageConfig();
}
