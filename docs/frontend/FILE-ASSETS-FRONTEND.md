# File Assets — Frontend Integration Guide

- **Status:** Integration brief
- **Created:** 2026-04-25
- **Audience:** Frontend / mobile developers integrating with `/api/v1/files`
- **Companion docs:**
  - [RFC-0030 — MYIO Wiki](../rfcs/RFC-0030-MYIO-Wiki-Knowledge-Base.md) (Phase 4 attachments)
  - [RFC-0030 — S3 Bucket Setup](../rfcs/RFC-0030-S3-Bucket-Setup.md) (storage infrastructure)
  - [RFC-0031 — Wiki Engagement & PDF Export](../rfcs/RFC-0031-Wiki-Engagement-Export-and-Admin.md) (consumer of `wiki_pdf` owner type)

---

## What this is

`FileAsset` is the platform's generic, polymorphic file storage. **Any GCDR
feature** (wiki page attachment, wiki PDF render, future user avatar / customer
logo / device manual) registers binaries through a single API and a single
S3-compatible bucket. The backend abstracts:

- S3 PUT and content-addressed storage key (`assets/<tenant>/<yyyy>/<mm>/<id>/<sha256>.<ext>`)
- SHA-256 integrity verification on upload
- Soft delete with S3 lifecycle purge
- Short-lived presigned download URLs (5 min default, 1 hour cap)
- Multi-tenant scoping (every row carries `tenant_id`)
- Anti-virus scan hooks (status flow `PENDING → CLEAN | INFECTED → QUARANTINED`)

The frontend doesn't talk to S3 directly. It uploads multipart to the API,
gets back metadata + a download URL, and (when the URL expires) asks the API
for a fresh one.

---

## Authentication

All endpoints under `/api/v1/files` require a **JWT Bearer token** (or master
API key). The standard headers:

```
Authorization: Bearer <jwt>
X-Tenant-Id:   <tenant uuid>
X-Request-Id:  <optional uuid for tracing>
```

The `X-Tenant-Id` header is normally populated by the existing auth flow; if
your frontend already drives it for `/wiki`, `/devices`, etc., the same value
applies here.

There is **no public/anonymous variant** for file assets in v1. All uploads
and downloads require auth. (RFC-0030 Phase 4 may introduce public PDF
downloads — see "Future" below.)

---

## Endpoints

Base URL: `/api/v1/files` (production: `https://gcdr-api.a.myio-bas.com/api/v1/files`)

| Method   | Path                       | Auth        | Purpose                                                   |
|----------|----------------------------|-------------|-----------------------------------------------------------|
| `POST`   | `/files`                   | required    | Upload a file (multipart/form-data, field name `file`). Optionally include `publicSlug` to immediately make it available at `/public/files/by-slug/...`. |
| `GET`    | `/files`                   | required    | List files with filters and pagination                    |
| `GET`    | `/files/:id`               | required    | Get a single file's metadata                              |
| `GET`    | `/files/:id/download`      | required    | Get a fresh presigned download URL                        |
| `DELETE` | `/files/:id`               | required    | Soft delete (binary purged by S3 lifecycle after 30 days) |
| `PATCH`  | `/files/:id/public-slug`   | required    | Set, replace, or clear (`null`) the file's public slug    |
| `GET`    | `/public/files/by-slug/:slug` | **none** | Stable, brand-friendly public URL for assets with a slug. 302-redirect-capable. |

---

## Endpoint reference

### `POST /files` — Upload

#### Request — `multipart/form-data`

| Field        | Type    | Required                          | Description |
|--------------|---------|-----------------------------------|-------------|
| `file`       | binary  | **yes**                           | The binary blob. Allowed MIME types listed in "Limits & validation". Size limit is `10 MB` by default. |
| `ownerType`  | string  | **yes**                           | `wiki_page` \| `wiki_pdf` \| `free` |
| `ownerId`    | string  | required when `ownerType ≠ free`  | UUID of the owning entity (page/pdf), or any text identifier for `wiki_pdf`. |
| `customerId` | string  | optional                          | UUID. Optional customer scope; defaults to null. |
| `metadata`   | string  | optional                          | JSON-encoded object. Free-form key/value (image dimensions, video duration, EXIF, page count, etc.). |
| `publicSlug` | string  | optional                          | Human-readable slug (e.g. `device-icons/escada-rolante`). Format `^[a-z0-9][a-z0-9/_-]{0,127}$`. Unique per tenant — `409` if already taken. Once set, the asset is reachable at `/api/v1/public/files/by-slug/<publicSlug>` without auth. |

#### Example — uploading an image attached to a wiki page

```http
POST /api/v1/files
Authorization: Bearer <jwt>
X-Tenant-Id: 11111111-1111-1111-1111-111111111111
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="file"; filename="screenshot.png"
Content-Type: image/png

<binary>
------WebKitFormBoundary
Content-Disposition: form-data; name="ownerType"

wiki_page
------WebKitFormBoundary
Content-Disposition: form-data; name="ownerId"

cb170097-59c1-4c8f-b787-47d1bb83cb4d
------WebKitFormBoundary
Content-Disposition: form-data; name="metadata"

{"width":1920,"height":1080}
------WebKitFormBoundary--
```

#### Response — `201 Created`

```json
{
  "success": true,
  "data": {
    "id": "9f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "customerId": null,
    "ownerType": "wiki_page",
    "ownerId": "cb170097-59c1-4c8f-b787-47d1bb83cb4d",
    "filename": "screenshot.png",
    "contentType": "image/png",
    "byteSize": 248137,
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "storageProvider": "S3",
    "storageBucket": "myio-knowledge-prod",
    "storageKey": "assets/11111111-.../2026/04/9f1a2b3c-.../e3b0c4....png",
    "status": "ACTIVE",
    "scanStatus": "PENDING",
    "uploadedBy": "bbbb1111-1111-1111-1111-111111111111",
    "uploadedAt": "2026-04-25T22:34:11.082Z",
    "deletedAt": null,
    "metadata": { "width": 1920, "height": 1080 },
    "downloadUrl": "https://myio-knowledge-prod.s3.us-east-1.amazonaws.com/assets/.../e3b0c4....png?X-Amz-Algorithm=..."
  },
  "meta": {
    "requestId": "...",
    "timestamp": "2026-04-25T22:34:11.082Z"
  }
}
```

The `downloadUrl` expires in 5 minutes. After that, call `GET /files/:id/download`
to mint a new one.

#### Error responses

| Status | Code              | When |
|--------|-------------------|------|
| `400`  | `VALIDATION_ERROR`| Missing `file` field, invalid `ownerType`, invalid `metadata` JSON, missing `ownerId` when `ownerType ≠ free`, MIME not in allowlist, file > size limit |
| `401`  | `UNAUTHORIZED`    | Missing or expired JWT |
| `404`  | `NOT_FOUND`       | (rare — should not occur on POST; reserved for future tenant validation) |

---

### `GET /files` — List

#### Query parameters

| Param           | Type     | Description |
|-----------------|----------|-------------|
| `ownerType`     | string   | Filter to a single owner type |
| `ownerId`       | string   | Filter to a specific owner UUID/identifier |
| `customerId`    | uuid     | Filter to a specific customer scope |
| `status`        | string   | `PENDING_UPLOAD` \| `ACTIVE` \| `QUARANTINED` \| `DELETED` |
| `scanStatus`    | string   | `PENDING` \| `CLEAN` \| `INFECTED` \| `SKIPPED` |
| `includeDeleted`| boolean  | Default `false`. Set to `true` to also return rows where `deletedAt != null`. |
| `page`          | integer  | 1-based |
| `pageSize`      | integer  | Default 20 |
| `limit`/`cursor`| —        | Cursor-style pagination (alternative to page/pageSize). |

#### Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [ { "id": "...", "filename": "...", ... }, ... ],
    "pagination": {
      "total": 42,
      "totalPages": 3,
      "hasMore": true,
      "nextCursor": "20"
    }
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

The `items` shape is the same as the upload response, **without** the
`downloadUrl` field. List endpoints don't pre-mint URLs to keep response size
sane and avoid unnecessary signing.

#### Common queries

```
# All attachments for a specific wiki page
GET /api/v1/files?ownerType=wiki_page&ownerId=<page_uuid>

# All free (unattached) files uploaded in this tenant
GET /api/v1/files?ownerType=free

# Quarantined files awaiting cleanup
GET /api/v1/files?scanStatus=INFECTED&includeDeleted=false

# Files for a specific customer
GET /api/v1/files?customerId=<customer_uuid>
```

---

### `GET /files/:id` — Metadata only

Returns the same `FileAsset` shape as upload (without `downloadUrl`). Use this
when you already have an ID and want to refresh the row (e.g. to check if the
scan completed and `scanStatus` flipped to `CLEAN`).

#### Response — `200 OK`

```json
{
  "success": true,
  "data": { "id": "...", "filename": "...", "scanStatus": "CLEAN", ... }
}
```

#### Error responses

| Status | Code        | When |
|--------|-------------|------|
| `404`  | `NOT_FOUND` | ID doesn't exist in this tenant or is soft-deleted |

---

### `GET /files/:id/download` — Presigned URL

Mints a fresh signed URL pointing to the binary in S3. This is what you use
right before triggering a download or rendering an `<img>` / `<video>` tag.

#### Query parameters

| Param              | Type     | Description |
|--------------------|----------|-------------|
| `disposition`      | string   | `inline` (default — render in browser) or `attachment` (force browser to save) |
| `expiresInSeconds` | integer  | 30..3600. Default 300 (5 min). |
| `filename`         | string   | Override the download filename (otherwise the asset's original name is used) |
| `redirect`         | boolean  | If `true`, the API issues an HTTP `302` redirect to the signed URL. Useful for `<a href>` direct downloads. Default `false` (returns JSON). |

#### Response — `200 OK` (default JSON mode)

```json
{
  "success": true,
  "data": {
    "url": "https://myio-knowledge-prod.s3.us-east-1.amazonaws.com/...?X-Amz-Algorithm=...",
    "expiresInSeconds": 300,
    "filename": "screenshot.png",
    "contentType": "image/png"
  }
}
```

#### Response — `302 Found` (when `?redirect=true`)

`Location: <signed url>` — browser follows automatically. No JSON body.

#### Error responses

| Status | Code              | When |
|--------|-------------------|------|
| `404`  | `NOT_FOUND`       | ID doesn't exist or is soft-deleted |
| `400`  | `VALIDATION_ERROR`| Asset is `QUARANTINED` (downloads blocked while AV says infected) |

---

### `DELETE /files/:id` — Soft delete

Marks the asset row as deleted (`status = 'DELETED'`, `deletedAt = now()`).
The S3 binary is **not** deleted immediately — a lifecycle rule on the
bucket purges it after 30 days. This means:

- The asset will not appear in default `GET /files` listings.
- The download endpoint returns 404.
- For 30 days, the row can be undeleted (would require a backend endpoint;
  not exposed in v1 — current recovery is manual SQL).

#### Response — `204 No Content`

Empty body. Status code only.

#### Error responses

| Status | Code        | When |
|--------|-------------|------|
| `404`  | `NOT_FOUND` | ID doesn't exist or is already soft-deleted |

---

## TypeScript types — copy-paste

Mirror the backend exactly. Save as `src/types/fileAsset.ts` (or wherever
your platform stores domain types):

```typescript
export type FileAssetOwnerType = 'wiki_page' | 'wiki_pdf' | 'free';

export type FileAssetStatus =
  | 'PENDING_UPLOAD'
  | 'ACTIVE'
  | 'QUARANTINED'
  | 'DELETED';

export type FileAssetScanStatus =
  | 'PENDING'
  | 'CLEAN'
  | 'INFECTED'
  | 'SKIPPED';

export type FileAssetStorageProvider = 'S3' | 'MINIO' | 'LOCAL';

export interface FileAsset {
  id: string;
  tenantId: string;
  customerId: string | null;

  ownerType: FileAssetOwnerType;
  ownerId: string | null;

  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;

  storageProvider: FileAssetStorageProvider;
  storageBucket: string;
  storageKey: string;

  status: FileAssetStatus;
  scanStatus: FileAssetScanStatus;

  uploadedBy: string;
  uploadedAt: string;          // ISO 8601
  deletedAt: string | null;

  metadata: Record<string, unknown>;

  /**
   * Optional human-readable slug for stable public URLs:
   *   GET /api/v1/public/files/by-slug/<publicSlug>
   * Unique per tenant among non-deleted rows. Pattern:
   *   ^[a-z0-9][a-z0-9/_-]{0,127}$
   */
  publicSlug: string | null;
}

/** Returned by POST /files only. The list/get endpoints omit it. */
export interface FileAssetWithDownloadUrl extends FileAsset {
  downloadUrl: string;
}

export interface CreateFileAssetForm {
  ownerType: FileAssetOwnerType;
  ownerId?: string;
  customerId?: string;
  metadata?: Record<string, unknown>;
  publicSlug?: string;
}

export interface SetPublicSlugRequest {
  /** `null` clears the slug, removing the file from /public/files/by-slug/. */
  publicSlug: string | null;
}

export interface FileAssetDownloadOptions {
  disposition?: 'inline' | 'attachment';
  expiresInSeconds?: number;       // 30..3600
  filename?: string;
}

export interface FileAssetDownloadResponse {
  url: string;
  expiresInSeconds: number;
  filename: string;
  contentType: string;
}

export interface ListFileAssetsParams {
  ownerType?: FileAssetOwnerType;
  ownerId?: string;
  customerId?: string;
  status?: FileAssetStatus;
  scanStatus?: FileAssetScanStatus;
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
}
```

---

## Service implementation — example

A class that extends the existing `BaseService` (the one in
`gcdr-frontend.git/src/services/api/baseService.ts`).

```typescript
import { BaseService } from './baseService';
import type {
  FileAsset,
  FileAssetWithDownloadUrl,
  CreateFileAssetForm,
  FileAssetDownloadOptions,
  FileAssetDownloadResponse,
  ListFileAssetsParams,
} from '@/types/fileAsset';
import type { ApiResponse, PaginatedResponse } from '@/types';

class FileAssetService extends BaseService {
  /**
   * Upload a new file. Uses native FormData + the existing httpClient,
   * which already injects the JWT and X-Tenant-Id headers.
   */
  async upload(
    file: File,
    form: CreateFileAssetForm,
  ): Promise<ApiResponse<FileAssetWithDownloadUrl>> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('ownerType', form.ownerType);
    if (form.ownerId)    fd.append('ownerId',    form.ownerId);
    if (form.customerId) fd.append('customerId', form.customerId);
    if (form.metadata)   fd.append('metadata',   JSON.stringify(form.metadata));

    return this.apiPost<FileAssetWithDownloadUrl>('/files', fd);
  }

  async list(
    params: ListFileAssetsParams = {},
  ): Promise<ApiResponse<PaginatedResponse<FileAsset>>> {
    return this.apiGet<PaginatedResponse<FileAsset>>('/files', {
      ownerType:      params.ownerType,
      ownerId:        params.ownerId,
      customerId:     params.customerId,
      status:         params.status,
      scanStatus:     params.scanStatus,
      includeDeleted: params.includeDeleted,
      page:           params.page,
      pageSize:       params.pageSize,
    });
  }

  async getById(id: string): Promise<ApiResponse<FileAsset>> {
    return this.apiGet<FileAsset>(`/files/${id}`);
  }

  async getDownloadUrl(
    id: string,
    options: FileAssetDownloadOptions = {},
  ): Promise<ApiResponse<FileAssetDownloadResponse>> {
    return this.apiGet<FileAssetDownloadResponse>(`/files/${id}/download`, {
      disposition:      options.disposition,
      expiresInSeconds: options.expiresInSeconds,
      filename:         options.filename,
    });
  }

  /** Convenience — returns the URL string when you don't need the metadata. */
  async getDownloadUrlOnly(
    id: string,
    options: FileAssetDownloadOptions = {},
  ): Promise<string> {
    const res = await this.getDownloadUrl(id, options);
    return res.data!.url;
  }

  async delete(id: string): Promise<ApiResponse<void>> {
    return this.apiDelete<void>(`/files/${id}`);
  }
}

export const fileAssetService = new FileAssetService();
```

The crucial detail when uploading: pass **`FormData` directly** to `apiPost`.
Don't set `Content-Type` manually — the browser will add the correct
`multipart/form-data; boundary=...` automatically. The `httpClient` in this
codebase already handles `FormData` bodies correctly (no JSON.stringify).

---

## React hooks — examples

### `useFileUpload` — single file with progress

```typescript
import { useState } from 'react';
import { fileAssetService } from '@/services/api/fileAssetService';
import type {
  CreateFileAssetForm,
  FileAssetWithDownloadUrl,
} from '@/types/fileAsset';

interface UseFileUploadResult {
  upload: (file: File, form: CreateFileAssetForm) => Promise<FileAssetWithDownloadUrl>;
  isUploading: boolean;
  error: Error | null;
  reset: () => void;
}

export function useFileUpload(): UseFileUploadResult {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const upload = async (file: File, form: CreateFileAssetForm) => {
    setIsUploading(true);
    setError(null);
    try {
      const res = await fileAssetService.upload(file, form);
      if (!res.success || !res.data) {
        throw new Error(res.error?.message ?? 'Upload failed');
      }
      return res.data;
    } catch (e) {
      setError(e as Error);
      throw e;
    } finally {
      setIsUploading(false);
    }
  };

  return {
    upload,
    isUploading,
    error,
    reset: () => setError(null),
  };
}
```

### `useFileDownloadUrl` — one-shot signed URL

```typescript
import { useState } from 'react';
import { fileAssetService } from '@/services/api/fileAssetService';
import type { FileAssetDownloadOptions } from '@/types/fileAsset';

export function useFileDownloadUrl() {
  const [isLoading, setIsLoading] = useState(false);

  const trigger = async (
    fileId: string,
    options: FileAssetDownloadOptions = {},
  ): Promise<string> => {
    setIsLoading(true);
    try {
      return await fileAssetService.getDownloadUrlOnly(fileId, options);
    } finally {
      setIsLoading(false);
    }
  };

  /** Open the file in a new tab via a fresh signed URL. */
  const openInNewTab = async (fileId: string) => {
    const url = await trigger(fileId, { disposition: 'inline' });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  /** Force browser to download with a custom filename. */
  const downloadAs = async (fileId: string, filename: string) => {
    const url = await trigger(fileId, {
      disposition: 'attachment',
      filename,
    });
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return { trigger, openInNewTab, downloadAs, isLoading };
}
```

### `useFileList` — paginated listing

```typescript
import { useEffect, useState } from 'react';
import { fileAssetService } from '@/services/api/fileAssetService';
import type { FileAsset, ListFileAssetsParams } from '@/types/fileAsset';

export function useFileList(params: ListFileAssetsParams) {
  const [items, setItems] = useState<FileAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fileAssetService.list(params)
      .then((res) => {
        if (cancelled) return;
        setItems(res.data?.items ?? []);
        setTotal(res.data?.pagination.total ?? 0);
      })
      .catch((e) => !cancelled && setError(e))
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, [JSON.stringify(params)]); // serialise object dep

  return { items, total, isLoading, error };
}
```

---

## UI patterns

### Drag-and-drop attachment for a wiki page

```tsx
import { useFileUpload } from '@/hooks/useFileUpload';

interface AttachmentDropzoneProps {
  pageId: string;
  onUploaded: (asset: FileAssetWithDownloadUrl) => void;
}

export function AttachmentDropzone({ pageId, onUploaded }: AttachmentDropzoneProps) {
  const { upload, isUploading, error } = useFileUpload();

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const asset = await upload(file, { ownerType: 'wiki_page', ownerId: pageId });
    onUploaded(asset);
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className={isUploading ? 'opacity-50' : ''}
    >
      {isUploading ? 'Uploading…' : 'Drop file here to attach'}
      {error && <p className="text-red-600">{error.message}</p>}
    </div>
  );
}
```

### Image inline rendering

Three options, ordered by simplicity:

**1. One-shot signed URL on render (simple, re-renders refresh URL).**

```tsx
const [src, setSrc] = useState<string>();
useEffect(() => {
  fileAssetService.getDownloadUrlOnly(asset.id, { disposition: 'inline' })
    .then(setSrc);
}, [asset.id]);

return src ? <img src={src} alt={asset.filename} /> : <Spinner />;
```

**2. Use the `downloadUrl` from the upload response (only works for ~5 min).**

```tsx
<img src={uploadedAsset.downloadUrl} alt={uploadedAsset.filename} />
```

**3. Direct redirect endpoint (browser handles caching).**

```tsx
<img
  src={`/api/v1/files/${asset.id}/download?disposition=inline&redirect=true`}
  alt={asset.filename}
/>
```

Option 3 is most ergonomic but each `<img>` mount triggers a server roundtrip
to mint a presigned URL. For lists/grids prefer option 1 with a memoised hook.

---

## Common flows

### Upload + attach to a wiki page (single step)

```typescript
const asset = await fileAssetService.upload(file, {
  ownerType: 'wiki_page',
  ownerId: pageId,
});
// asset.id is now persistently linked to the page.
// asset.downloadUrl is good for ~5 min.
```

### Upload first, attach later (drafts)

```typescript
// 1. User adds files to a draft form, owner not yet known.
const draft = await fileAssetService.upload(file, { ownerType: 'free' });

// 2. User saves the parent entity (e.g. creates a wiki page) and we get its ID.
const page = await wikiPageService.create({ title, body, ... });

// 3. Re-tag the file to the new owner.
//    (NOT YET IMPLEMENTED in v1 — backend does not expose owner reassignment.
//     For now, re-upload or call the future PATCH /files/:id endpoint.)
```

### Force-download a generated PDF

```typescript
const url = await fileAssetService.getDownloadUrlOnly(pdfAsset.id, {
  disposition: 'attachment',
  filename: `${pageTitle}.pdf`,
  expiresInSeconds: 60,
});
window.location.href = url;
```

### Show only a tenant's images

```typescript
const { items } = useFileList({
  customerId: currentCustomerId,
  status: 'ACTIVE',
});
const images = items.filter((a) => a.contentType.startsWith('image/'));
```

---

## Public URLs (stable named slugs)

For assets that need brand-friendly, permanent URLs — device icons, customer
logos, marketing images shared in emails, anything you'd otherwise hardcode
into the frontend or external systems — assign a `publicSlug`. The asset
becomes reachable via:

```
GET /api/v1/public/files/by-slug/<publicSlug>           → JSON with signed URL
GET /api/v1/public/files/by-slug/<publicSlug>?redirect=true   → 302 to signed URL
```

No auth, no JWT, no S3 hostname leaked, no UUID in the path.

### Example — device-icons catalog

```typescript
// Upload at create time
const { asset } = (await fileAssetService.upload(file, {
  ownerType: 'free',
  publicSlug: 'device-icons/escada-rolante',
  metadata: { deviceProfile: 'ESCADA_ROLANTE' },
})).data!;

// Frontend usage — fully cacheable, no per-request signing roundtrip
<img src="/api/v1/public/files/by-slug/device-icons/escada-rolante?redirect=true" />
```

The browser hits the API, the API redirects to a fresh 5-min signed URL,
and the browser follows. The visible URL never changes — even after
re-upload (if you later assign the slug to a new asset) or revision rotation.

### Example — set/change/clear a slug after upload

```typescript
// Promote an existing asset to a public slug
await fileAssetService.setPublicSlug(asset.id, {
  publicSlug: 'customer-logos/acme',
});

// Move the slug to a different (newer) asset — old asset keeps its slot but
// loses the slug. Useful for "publish a new version" workflows.
await fileAssetService.setPublicSlug(oldAsset.id, { publicSlug: null });
await fileAssetService.setPublicSlug(newAsset.id, { publicSlug: 'customer-logos/acme' });

// Clear a slug entirely (asset still exists, just no longer public-by-slug)
await fileAssetService.setPublicSlug(asset.id, { publicSlug: null });
```

### Slug format

- Pattern: `^[a-z0-9][a-z0-9/_-]{0,127}$`
- Lowercase only, must start with `[a-z0-9]`
- May contain `/`, `_`, `-`
- Recommended convention: namespace by category (e.g. `device-icons/`,
  `customer-logos/`, `marketing/`) so different feature groups don't collide.

### Slug rules

- **Unique per tenant** — assigning a slug already held by another live row in the same tenant returns `409 CONFLICT`.
- **Soft-deleted rows release their slug** — deleting an asset with a slug frees that slug for re-assignment. Use this for "publish a new version" flows.
- **Slug is opt-in for public exposure.** Files without a slug are never reachable via `/public/files/by-slug/`, even by ID. Setting a slug is the single act of opting an asset into public visibility.
- **Quarantined slugs return 404** — even though the slug is set, an `INFECTED` scanStatus blocks public lookup.

### Service implementation snippet

```typescript
class FileAssetService extends BaseService {
  // ... existing methods ...

  /** Set, replace, or clear the public slug. Pass `null` to clear. */
  async setPublicSlug(
    id: string,
    body: { publicSlug: string | null },
  ): Promise<ApiResponse<FileAsset>> {
    return this.apiPatch<FileAsset>(`/files/${id}/public-slug`, body);
  }
}
```

The public lookup endpoint requires no auth, so the frontend can also embed
it in `<a href>` / `<img src>` directly — no fetch involved:

```html
<img src="https://gcdr-api.a.myio-bas.com/api/v1/public/files/by-slug/device-icons/escada-rolante?redirect=true" />
<a href="/api/v1/public/files/by-slug/marketing/datasheet?redirect=true&disposition=attachment&filename=datasheet.pdf">
  Download datasheet
</a>
```

---

## Owner types — when to use which

| `ownerType` | Use case | `ownerId` |
|-------------|----------|-----------|
| `wiki_page` | Image / PDF / doc embedded inline in a wiki page body | UUID of `wiki_pages.id` |
| `wiki_pdf`  | Server-generated PDF render of a wiki page (RFC-0031 Phase 6) | Composite — `<page_id>:v<revision_number>` is the convention |
| `free`      | Uploaded but not yet attached. Users dragging into a draft, batch importers, etc. | (omit) |

Future owner types (planned, not in v1):
- `user_avatar`
- `customer_logo`
- `device_manual`

When you need a new type, ask the backend team — it's a `CHECK constraint`
expansion + service whitelist update, ~10 lines of code.

---

## Limits & validation

### Upload size

- Default cap: **10 MB** per file (`S3_UPLOAD_MAX_BYTES`)
- Server returns `400 VALIDATION_ERROR` with message
  `"File too large — max 10 MB"` if exceeded.
- For larger files (videos, dataset dumps) the planned solution is **presigned
  PUT URLs** (browser → S3 direct). Not yet implemented in v1.

### MIME type allowlist

Accepted prefixes (anything matching is allowed):

```
image/*
video/*
audio/*
text/*
application/pdf
application/json
application/zip
application/x-zip-compressed
application/octet-stream
application/vnd.ms-excel
application/vnd.openxmlformats-officedocument.*
application/msword
application/vnd.ms-powerpoint
```

Custom MIME types not on the list return `400 VALIDATION_ERROR`. Talk to the
backend team if you need a new prefix added — it's a 1-line edit in
`src/middleware/upload.ts`.

### Field validation

| Field        | Rule |
|--------------|------|
| `ownerType`  | Must be one of `'wiki_page'`, `'wiki_pdf'`, `'free'`. |
| `ownerId`    | When `ownerType` is `wiki_page` or `wiki_pdf`: required, 1–256 chars. |
| `customerId` | If present: valid UUID. |
| `metadata`   | If present: valid JSON object (not an array, not a primitive). |

---

## Error handling

The API uses the standard envelope:

```json
{
  "success": false,
  "error": {
    "message": "ownerId is required when ownerType is not \"free\"",
    "code": "VALIDATION_ERROR"
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

| Code              | HTTP | Frontend handling |
|-------------------|------|-------------------|
| `VALIDATION_ERROR`| 400  | Show field-level error. Keep form data so user can fix and retry. |
| `UNAUTHORIZED`    | 401  | Redirect to login or refresh JWT. |
| `FORBIDDEN`       | 403  | Show "you don't have permission". (May appear when stricter RBAC lands.) |
| `NOT_FOUND`       | 404  | Asset doesn't exist or has been soft-deleted. Refresh the list. |
| `CONFLICT`        | 409  | (rare for files — reserved) |
| `INTERNAL_ERROR`  | 500  | Generic toast; log to telemetry. |

Multer-specific errors (oversized, too many files) are mapped to `400
VALIDATION_ERROR` automatically.

---

## Caveats and gotchas

1. **`downloadUrl` from upload expires in 5 minutes.** Don't store it in
   long-lived state. If you need the URL again (image preview after a
   refresh), call `getDownloadUrl(id)`.

2. **Soft-deleted files return 404, not 410.** This is intentional — the
   frontend treats "not visible to me" as "not found" without leaking
   existence.

3. **`scanStatus = PENDING` is the default.** AV scanning isn't running yet
   in v1 — every uploaded file stays `PENDING` indefinitely. Don't gate UI
   on `scanStatus === 'CLEAN'` until the backend wires up ClamAV (Phase 2).

4. **No re-upload on the same `id`.** Files are immutable once uploaded.
   To "replace" a file, soft-delete the old one and upload a new one with
   the same `ownerType`/`ownerId`. The server does NOT detect duplicates by
   sha256 in v1.

5. **`Content-Disposition` UTF-8 filenames.** The backend produces
   `filename="<ascii>"; filename*=UTF-8''<percent-encoded>` so non-ASCII
   filenames work in modern browsers. If you override `?filename=` in the
   download URL, the same encoding applies — just pass the raw UTF-8 string.

6. **Don't try to hit S3 directly using values from the asset row.** The
   bucket is private; the only way in is the presigned URL the API mints.
   Even if you assemble what you think is the public URL, you'll get
   `403 SignatureMissing`.

---

## Future (not yet in v1)

- **Presigned PUT URLs** — browser uploads directly to S3, bypasses the API
  proxy. Lifts the 10 MB limit. Endpoint will be `POST /files/uploads` →
  returns `{ uploadUrl, key }`, then `POST /files/uploads/:key/complete`
  to register metadata.
- **Owner reassignment** — `PATCH /files/:id` to change `ownerType`/`ownerId`
  after upload (free → wiki_page when the user finishes their draft).
- **Public read for wiki PDFs** — `GET /api/v1/public/wiki/pages/:id/pdf`
  will return a public-readable PDF for pages whose `visibility` includes
  `PUBLIC`. Backend route reserved, not yet implemented.
- **AV scan integration** — ClamAV sidecar hooks into the upload flow.
  `scanStatus` flips to `CLEAN` or `INFECTED` within seconds.
- **Quotas per tenant** — `tenant.config.assetsByteQuota` enforced at
  upload. v1 has no quota — be a good citizen.

---

## Quick checklist for the integrator

When wiring this into a frontend feature:

1. Pick the right `ownerType`. If the new feature isn't covered by the v1
   set, request an addition before building.
2. Extend the existing `BaseService` with the snippet in
   "Service implementation — example".
3. Drop in `useFileUpload`, `useFileList`, `useFileDownloadUrl` where they
   make sense.
4. For inline display, prefer the URL-resolving hook over a static
   `downloadUrl` from upload time.
5. Wire delete with optimistic UI — soft-delete is fast.
6. Don't expose `storageKey`, `storageBucket`, `sha256` to end users —
   they're internal.
7. Test with files just under and just over `S3_UPLOAD_MAX_BYTES` to
   confirm error UX.
