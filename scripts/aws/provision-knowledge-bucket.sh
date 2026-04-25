#!/usr/bin/env bash
#
# Provision the MYIO Knowledge S3 bucket + dedicated least-privilege IAM
# user for the GCDR application. Idempotent — re-running is safe.
#
# Run locally as a user (Rodrigo) with admin credentials. Do NOT run from
# inside the GCDR API container; do NOT pass admin credentials into the
# application's .env. This script's only job is to create the
# `gcdr-knowledge-app-prod` user with a tightly-scoped policy and emit
# its access key — that key is what goes in .env.prod.
#
# Prerequisites:
#   1) AWS CLI v2 installed       (aws --version)
#   2) An admin profile configured (aws configure --profile myio-admin)
#   3) Rodrigo's console password rotated AFTER it was shared in chat.
#
# Usage:
#   AWS_PROFILE=myio-admin ./scripts/aws/provision-knowledge-bucket.sh
#
# Override defaults via env vars:
#   REGION=us-east-1
#   BUCKET_NAME=myio-knowledge-prod
#   IAM_USER=gcdr-knowledge-app-prod
#   IAM_POLICY=gcdr-knowledge-app-prod-policy
#

set -euo pipefail

AWS_PROFILE="${AWS_PROFILE:-myio-admin}"
REGION="${REGION:-us-east-1}"
BUCKET_NAME="${BUCKET_NAME:-myio-knowledge-prod}"
IAM_USER="${IAM_USER:-gcdr-knowledge-app-prod}"
IAM_POLICY="${IAM_POLICY:-gcdr-knowledge-app-prod-policy}"

# ─── Locate AWS CLI binary ───────────────────────────────────────────────────
# Git Bash on Windows often misses "C:\Program Files\Amazon\AWSCLIV2\" in PATH.
# Override with `AWS_BIN=...` if your install is in a non-standard location.
if [ -n "${AWS_BIN:-}" ]; then
  :
elif command -v aws >/dev/null 2>&1; then
  AWS_BIN="aws"
else
  for candidate in \
    "/c/Program Files/Amazon/AWSCLIV2/aws.exe" \
    "/c/Program Files (x86)/Amazon/AWSCLIV2/aws.exe" \
    "/usr/local/bin/aws" \
    "/opt/homebrew/bin/aws"; do
    if [ -x "$candidate" ]; then AWS_BIN="$candidate"; break; fi
  done
fi
if [ -z "${AWS_BIN:-}" ]; then
  echo "✗ aws CLI not found in PATH or in any known location."
  echo "  Try one of:"
  echo "  - PowerShell:   aws --version"
  echo "  - Install:      https://awscli.amazonaws.com/AWSCLIV2.msi"
  echo "  - Override:     AWS_BIN=/full/path/to/aws.exe ./scripts/aws/provision-knowledge-bucket.sh"
  exit 1
fi

# Use an array so paths with spaces (e.g. /c/Program Files/...) survive word-splitting.
AWS=("$AWS_BIN" --profile "$AWS_PROFILE")
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# When invoking a NATIVE Windows aws.exe from MinGW/Git Bash, paths like
# `/tmp/...` are Unix-style mounts that the Windows binary can't read.
# `cygpath -m` converts them to mixed-form (`C:/Users/.../Temp/...`) which
# both `file://` URIs and Windows file APIs accept. No-op on real Linux/macOS.
to_native_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}
TMP_NATIVE="$(to_native_path "$TMP")"

echo "▶ Using AWS CLI at: $AWS_BIN"
echo "▶ Provisioning '${BUCKET_NAME}' in ${REGION} using profile '${AWS_PROFILE}'"

CALLER_ARN="$("${AWS[@]}" sts get-caller-identity --query Arn --output text)"
echo "  caller: ${CALLER_ARN}"

# ─── 1. Bucket creation (us-east-1 has no LocationConstraint) ────────────────
if "${AWS[@]}" s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
  echo "▶ Bucket already exists — skipping creation"
else
  echo "▶ Creating bucket"
  if [ "$REGION" = "us-east-1" ]; then
    "${AWS[@]}" s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION" >/dev/null
  else
    "${AWS[@]}" s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
fi

# ─── 2. Versioning ───────────────────────────────────────────────────────────
echo "▶ Enabling versioning"
"${AWS[@]}" s3api put-bucket-versioning \
  --bucket "$BUCKET_NAME" \
  --versioning-configuration Status=Enabled

# ─── 3. Default encryption (SSE-S3 / AES-256) ────────────────────────────────
echo "▶ Enforcing default encryption"
"${AWS[@]}" s3api put-bucket-encryption \
  --bucket "$BUCKET_NAME" \
  --server-side-encryption-configuration '{
    "Rules":[{
      "ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},
      "BucketKeyEnabled":true
    }]
  }'

# ─── 4. Block all public access ──────────────────────────────────────────────
echo "▶ Blocking all public access"
"${AWS[@]}" s3api put-public-access-block \
  --bucket "$BUCKET_NAME" \
  --public-access-block-configuration '{
    "BlockPublicAcls":true,
    "IgnorePublicAcls":true,
    "BlockPublicPolicy":true,
    "RestrictPublicBuckets":true
  }'

# ─── 5. Bucket policy: deny non-TLS ──────────────────────────────────────────
echo "▶ Applying TLS-only bucket policy"
cat >"$TMP/bucket-policy.json" <<EOF
{
  "Version":"2012-10-17",
  "Statement":[{
    "Sid":"DenyInsecureTransport",
    "Effect":"Deny",
    "Principal":"*",
    "Action":"s3:*",
    "Resource":[
      "arn:aws:s3:::${BUCKET_NAME}",
      "arn:aws:s3:::${BUCKET_NAME}/*"
    ],
    "Condition":{"Bool":{"aws:SecureTransport":"false"}}
  }]
}
EOF
"${AWS[@]}" s3api put-bucket-policy \
  --bucket "$BUCKET_NAME" \
  --policy "file://$TMP_NATIVE/bucket-policy.json"

# ─── 6. CORS (browser presigned uploads, future) ─────────────────────────────
echo "▶ Configuring CORS"
cat >"$TMP/cors.json" <<EOF
{
  "CORSRules":[{
    "AllowedOrigins":[
      "https://gcdr-server.apps.myio-bas.com",
      "https://app.myio-bas.com",
      "https://wiki.myio-bas.com",
      "http://localhost:3015",
      "http://localhost:5173"
    ],
    "AllowedMethods":["GET","PUT","POST","HEAD"],
    "AllowedHeaders":["*"],
    "ExposeHeaders":["ETag","x-amz-version-id"],
    "MaxAgeSeconds":3000
  }]
}
EOF
"${AWS[@]}" s3api put-bucket-cors \
  --bucket "$BUCKET_NAME" \
  --cors-configuration "file://$TMP_NATIVE/cors.json"

# ─── 7. Lifecycle (purge soft-deleted, abort stale multipart) ────────────────
echo "▶ Applying lifecycle rules"
cat >"$TMP/lifecycle.json" <<EOF
{
  "Rules":[
    {
      "ID":"abort-stale-multipart",
      "Status":"Enabled",
      "Filter":{"Prefix":""},
      "AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}
    },
    {
      "ID":"deleted-purge",
      "Status":"Enabled",
      "Filter":{"Prefix":"deleted/"},
      "Expiration":{"Days":30}
    },
    {
      "ID":"noncurrent-cleanup",
      "Status":"Enabled",
      "Filter":{"Prefix":""},
      "NoncurrentVersionExpiration":{"NoncurrentDays":90}
    }
  ]
}
EOF
"${AWS[@]}" s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET_NAME" \
  --lifecycle-configuration "file://$TMP_NATIVE/lifecycle.json"

# ─── 8. Object Ownership: BucketOwnerEnforced (no ACLs) ──────────────────────
echo "▶ Enforcing BucketOwnerEnforced"
"${AWS[@]}" s3api put-bucket-ownership-controls \
  --bucket "$BUCKET_NAME" \
  --ownership-controls '{
    "Rules":[{"ObjectOwnership":"BucketOwnerEnforced"}]
  }'

# ─── 9. IAM user ─────────────────────────────────────────────────────────────
if "${AWS[@]}" iam get-user --user-name "$IAM_USER" >/dev/null 2>&1; then
  echo "▶ IAM user '${IAM_USER}' already exists — skipping creation"
else
  echo "▶ Creating IAM user '${IAM_USER}'"
  "${AWS[@]}" iam create-user --user-name "$IAM_USER" >/dev/null
fi

# ─── 10. Inline policy (least privilege on the bucket only) ──────────────────
echo "▶ Attaching least-privilege inline policy"
cat >"$TMP/user-policy.json" <<EOF
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Sid":"ObjectCRUD",
      "Effect":"Allow",
      "Action":[
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
      "Resource":"arn:aws:s3:::${BUCKET_NAME}/*"
    },
    {
      "Sid":"BucketListAndMetadata",
      "Effect":"Allow",
      "Action":[
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads",
        "s3:GetBucketLocation"
      ],
      "Resource":"arn:aws:s3:::${BUCKET_NAME}"
    }
  ]
}
EOF
"${AWS[@]}" iam put-user-policy \
  --user-name "$IAM_USER" \
  --policy-name "$IAM_POLICY" \
  --policy-document "file://$TMP_NATIVE/user-policy.json"

# ─── 11. Access key — only create if user has none ───────────────────────────
EXISTING_KEYS_COUNT="$("${AWS[@]}" iam list-access-keys --user-name "$IAM_USER" \
  --query 'length(AccessKeyMetadata)' --output text)"

if [ "$EXISTING_KEYS_COUNT" -gt 0 ]; then
  echo ""
  echo "⚠  IAM user '${IAM_USER}' already has ${EXISTING_KEYS_COUNT} access key(s)."
  echo "   AWS only shows the secret on creation — if you don't have it saved,"
  echo "   delete the existing key first:"
  echo "     aws --profile ${AWS_PROFILE} iam list-access-keys --user-name ${IAM_USER}"
  echo "     aws --profile ${AWS_PROFILE} iam delete-access-key --user-name ${IAM_USER} --access-key-id <id>"
  echo "   then re-run this script."
  exit 0
fi

echo "▶ Creating access key for '${IAM_USER}'"
# Output is two tab-separated columns (AccessKeyId, SecretAccessKey).
# Captured directly from the API response — AWS only reveals the secret here.
KEY_PAIR="$("${AWS[@]}" iam create-access-key --user-name "$IAM_USER" \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)"

ACCESS_KEY_ID="$(echo "$KEY_PAIR" | awk '{print $1}')"
SECRET_KEY="$(   echo "$KEY_PAIR" | awk '{print $2}')"

# ─── Direct write to TARGET_ENV_FILE if requested ─────────────────────────────
# When TARGET_ENV_FILE points to an existing .env file, write the secret
# straight into it via in-place sed and DO NOT print the secret to stdout.
# This eliminates the leak vector of the user copy-pasting from the terminal.
TARGET_ENV_FILE="${TARGET_ENV_FILE:-}"
if [ -n "$TARGET_ENV_FILE" ]; then
  if [ ! -f "$TARGET_ENV_FILE" ]; then
    echo "✗ TARGET_ENV_FILE not found: $TARGET_ENV_FILE"
    echo "  The access key was created but NOT persisted. Delete it now:"
    echo "  aws --profile ${AWS_PROFILE} iam delete-access-key \\"
    echo "      --user-name ${IAM_USER} --access-key-id ${ACCESS_KEY_ID}"
    exit 1
  fi

  # Use a tmp file to atomically rewrite. sed -i has portability quirks
  # (BSD vs GNU); doing it with cp + sed > out is reliable everywhere.
  TARGET_TMP="$(mktemp)"
  cp "$TARGET_ENV_FILE" "$TARGET_TMP"
  # Replace the two specific lines. Anchored to ^ so we only touch them.
  # Note: SECRET_KEY may contain `+`, `/`, `=` — escape for sed.
  ESC_SECRET="$(printf '%s\n' "$SECRET_KEY" | sed -e 's/[\/&|]/\\&/g')"
  ESC_KEYID="$(printf '%s\n' "$ACCESS_KEY_ID" | sed -e 's/[\/&|]/\\&/g')"
  sed -e "s|^S3_ACCESS_KEY_ID=.*|S3_ACCESS_KEY_ID=$ESC_KEYID|" \
      -e "s|^S3_SECRET_ACCESS_KEY=.*|S3_SECRET_ACCESS_KEY=$ESC_SECRET|" \
      "$TARGET_TMP" > "$TARGET_ENV_FILE"
  rm -f "$TARGET_TMP"

  cat <<EOF

═══════════════════════════════════════════════════════════════════════════
✅  PROVISIONED.

Wrote new credentials to $TARGET_ENV_FILE
   - S3_ACCESS_KEY_ID line replaced
   - S3_SECRET_ACCESS_KEY line replaced

⚠  DO NOT cat this file. DO NOT select these lines in your editor — Claude
   Code IDE integrations forward selected lines into the chat context.
   The credential never appeared on this terminal.

Smoke test (uses your admin profile, NOT the app key):
  echo "smoke-test \$(date -u +%FT%TZ)" > /tmp/smoke.txt
  aws --profile ${AWS_PROFILE} s3 cp /tmp/smoke.txt s3://${BUCKET_NAME}/cache/smoke.txt
  aws --profile ${AWS_PROFILE} s3 rm s3://${BUCKET_NAME}/cache/smoke.txt

Verify TLS-only enforcement (must FAIL with 403):
  curl -v http://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/

═══════════════════════════════════════════════════════════════════════════
EOF
  exit 0
fi

# ─── Fallback: print to stdout (legacy mode for non-Windows operators) ────────
cat <<EOF

═══════════════════════════════════════════════════════════════════════════
✅  PROVISIONED.

⚠  The secret below is shown once. Paste into .env.prod and DO NOT echo it,
   cat the file in a terminal, or select these lines in an IDE that
   integrates with an LLM.
   Prefer re-running with TARGET_ENV_FILE=.env.prod to skip stdout entirely.

S3_ENDPOINT=https://s3.${REGION}.amazonaws.com
S3_REGION=${REGION}
S3_BUCKET=${BUCKET_NAME}
S3_ACCESS_KEY_ID=${ACCESS_KEY_ID}
S3_SECRET_ACCESS_KEY=${SECRET_KEY}
S3_FORCE_PATH_STYLE=false
S3_UPLOAD_MAX_BYTES=10485760

Smoke test:
  echo "smoke-test \$(date -u +%FT%TZ)" > /tmp/smoke.txt
  aws --profile ${AWS_PROFILE} s3 cp /tmp/smoke.txt s3://${BUCKET_NAME}/cache/smoke.txt
  aws --profile ${AWS_PROFILE} s3 rm s3://${BUCKET_NAME}/cache/smoke.txt

Verify TLS-only enforcement (must FAIL with 403):
  curl -v http://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/

Done. The secret above is the ONLY time AWS will show it.
═══════════════════════════════════════════════════════════════════════════
EOF
