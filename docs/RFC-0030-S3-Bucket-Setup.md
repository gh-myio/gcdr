# RFC-0030 — S3 Bucket Setup for MYIO Wiki & Files

- **Status:** Draft — infrastructure runbook
- **Created:** 2026-04-22
- **Companion to:** [RFC-0030 — MYIO Wiki (Knowledge Base Module)](./RFC-0030-MYIO-Wiki-Knowledge-Base.md)
- **Audience:** Platform / DevOps engineers provisioning storage for the Wiki and Files modules
- **Implementation status:** Not yet provisioned. This document is the blueprint — the bucket
  will be created when implementation of RFC-0030 begins. All commands below are safe to copy
  but **should not be executed until the wiki/files backend PR is merged and ready for integration
  testing** (avoid orphaned paid infrastructure).

---

## Purpose

The MYIO Wiki module (RFC-0030) stores page revisions in PostgreSQL, but **binary
content — attachments, file-repository objects, thumbnails, and extracted-text caches —
belongs in an S3-compatible object store**. This document describes exactly how that
bucket is provisioned, secured, and operated.

Covered:

- Bucket naming per environment (`dev`, `staging`, `prod`)
- Region selection
- Versioning, lifecycle, encryption, and public-access posture
- CORS configuration for direct-from-browser multipart uploads
- IAM user and policy for the GCDR application
- Bucket policy (TLS-only enforcement)
- Object key layout
- Smoke-test procedure
- Disaster-recovery notes

---

## Provider choice

Two supported configurations, both S3 API-compatible:

| Environment | Provider                  | Rationale |
|-------------|---------------------------|-----------|
| `dev`       | **MinIO** (docker-compose)| Zero-cost local iteration; matches the S3 API surface used in prod. |
| `staging`   | **AWS S3** (sa-east-1)    | Cheap, realistic permissions testing against the same provider as prod. |
| `prod`      | **AWS S3** (sa-east-1)    | São Paulo region — colocated with the GCDR application and closest to the MYIO customer base. |

All code against this bucket MUST use the S3 v4-signature API (AWS SDK v3). Do not
use any AWS-specific service (e.g. S3 Object Lambda) — that would break MinIO parity.

---

## Bucket naming

```
myio-knowledge-dev
myio-knowledge-staging
myio-knowledge-prod
```

Rationale: the bucket serves both the Wiki module (page attachments) and the Files
module (first-class documents). The name `knowledge` captures both without tying us
to a single sub-module.

**Do not** embed the AWS account ID or region in the bucket name — AWS bucket names
are globally unique; if this name is taken, prefer `myio-knowledge-prod-br` over
`myio-knowledge-prod-123456789012`.

---

## Region

Primary: **`sa-east-1`** (São Paulo).

If the region is changed later, the `AWS_REGION` / `S3_REGION` environment variable in
GCDR is the single source of truth. Buckets are not region-replicated in v1.

---

## Step-by-step provisioning (AWS)

> Requires AWS CLI v2 and credentials for the MYIO platform AWS account.

### 1. Create the bucket

```bash
aws s3api create-bucket \
  --bucket myio-knowledge-prod \
  --region sa-east-1 \
  --create-bucket-configuration LocationConstraint=sa-east-1
```

### 2. Enable versioning

Revisions in PostgreSQL track page/file *metadata* and Markdown source. Object versions
in S3 protect against accidental overwrite of the **binary itself** (e.g., an editor
uploads the wrong PDF over the right one).

```bash
aws s3api put-bucket-versioning \
  --bucket myio-knowledge-prod \
  --versioning-configuration Status=Enabled
```

### 3. Default encryption (SSE-S3 / AES-256)

```bash
aws s3api put-bucket-encryption \
  --bucket myio-knowledge-prod \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": { "SSEAlgorithm": "AES256" },
      "BucketKeyEnabled": true
    }]
  }'
```

SSE-KMS is **not** used in v1 — it adds per-request cost and complicates MinIO parity.
Switch to SSE-KMS only if compliance (LGPD audit) explicitly requires customer-managed keys.

### 4. Block all public access

Non-negotiable. Every object is served via **time-limited presigned URL** from the
GCDR backend — no direct public reads, ever.

```bash
aws s3api put-public-access-block \
  --bucket myio-knowledge-prod \
  --public-access-block-configuration '{
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": true,
    "RestrictPublicBuckets": true
  }'
```

### 5. Bucket policy — deny non-TLS access

Even though public access is blocked, enforce TLS for every authenticated request.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::myio-knowledge-prod",
        "arn:aws:s3:::myio-knowledge-prod/*"
      ],
      "Condition": {
        "Bool": { "aws:SecureTransport": "false" }
      }
    }
  ]
}
```

Apply:

```bash
aws s3api put-bucket-policy \
  --bucket myio-knowledge-prod \
  --policy file://bucket-policy.json
```

### 6. CORS — allow direct-from-browser multipart uploads

Only the MYIO frontend origins may PUT directly to presigned URLs; everything else is rejected.

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": [
        "https://gcdr-server.apps.myio-bas.com",
        "https://app.myio-bas.com",
        "https://wiki.myio-bas.com",
        "http://localhost:3015",
        "http://localhost:5173"
      ],
      "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag", "x-amz-version-id"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

```bash
aws s3api put-bucket-cors \
  --bucket myio-knowledge-prod \
  --cors-configuration file://cors.json
```

### 7. Lifecycle rules

Three classes of objects have different retention needs:

| Prefix                    | Rule                                                                 |
|---------------------------|----------------------------------------------------------------------|
| `wiki/attachments/*`      | Keep current version indefinitely. Expire noncurrent versions after 90 days. |
| `wiki/deleted/*`          | Soft-deleted objects. Permanent delete after 30 days.                |
| `files/*`                 | Keep current. Transition noncurrent to `STANDARD_IA` after 30 days, `GLACIER_IR` after 180 days. |
| `files/deleted/*`         | Permanent delete after 30 days.                                      |
| `cache/thumbnails/*`      | Expire after 180 days (regenerated on demand).                       |
| `cache/extracted-text/*`  | Expire after 365 days (regenerated on demand).                       |
| `uploads/incomplete/*`    | Abort multipart uploads older than 7 days.                           |

```json
{
  "Rules": [
    {
      "ID": "abort-stale-multipart",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    },
    {
      "ID": "wiki-attachments-noncurrent-cleanup",
      "Status": "Enabled",
      "Filter": { "Prefix": "wiki/attachments/" },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 90 }
    },
    {
      "ID": "wiki-soft-deleted-purge",
      "Status": "Enabled",
      "Filter": { "Prefix": "wiki/deleted/" },
      "Expiration": { "Days": 30 }
    },
    {
      "ID": "files-tiering",
      "Status": "Enabled",
      "Filter": { "Prefix": "files/" },
      "NoncurrentVersionTransitions": [
        { "NoncurrentDays":  30, "StorageClass": "STANDARD_IA" },
        { "NoncurrentDays": 180, "StorageClass": "GLACIER_IR" }
      ]
    },
    {
      "ID": "files-soft-deleted-purge",
      "Status": "Enabled",
      "Filter": { "Prefix": "files/deleted/" },
      "Expiration": { "Days": 30 }
    },
    {
      "ID": "cache-thumbnails",
      "Status": "Enabled",
      "Filter": { "Prefix": "cache/thumbnails/" },
      "Expiration": { "Days": 180 }
    },
    {
      "ID": "cache-extracted-text",
      "Status": "Enabled",
      "Filter": { "Prefix": "cache/extracted-text/" },
      "Expiration": { "Days": 365 }
    }
  ]
}
```

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket myio-knowledge-prod \
  --lifecycle-configuration file://lifecycle.json
```

### 8. Object Ownership — `BucketOwnerEnforced`

Disables ACLs entirely — all access control is via IAM + bucket policy, which is what we want.

```bash
aws s3api put-bucket-ownership-controls \
  --bucket myio-knowledge-prod \
  --ownership-controls '{
    "Rules": [{ "ObjectOwnership": "BucketOwnerEnforced" }]
  }'
```

### 9. IAM policy for the GCDR application

Create a dedicated IAM user `gcdr-knowledge-app-prod` with programmatic access only.
Attach this inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ObjectCRUD",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
        "s3:GetObjectVersion",
        "s3:DeleteObjectVersion",
        "s3:PutObjectTagging",
        "s3:GetObjectTagging"
      ],
      "Resource": "arn:aws:s3:::myio-knowledge-prod/*"
    },
    {
      "Sid": "BucketListAndMetadata",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::myio-knowledge-prod"
    }
  ]
}
```

The app **must not** have permission to change bucket policy, lifecycle, CORS, or
versioning settings. Those are platform-team operations.

Store the access key and secret in the GCDR secrets store (Dokploy env vars):

```
S3_ENDPOINT=https://s3.sa-east-1.amazonaws.com
S3_REGION=sa-east-1
S3_BUCKET=myio-knowledge-prod
S3_ACCESS_KEY_ID=<from IAM>
S3_SECRET_ACCESS_KEY=<from IAM>
S3_FORCE_PATH_STYLE=false
```

For MinIO dev:

```
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=myio-knowledge-dev
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
```

---

## Object key layout

All objects live under one of four top-level prefixes:

```
wiki/
├─ attachments/
│  └─ <tenant_id>/<yyyy>/<mm>/<attachment_id>/<sha256>.<ext>
└─ deleted/
   └─ <tenant_id>/<yyyy>/<mm>/<attachment_id>/<sha256>.<ext>

files/
├─ <tenant_id>/<yyyy>/<mm>/<file_id>/v<version>/<sha256>.<ext>
└─ deleted/
   └─ <tenant_id>/<yyyy>/<mm>/<file_id>/<sha256>.<ext>

cache/
├─ thumbnails/<tenant_id>/<source_id>/<size>.jpg
└─ extracted-text/<tenant_id>/<source_id>.txt

uploads/
└─ incomplete/<tenant_id>/<upload_id>/   # multipart staging; auto-aborted after 7d
```

Key principles:

- **Tenant prefix is always first** after the top-level bucket class — makes per-tenant
  export, audit, and LGPD deletion straightforward.
- **Content-addressed filenames** (`<sha256>.<ext>`) prevent collision and enable
  deduplication (same file uploaded twice → same key, single storage).
- **Date shards** (`<yyyy>/<mm>/`) keep any single prefix under a few million objects
  and help cost attribution by period.
- **Soft-deleted objects** are moved to a `deleted/` sibling prefix, not deleted from S3
  — the 30-day lifecycle rule handles the real removal.

---

## Smoke test

After provisioning, verify end-to-end:

```bash
# 1. Put a test object
echo "smoke-test $(date -u +%FT%TZ)" > /tmp/smoke.txt
aws s3 cp /tmp/smoke.txt s3://myio-knowledge-prod/cache/smoke-test.txt

# 2. Verify TLS is enforced — this should FAIL:
curl -v http://myio-knowledge-prod.s3.sa-east-1.amazonaws.com/cache/smoke-test.txt
# Expect: 403 Forbidden (deny policy)

# 3. Verify presigned URL works:
aws s3 presign s3://myio-knowledge-prod/cache/smoke-test.txt --expires-in 60
# Open in browser → expect the file content

# 4. Verify CORS preflight from a whitelisted origin:
curl -X OPTIONS \
  -H "Origin: https://app.myio-bas.com" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type" \
  -v "https://myio-knowledge-prod.s3.sa-east-1.amazonaws.com/test"
# Expect: 200 with Access-Control-Allow-Origin reflecting the origin

# 5. Clean up
aws s3 rm s3://myio-knowledge-prod/cache/smoke-test.txt
```

All five steps must pass before declaring the bucket production-ready.

---

## Cost estimate (sa-east-1, order-of-magnitude)

| Item                              | Assumption                          | Monthly cost (USD) |
|-----------------------------------|-------------------------------------|--------------------|
| Storage — Standard                | 100 GB active content               | ~$2.50             |
| Storage — Standard-IA             | 500 GB noncurrent versions          | ~$6.25             |
| Storage — Glacier IR              | 2 TB archival                       | ~$8.00             |
| PUT / POST / LIST requests        | 50 k/month                          | ~$0.25             |
| GET requests                      | 500 k/month                         | ~$0.20             |
| Data transfer out (to CloudFront) | 50 GB                               | ~$4.50             |
| **Estimated total**               |                                     | **~$22/month**     |

Numbers above are for an early-adopter tenant mix. Revisit at 1 k+ active users.

---

## Disaster recovery

v1 does **not** enable cross-region replication. Justification: versioning + 90-day
noncurrent retention covers the realistic failure modes (accidental overwrite, operator
error). Full region loss is extremely rare and DR-by-backup is an order of magnitude
cheaper than CRR for this workload.

**Backup procedure** (platform team, quarterly):

```bash
aws s3 sync s3://myio-knowledge-prod/ \
           s3://myio-knowledge-backup/$(date +%F)/ \
           --storage-class GLACIER_IR
```

Revisit DR posture when the bucket exceeds **5 TB** or hosts content with RPO < 24 h
requirements.

---

## MinIO equivalent for local development

`docker-compose.yml` fragment:

```yaml
services:
  minio:
    image: minio/minio:RELEASE.2026-01-01T00-00-00Z
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data

  minio-init:
    image: minio/mc:latest
    depends_on: [minio]
    entrypoint: >
      /bin/sh -c "
      sleep 3;
      /usr/bin/mc alias set local http://minio:9000 minioadmin minioadmin;
      /usr/bin/mc mb -p local/myio-knowledge-dev;
      /usr/bin/mc version enable local/myio-knowledge-dev;
      /usr/bin/mc anonymous set none local/myio-knowledge-dev;
      exit 0;
      "

volumes:
  minio-data:
```

CORS, lifecycle, and IAM parity can be set via `mc admin` commands mirroring the AWS
CLI steps above. MinIO supports the same S3 API, so application code is unchanged.

---

## Checklist — definition of done

- [ ] Bucket created in `sa-east-1`
- [ ] Versioning enabled
- [ ] Default encryption: SSE-S3 (AES-256)
- [ ] Public access fully blocked (all 4 flags)
- [ ] Bucket policy denies non-TLS
- [ ] CORS configured with MYIO origins only
- [ ] Lifecycle rules applied (all 7 rules above)
- [ ] Object ownership: `BucketOwnerEnforced`
- [ ] IAM user + policy attached (least privilege)
- [ ] Secrets propagated to Dokploy env
- [ ] Smoke test passed (all 5 steps)
- [ ] MinIO equivalent running in dev compose
- [ ] DR runbook documented in internal runbook directory
