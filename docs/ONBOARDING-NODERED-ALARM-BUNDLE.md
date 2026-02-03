# Onboarding Manual - Alarm Rules Bundle for Node-RED

This document describes how the Node-RED team can consume the **Alarm Rules Bundle** from GCDR to configure alarm rules in flows.

## Table of Contents

1. [Overview](#1-overview)
2. [M2M Authentication (API Key)](#2-m2m-authentication-api-key)
3. [Bundle Endpoint](#3-bundle-endpoint)
4. [Bundle Structure](#4-bundle-structure)
5. [Version Management (ETag)](#5-version-management-etag)
6. [Signature Verification](#6-signature-verification)
7. [Practical Examples](#7-practical-examples)
8. [Cache Strategies](#8-cache-strategies)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Overview

### What is the Alarm Rules Bundle?

The **Alarm Rules Bundle** is an optimized package containing all alarm rules for a customer, structured for efficient consumption by Node-RED. It includes:

- **Alarm rules catalog** with thresholds and configurations
- **Device-to-rules mapping** for fast lookup
- **Grouping by device type** for bulk configuration
- **Versioning** to detect changes
- **HMAC signature** to ensure integrity

### Why Use the Bundle?

| Without Bundle | With Bundle |
|----------------|-------------|
| Multiple calls to fetch rules | Single call returns everything |
| Mapping logic in Node-RED | Pre-calculated mapping |
| No intelligent cache | Cache with ETag and versioning |
| No integrity guarantee | HMAC-SHA256 signature |

---

## 2. M2M Authentication (API Key)

For M2M (Machine-to-Machine) integration like Node-RED, we recommend using **API Keys** instead of JWT tokens. API Keys are pre-generated and do not expire automatically, eliminating the need for constant renewal.

### Why Use API Key?

| JWT Token | API Key |
|-----------|---------|
| Expires periodically | Does not expire (configurable) |
| Requires frequent renewal | Configure once and use |
| Requires authentication flow | Simple header with key |
| Complex for M2M | Ideal for M2M |

### Generating an API Key

**Via API (requires admin JWT authentication):**

```bash
curl -X POST \
  "https://gcdr-server.apps.myio-bas.com/customers/{customerId}/api-keys" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: <tenant-uuid>" \
  -H "Authorization: Bearer <jwt-admin-token>" \
  -d '{
    "name": "Node-RED Production",
    "description": "API Key for bundle consumption by Node-RED",
    "scopes": ["bundles:read"]
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "apiKey": {
      "id": "key-uuid",
      "name": "Node-RED Production",
      "keyPrefix": "a1b2c3d4",
      "scopes": ["bundles:read"],
      "isActive": true,
      "createdAt": "2026-01-21T13:00:00.000Z"
    },
    "plaintextKey": "gcdr_cust_a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef12345678"
  }
}
```

**IMPORTANT**: The `plaintextKey` is returned **only once** at creation. Store it in a secure location (e.g., AWS Secrets Manager, vault). It cannot be recovered later.

### Available Scopes

| Scope | Description |
|-------|-------------|
| `bundles:read` | Access to bundles endpoint |
| `devices:read` | Read access to devices |
| `rules:read` | Read access to rules |
| `assets:read` | Read access to assets |
| `groups:read` | Read access to groups |
| `*:read` | Read access to all resources |

### Using the API Key

Instead of using `Authorization: Bearer <jwt>`, use the `X-API-Key` header:

```bash
curl -X GET \
  "https://gcdr-server.apps.myio-bas.com/customers/{customerId}/alarm-rules/bundle" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: gcdr_cust_a1b2c3d4..."
```

> **Note:** The `x-tenant-id` header is **optional** when using API Key. The tenant is automatically discovered from the API Key.

### Configuration in Node-RED

```javascript
// In function node
msg.headers = {
    'Content-Type': 'application/json',
    'X-API-Key': env.get('GCDR_API_KEY')
};

msg.url = env.get('GCDR_API_URL') + '/customers/' + env.get('CUSTOMER_ID') + '/alarm-rules/bundle';
return msg;
```

### Managing API Keys

**List keys for a customer:**

```bash
curl -X GET \
  "https://gcdr-server.apps.myio-bas.com/customers/{customerId}/api-keys" \
  -H "Authorization: Bearer <jwt-admin-token>"
```

**Revoke a key:**

```bash
curl -X DELETE \
  "https://gcdr-server.apps.myio-bas.com/customers/{customerId}/api-keys/{keyId}" \
  -H "Authorization: Bearer <jwt-admin-token>"
```

**Temporarily disable:**

```bash
curl -X PUT \
  "https://gcdr-server.apps.myio-bas.com/customers/{customerId}/api-keys/{keyId}" \
  -H "Authorization: Bearer <jwt-admin-token>" \
  -d '{"isActive": false}'
```

---

## 3. Bundle Endpoint

### URL

```
GET /customers/{customerId}/alarm-rules/bundle
```

### Development Environment

```
https://gcdr-server.apps.myio-bas.com/customers/{customerId}/alarm-rules/bundle
```

### Required Headers

**Option 1: API Key (Recommended for M2M/Node-RED)**

```http
Content-Type: application/json
X-API-Key: gcdr_cust_<your-api-key>
```

> **Note:** `x-tenant-id` is **optional** with API Key - tenant is auto-discovered from the key.

**Option 2: JWT Token**

```http
Content-Type: application/json
x-tenant-id: <tenant-uuid>
Authorization: Bearer <jwt-token>
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | string | No | Filter by domain (e.g., `energy`, `security`) |
| `deviceType` | string | No | Filter by device type (e.g., `STORE`, `ELEVATOR`) |
| `includeDisabled` | boolean | No | Include disabled rules (default: `false`) |

### Request Example

**With API Key (Recommended for Node-RED):**

```bash
curl -X GET \
  "https://gcdr-server.apps.myio-bas.com/customers/cust-123/alarm-rules/bundle?domain=energy" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: gcdr_cust_a1b2c3d4e5f67890abcdef..."
```

**With JWT Token:**

```bash
curl -X GET \
  "https://gcdr-server.apps.myio-bas.com/customers/cust-123/alarm-rules/bundle?domain=energy" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-uuid" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

---

## 4. Bundle Structure

### Complete Response

```json
{
  "success": true,
  "data": {
    "meta": {
      "version": "a1b2c3d4e5f67890",
      "generatedAt": "2026-01-21T13:00:00.000Z",
      "customerId": "cust-123",
      "customerName": "Company ABC",
      "tenantId": "tenant-uuid",
      "signature": "9f8e7d6c5b4a3210...",
      "algorithm": "HMAC-SHA256",
      "ttlSeconds": 300,
      "rulesCount": 15,
      "devicesCount": 42
    },
    "rules": {
      "rule-001": {
        "id": "rule-001",
        "name": "High Temperature",
        "priority": "HIGH",
        "metric": "temperature",
        "operator": "GREATER_THAN",
        "value": 30,
        "unit": "celsius",
        "duration": 300,
        "hysteresis": 2,
        "hysteresisType": "ABSOLUTE",
        "aggregation": "AVG",
        "aggregationWindow": 60,
        "enabled": true,
        "tags": ["critical", "temperature"]
      },
      "rule-002": {
        "id": "rule-002",
        "name": "High Consumption",
        "priority": "MEDIUM",
        "metric": "power_consumption",
        "operator": "GREATER_THAN",
        "value": 1000,
        "unit": "kWh",
        "enabled": true,
        "tags": ["energy"]
      }
    },
    "rulesByDeviceType": {
      "STORE": {
        "deviceType": "STORE",
        "domain": "energy",
        "deviceCount": 10,
        "devices": [
          {
            "id": "dev-001",
            "name": "Downtown Store",
            "serialNumber": "SN-001",
            "externalId": "EXT-001"
          }
        ],
        "ruleIds": ["rule-001", "rule-002"]
      },
      "ELEVATOR": {
        "deviceType": "ELEVATOR",
        "domain": "facility",
        "deviceCount": 5,
        "devices": [
          {
            "id": "dev-010",
            "name": "Elevator A",
            "serialNumber": "SN-010"
          }
        ],
        "ruleIds": ["rule-001"]
      }
    },
    "deviceIndex": {
      "dev-001": {
        "deviceId": "dev-001",
        "deviceName": "Downtown Store",
        "deviceType": "STORE",
        "domain": "energy",
        "serialNumber": "SN-001",
        "externalId": "EXT-001",
        "ruleIds": ["rule-001", "rule-002"]
      },
      "dev-010": {
        "deviceId": "dev-010",
        "deviceName": "Elevator A",
        "deviceType": "ELEVATOR",
        "domain": "facility",
        "serialNumber": "SN-010",
        "ruleIds": ["rule-001"]
      }
    }
  }
}
```

### Field Descriptions

#### Meta

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | SHA-256 hash of content (16 chars) - use as ETag |
| `generatedAt` | ISO8601 | Generation timestamp |
| `customerId` | string | Customer ID |
| `customerName` | string | Customer name |
| `tenantId` | string | Tenant ID |
| `signature` | string | HMAC-SHA256 signature for validation |
| `algorithm` | string | Algorithm used (always `HMAC-SHA256`) |
| `ttlSeconds` | number | Suggested cache time-to-live (default: 300s) |
| `rulesCount` | number | Total rules in bundle |
| `devicesCount` | number | Total devices in bundle |

#### Rules (Rules Catalog)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique rule ID |
| `name` | string | Descriptive name |
| `priority` | enum | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `metric` | string | Metric to evaluate (e.g., `temperature`) |
| `operator` | enum | `EQUAL`, `NOT_EQUAL`, `GREATER_THAN`, `LESS_THAN`, `BETWEEN`, etc. |
| `value` | number | Threshold value |
| `valueHigh` | number | High value (for `BETWEEN`) |
| `unit` | string | Unit of measurement |
| `duration` | number | Time in seconds to trigger |
| `hysteresis` | number | Hysteresis value to prevent flapping |
| `hysteresisType` | enum | `PERCENTAGE` or `ABSOLUTE` |
| `aggregation` | enum | `AVG`, `MIN`, `MAX`, `SUM`, `COUNT`, `LAST` |
| `aggregationWindow` | number | Aggregation window in seconds |
| `enabled` | boolean | Whether the rule is active |
| `tags` | string[] | Tags for categorization |

#### Device Index

Fast mapping from `deviceId` to applicable rules. Use this index when receiving telemetry from a specific device.

#### Rules By Device Type

Grouping by device type. Use for bulk configuration or when you need to apply rules to all devices of a type.

---

## 5. Version Management (ETag)

The bundle supports **conditional requests** to avoid unnecessary transfers.

### How It Works

1. On the first request, store the `ETag` header from the response
2. On subsequent requests, send the `If-None-Match` header with the ETag
3. If the bundle hasn't changed, you'll receive `304 Not Modified` (no body)
4. If it changed, you'll receive `200 OK` with the new bundle

### Example with ETag

**First request:**

```bash
curl -i -X GET \
  "https://api.gcdr.io/dev/customers/cust-123/alarm-rules/bundle" \
  -H "Authorization: Bearer <token>"
```

**Response:**

```http
HTTP/1.1 200 OK
ETag: "a1b2c3d4e5f67890"
Cache-Control: private, max-age=300
X-Bundle-Version: a1b2c3d4e5f67890
X-Bundle-Signature: 9f8e7d6c5b4a3210...

{"success": true, "data": {...}}
```

**Subsequent requests:**

```bash
curl -i -X GET \
  "https://api.gcdr.io/dev/customers/cust-123/alarm-rules/bundle" \
  -H "Authorization: Bearer <token>" \
  -H "If-None-Match: \"a1b2c3d4e5f67890\""
```

**If unchanged:**

```http
HTTP/1.1 304 Not Modified
ETag: "a1b2c3d4e5f67890"
Cache-Control: private, max-age=300
```

**If changed:**

```http
HTTP/1.1 200 OK
ETag: "newversion12345678"
Cache-Control: private, max-age=300

{"success": true, "data": {...new bundle...}}
```

### Implementation in Node-RED

```javascript
// In function node (using API Key - recommended)
const cachedETag = flow.get('alarmBundleETag') || null;
const cachedBundle = flow.get('alarmBundle') || null;

msg.headers = {
    'X-API-Key': env.get('GCDR_API_KEY')
};

if (cachedETag) {
    msg.headers['If-None-Match'] = cachedETag;
}

msg.url = env.get('GCDR_API_URL') + '/customers/' + env.get('CUSTOMER_ID') + '/alarm-rules/bundle';
return msg;
```

```javascript
// After HTTP request node
if (msg.statusCode === 304) {
    // Use cached bundle
    msg.payload = flow.get('alarmBundle');
    node.status({fill:"green", shape:"dot", text:"Using cached bundle"});
} else if (msg.statusCode === 200) {
    // Update cache
    const etag = msg.headers['etag'];
    flow.set('alarmBundleETag', etag);
    flow.set('alarmBundle', msg.payload.data);
    node.status({fill:"blue", shape:"dot", text:"Bundle updated"});
}
return msg;
```

---

## 6. Signature Verification

The bundle includes an HMAC-SHA256 signature to ensure data hasn't been tampered with.

### Signed Structure

The signature is calculated over:

```json
{
  "meta": {
    "version": "<version>",
    "generatedAt": "<timestamp>",
    "customerId": "<customerId>",
    "tenantId": "<tenantId>"
  },
  "rulesCount": <number>,
  "devicesCount": <number>
}
```

### Verification in JavaScript

```javascript
const crypto = require('crypto');

function verifyBundleSignature(bundle, secretKey) {
    const contentToSign = {
        meta: {
            version: bundle.meta.version,
            generatedAt: bundle.meta.generatedAt,
            customerId: bundle.meta.customerId,
            tenantId: bundle.meta.tenantId
        },
        rulesCount: bundle.meta.rulesCount,
        devicesCount: bundle.meta.devicesCount
    };

    const serialized = JSON.stringify(contentToSign);
    const expectedSignature = crypto
        .createHmac('sha256', secretKey)
        .update(serialized)
        .digest('hex');

    // Secure comparison against timing attacks
    return crypto.timingSafeEqual(
        Buffer.from(bundle.meta.signature),
        Buffer.from(expectedSignature)
    );
}

// Usage
const isValid = verifyBundleSignature(bundle, process.env.BUNDLE_SIGNING_SECRET);
if (!isValid) {
    throw new Error('Bundle signature verification failed!');
}
```

### Verification in Node-RED (Function Node)

```javascript
const crypto = global.get('crypto');
const secretKey = env.get('BUNDLE_SIGNING_SECRET');
const bundle = msg.payload.data;

const contentToSign = {
    meta: {
        version: bundle.meta.version,
        generatedAt: bundle.meta.generatedAt,
        customerId: bundle.meta.customerId,
        tenantId: bundle.meta.tenantId
    },
    rulesCount: bundle.meta.rulesCount,
    devicesCount: bundle.meta.devicesCount
};

const expectedSignature = crypto
    .createHmac('sha256', secretKey)
    .update(JSON.stringify(contentToSign))
    .digest('hex');

if (bundle.meta.signature !== expectedSignature) {
    node.error('Bundle signature verification failed!');
    node.status({fill:"red", shape:"ring", text:"Invalid signature"});
    return null;
}

node.status({fill:"green", shape:"dot", text:"Signature valid"});
return msg;
```

---

## 7. Practical Examples

### 7.1 Fetch Rules for a Specific Device

When receiving telemetry from a device, use the `deviceIndex` for fast lookup:

```javascript
// Function node - process telemetry
const bundle = flow.get('alarmBundle');
const deviceId = msg.payload.deviceId;
const telemetry = msg.payload.data;

// Fast lookup in deviceIndex
const deviceMapping = bundle.deviceIndex[deviceId];

if (!deviceMapping) {
    node.warn('Device not found in bundle: ' + deviceId);
    return null;
}

// Fetch applicable rules
const applicableRules = deviceMapping.ruleIds.map(ruleId => bundle.rules[ruleId]);

// Evaluate each rule
const violations = [];
for (const rule of applicableRules) {
    if (!rule.enabled) continue;

    const metricValue = telemetry[rule.metric];
    if (metricValue === undefined) continue;

    if (evaluateThreshold(metricValue, rule)) {
        violations.push({
            ruleId: rule.id,
            ruleName: rule.name,
            priority: rule.priority,
            metric: rule.metric,
            threshold: rule.value,
            actualValue: metricValue,
            deviceId: deviceId,
            deviceName: deviceMapping.deviceName
        });
    }
}

msg.violations = violations;
return msg;

function evaluateThreshold(value, rule) {
    switch (rule.operator) {
        case 'GREATER_THAN': return value > rule.value;
        case 'LESS_THAN': return value < rule.value;
        case 'EQUAL': return value === rule.value;
        case 'BETWEEN': return value >= rule.value && value <= rule.valueHigh;
        default: return false;
    }
}
```

### 7.2 Configure All Devices of a Type

```javascript
// Function node - configure devices by type
const bundle = flow.get('alarmBundle');
const targetDeviceType = 'STORE';

const deviceTypeGroup = bundle.rulesByDeviceType[targetDeviceType];

if (!deviceTypeGroup) {
    node.warn('Device type not found: ' + targetDeviceType);
    return null;
}

// Generate configuration for each device
const configurations = deviceTypeGroup.devices.map(device => ({
    deviceId: device.id,
    serialNumber: device.serialNumber,
    rules: deviceTypeGroup.ruleIds.map(ruleId => {
        const rule = bundle.rules[ruleId];
        return {
            metric: rule.metric,
            operator: rule.operator,
            threshold: rule.value,
            duration: rule.duration || 0,
            priority: rule.priority
        };
    })
}));

msg.payload = configurations;
return msg;
```

### 7.3 Complete Synchronization Flow

```
[Inject: Every 5min] --> [Build Request] --> [HTTP Request] --> [Handle Response] --> [Verify Signature] --> [Store Bundle]
                                                    |
                                              [304 Not Modified]
                                                    |
                                                    v
                                            [Use Cached Bundle]
```

---

## 8. Cache Strategies

### Recommendations

| Scenario | Suggested TTL | Strategy |
|----------|---------------|----------|
| Production environment | 5 min (300s) | Use ETag + periodic polling |
| Development | 1 min (60s) | Reload more frequently |
| High load | 10 min (600s) | Reduce API calls |

### Cache Invalidation

Cache should be invalidated when:

1. **ETag changes**: Server returned 200 instead of 304
2. **Signature error**: Bundle may be corrupted
3. **Administrative request**: Operator forces refresh
4. **Timeout exceeded**: Bundle TTL expired

### Example Cache with TTL

```javascript
// Function node - check cache
const bundle = flow.get('alarmBundle');
const bundleTimestamp = flow.get('alarmBundleTimestamp');
const ttlSeconds = 300; // 5 minutes

const now = Date.now();
const cacheAge = bundleTimestamp ? (now - bundleTimestamp) / 1000 : Infinity;

if (bundle && cacheAge < ttlSeconds) {
    // Cache still valid
    msg.useCache = true;
    msg.cacheAge = Math.round(cacheAge);
    node.status({fill:"green", shape:"dot", text:"Cache hit (" + msg.cacheAge + "s)"});
} else {
    // Needs update
    msg.useCache = false;
    node.status({fill:"yellow", shape:"ring", text:"Cache miss"});
}

return msg;
```

---

## 9. Troubleshooting

### Error: 404 Not Found

**Cause:** Invalid or non-existent Customer ID.

**Solution:** Verify that the `customerId` is correct and that the customer exists in GCDR.

```bash
# Verify customer
curl -X GET "https://api.gcdr.io/dev/customers/{customerId}" \
  -H "Authorization: Bearer <token>"
```

### Error: 401 Unauthorized

**Cause:** Invalid or expired JWT token.

**Solution:** Renew the authentication token.

### Error: Empty bundle (0 rules, 0 devices)

**Cause:** Customer has no registered rules or devices.

**Solution:**
1. Verify devices exist for the customer
2. Verify rules of type `ALARM_THRESHOLD` exist
3. Check filters (`domain`, `deviceType`)

```bash
# List customer rules
curl -X GET "https://api.gcdr.io/dev/customers/{customerId}/rules" \
  -H "Authorization: Bearer <token>"

# List customer assets/devices
curl -X GET "https://api.gcdr.io/dev/customers/{customerId}/assets" \
  -H "Authorization: Bearer <token>"
```

### Error: Signature verification failed

**Cause:** Incorrect secret key or tampered bundle.

**Solution:**
1. Verify `BUNDLE_SIGNING_SECRET` is configured correctly
2. Verify the bundle was not modified after receipt
3. Contact GCDR team if the problem persists

### Performance: Too many API calls

**Cause:** Cache is not being used correctly.

**Solution:**
1. Implement cache with ETag (see section 5)
2. Increase polling interval
3. Use bundle TTL (`meta.ttlSeconds`)

---

## Contact

- **GCDR Team**: gcdr-team@myio.com.br
- **Slack**: #gcdr-support
- **API Documentation**: https://gcdr-server.apps.myio-bas.com/docs

---

*Last updated: 2026-01-21*
