import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

// =============================================================================
// S3-compatible storage wrapper.
//
// Works against:
//   - AWS S3 (production)
//   - MinIO  (local dev — set S3_FORCE_PATH_STYLE=true)
//
// Single source of truth for the bucket layout and signed URL generation.
// All asset-related code (services, controllers, workers) goes through this.
// =============================================================================

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  uploadMaxBytes: number;
}

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
  /**
   * Custom metadata sent as `x-amz-meta-*` headers. Keep keys lowercase and
   * ASCII-only — S3 normalises them.
   */
  metadata?: Record<string, string>;
}

export interface PutObjectResult {
  key: string;
  byteSize: number;
  /** Hex-encoded SHA-256 of the content. Computed locally before upload. */
  sha256: string;
  etag: string | null;
}

export interface PresignedUrlInput {
  key: string;
  /** Default 5 minutes. AWS hard cap is 7 days for SigV4. */
  expiresInSeconds?: number;
  /**
   * If set, S3 returns a `Content-Disposition` header that forces the
   * browser to download with the given filename instead of rendering inline.
   * Example: `attachment; filename="report.pdf"`.
   */
  responseContentDisposition?: string;
  /** Override the response Content-Type sent by S3 on download. */
  responseContentType?: string;
}

export interface BuildAssetKeyInput {
  tenantId: string;
  assetId: string;
  sha256: string;
  /** File extension WITHOUT the dot (e.g. "png", "pdf"). May be empty. */
  ext?: string;
  /** Optional sub-namespace within `assets/`. Defaults to nothing. */
  prefix?: string;
}

export interface HeadObjectResult {
  byteSize: number;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function loadConfigFromEnv(): S3StorageConfig {
  return {
    endpoint:        process.env.S3_ENDPOINT          || 'http://localhost:9000',
    region:          process.env.S3_REGION            || 'us-east-1',
    bucket:          process.env.S3_BUCKET            || 'myio-knowledge-dev',
    accessKeyId:     process.env.S3_ACCESS_KEY_ID     || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'minioadmin',
    forcePathStyle:  envBool('S3_FORCE_PATH_STYLE', true),
    uploadMaxBytes:  envInt('S3_UPLOAD_MAX_BYTES',   10 * 1024 * 1024),
  };
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// -----------------------------------------------------------------------------
// S3Storage
// -----------------------------------------------------------------------------

export class S3Storage {
  private readonly client: S3Client;

  constructor(public readonly config: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    });
  }

  /**
   * Build the canonical storage key for an asset.
   *
   * Layout: `assets/<tenantId>/<yyyy>/<mm>/<assetId>/<sha256>.<ext>`
   *
   * Tenant first → cheap per-tenant export / LGPD deletion.
   * Date sharded → keeps any single S3 prefix small.
   * Content-addressed filename → integrity + dedup later.
   */
  buildAssetKey(input: BuildAssetKeyInput): string {
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm   = String(now.getUTCMonth() + 1).padStart(2, '0');
    const ext = input.ext ? `.${input.ext.replace(/^\.+/, '')}` : '';
    const prefix = input.prefix ? `${input.prefix.replace(/\/+$/, '')}/` : '';
    return `${prefix}assets/${input.tenantId}/${yyyy}/${mm}/${input.assetId}/${input.sha256}${ext}`;
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const sha256 = sha256Hex(input.body);
    const result = await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      ContentLength: input.body.byteLength,
      Metadata: input.metadata,
    }));

    return {
      key: input.key,
      byteSize: input.body.byteLength,
      sha256,
      etag: result.ETag ?? null,
    };
  }

  /**
   * Pull an entire object into memory. Use only when you actually need the
   * bytes server-side (rare). For client downloads, prefer presigned URLs.
   */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    }));
    if (!result.Body) {
      throw new Error(`S3 object ${key} returned no body`);
    }
    return streamToBuffer(result.Body as Readable);
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    }));
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }));
      return {
        byteSize: result.ContentLength ?? 0,
        contentType: result.ContentType ?? null,
        etag: result.ETag ?? null,
        lastModified: result.LastModified ?? null,
      };
    } catch (err: unknown) {
      // 404 / NotFound — return null instead of throwing.
      if (
        typeof err === 'object' && err !== null &&
        ('$metadata' in err) &&
        (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  /** The configured bucket name. Persisted on rows (e.g. central_backups) as audit metadata. */
  get bucket(): string {
    return this.config.bucket;
  }

  /**
   * Generate a short-lived signed URL the client can hit directly to download
   * the object. Default expiry is 5 minutes — enough for a browser to start
   * the download but not so long that a leaked URL is permanently dangerous.
   */
  async getPresignedDownloadUrl(input: PresignedUrlInput): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        ResponseContentDisposition: input.responseContentDisposition,
        ResponseContentType: input.responseContentType,
      }),
      { expiresIn: input.expiresInSeconds ?? 300 },
    );
  }

  /**
   * Symmetric variant for uploads. Returned URL accepts a PUT with the same
   * Content-Type / Content-Length the caller passes back. Used by the browser
   * direct-upload flow (Phase 2 — not yet wired into the controller).
   */
  async getPresignedUploadUrl(input: {
    key: string;
    contentType: string;
    expiresInSeconds?: number;
  }): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        ContentType: input.contentType,
      }),
      { expiresIn: input.expiresInSeconds ?? 300 },
    );
  }
}

// -----------------------------------------------------------------------------
// Singleton wired to the process env. Imported as `s3Storage` everywhere.
// -----------------------------------------------------------------------------

export const s3Storage = new S3Storage(loadConfigFromEnv());

/**
 * Provider tag persisted on the file_assets row, derived from the configured
 * endpoint. Used purely as audit metadata — does not affect runtime routing.
 */
export function detectStorageProvider(endpoint: string): 'S3' | 'MINIO' | 'LOCAL' {
  if (endpoint.includes('amazonaws.com')) return 'S3';
  if (endpoint.includes('minio') || endpoint.includes('localhost') || endpoint.includes('127.0.0.1')) return 'MINIO';
  return 'LOCAL';
}
