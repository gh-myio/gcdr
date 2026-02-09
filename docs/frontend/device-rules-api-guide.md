# Device Rules Association - Frontend Integration Guide

> **RFC:** RFC-0014
> **Status:** Draft
> **Last Updated:** 2026-02-09

## Overview

This guide describes the new Device-Rules Association API that enables flexible many-to-many relationships between devices and alarm rules. This replaces the limited scope-based system where a rule could only target one specific device.

## What's New?

### Before (Current System)

A rule can only be associated with ONE device using scope:

```json
{
  "name": "High Temperature Alert",
  "scope": {
    "type": "DEVICE",
    "entityId": "device-uuid-1"
  }
}
```

To apply the same rule to 3 devices, you need to create 3 separate rules.

### After (New System)

Create ONE rule and associate it with multiple devices:

```json
// 1. Create the rule (without device scope)
POST /api/v1/rules
{
  "name": "High Temperature Alert",
  "scope": { "type": "CUSTOMER", "entityId": "customer-uuid" }
}

// 2. Associate with specific devices
POST /api/v1/rules/{ruleId}/devices
{
  "deviceIds": ["device-1", "device-2", "device-3"]
}
```

---

## API Reference

### Base URL

```
/api/v1
```

### Authentication

All endpoints require authentication via JWT token or API key:

```
Authorization: Bearer <token>
X-API-Key: <api-key>
```

---

## Endpoints

### 1. Create Device-Rule Association

Associate a single device with a rule.

```http
POST /api/v1/device-rules
```

**Request Body:**

```typescript
interface CreateDeviceRuleRequest {
  deviceId: string;      // Required - Device UUID
  ruleId: string;        // Required - Rule UUID
  priority?: number;     // Optional - Execution priority (default: 0)
  enabled?: boolean;     // Optional - Enable association (default: true)
  configOverrides?: {    // Optional - Device-specific overrides
    value?: number;
    hysteresis?: number;
    duration?: number;
  };
}
```

**Example Request:**

```json
{
  "deviceId": "550e8400-e29b-41d4-a716-446655440001",
  "ruleId": "550e8400-e29b-41d4-a716-446655440002",
  "priority": 1,
  "enabled": true,
  "configOverrides": {
    "value": 35
  }
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440003",
    "deviceId": "550e8400-e29b-41d4-a716-446655440001",
    "ruleId": "550e8400-e29b-41d4-a716-446655440002",
    "priority": 1,
    "enabled": true,
    "configOverrides": {
      "value": 35
    },
    "createdAt": "2026-02-09T10:30:00Z",
    "createdBy": "user-uuid"
  }
}
```

---

### 2. Bulk Associate Devices with Rule

Associate multiple devices with a single rule in one request.

```http
POST /api/v1/rules/:ruleId/devices
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `ruleId` | UUID | The rule to associate devices with |

**Request Body:**

```typescript
interface BulkAssociateRequest {
  deviceIds: string[];   // Required - Array of device UUIDs (max 100)
  priority?: number;     // Optional - Priority for all associations
  enabled?: boolean;     // Optional - Enable all associations
}
```

**Example Request:**

```json
{
  "deviceIds": [
    "550e8400-e29b-41d4-a716-446655440001",
    "550e8400-e29b-41d4-a716-446655440002",
    "550e8400-e29b-41d4-a716-446655440003"
  ],
  "priority": 1,
  "enabled": true
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "assoc-uuid-1",
        "deviceId": "550e8400-e29b-41d4-a716-446655440001",
        "ruleId": "rule-uuid",
        "priority": 1,
        "enabled": true
      },
      {
        "id": "assoc-uuid-2",
        "deviceId": "550e8400-e29b-41d4-a716-446655440002",
        "ruleId": "rule-uuid",
        "priority": 1,
        "enabled": true
      }
    ],
    "count": 3,
    "failed": []
  }
}
```

---

### 3. List Rules for a Device

Get all rules associated with a specific device.

```http
GET /api/v1/devices/:deviceId/rules
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `deviceId` | UUID | The device ID |

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabled` | boolean | - | Filter by enabled status |
| `type` | string | - | Filter by rule type |
| `limit` | number | 50 | Max results |
| `cursor` | string | - | Pagination cursor |

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "association": {
          "id": "assoc-uuid",
          "priority": 1,
          "enabled": true,
          "configOverrides": null,
          "createdAt": "2026-02-09T10:30:00Z"
        },
        "rule": {
          "id": "rule-uuid",
          "name": "High Temperature Alert",
          "type": "ALARM_THRESHOLD",
          "priority": "HIGH",
          "enabled": true,
          "alarmConfig": {
            "metric": "temperature",
            "operator": "GT",
            "value": 30
          }
        }
      }
    ],
    "count": 1,
    "cursor": null
  }
}
```

---

### 4. List Devices for a Rule

Get all devices associated with a specific rule.

```http
GET /api/v1/rules/:ruleId/devices
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `ruleId` | UUID | The rule ID |

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabled` | boolean | - | Filter by association enabled status |
| `limit` | number | 50 | Max results |
| `cursor` | string | - | Pagination cursor |

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "association": {
          "id": "assoc-uuid",
          "priority": 1,
          "enabled": true,
          "configOverrides": { "value": 35 }
        },
        "device": {
          "id": "device-uuid",
          "name": "Sensor Sala Servidor 01",
          "type": "SENSOR",
          "serialNumber": "SN-001",
          "connectivityStatus": "ONLINE"
        }
      }
    ],
    "count": 1,
    "cursor": null
  }
}
```

---

### 5. Update Association

Update an existing device-rule association.

```http
PATCH /api/v1/device-rules/:id
```

**Request Body:**

```typescript
interface UpdateDeviceRuleRequest {
  priority?: number;
  enabled?: boolean;
  configOverrides?: object | null;  // null to remove overrides
}
```

**Example - Disable association:**

```json
{
  "enabled": false
}
```

**Example - Update override:**

```json
{
  "configOverrides": {
    "value": 40,
    "hysteresis": 2
  }
}
```

**Response:** `200 OK`

---

### 6. Delete Association

Remove a device-rule association.

```http
DELETE /api/v1/device-rules/:id
```

**Response:** `204 No Content`

---

### 7. Bulk Delete Associations

Remove multiple associations for a rule.

```http
DELETE /api/v1/rules/:ruleId/devices
```

**Request Body:**

```json
{
  "deviceIds": ["device-1", "device-2"]
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "deleted": 2
  }
}
```

---

### 8. Get Rules Version

Get the current version number for a customer's rules configuration.

```http
GET /api/v1/customers/:customerId/rules/version
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "version": 42,
    "versionId": "v42",
    "lastChangedAt": "2026-02-09T10:30:00Z",
    "lastChangeType": "ASSOCIATION_CREATED"
  }
}
```

---

## UI Components Suggestions

### 1. Rule Editor - Device Selection

Add a device selection step when creating/editing rules:

```
┌─────────────────────────────────────────────────────────┐
│  Create Alarm Rule                              Step 2/3 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Select Target Devices                                  │
│                                                         │
│  ○ All devices (Global)                                 │
│  ○ All devices in customer                              │
│  ● Specific devices                                     │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Search devices...                          🔍   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ☑ Sensor Sala Servidor 01        ONLINE    SENSOR     │
│  ☑ Sensor Sala Servidor 02        ONLINE    SENSOR     │
│  ☐ Sensor Recepção                OFFLINE   SENSOR     │
│  ☑ Medidor Energia Bloco A        ONLINE    METER      │
│                                                         │
│  Selected: 3 devices                                    │
│                                                         │
│  [ Back ]                              [ Next Step → ]  │
└─────────────────────────────────────────────────────────┘
```

### 2. Device Detail - Associated Rules Tab

Show rules associated with a device:

```
┌─────────────────────────────────────────────────────────┐
│  Device: Sensor Sala Servidor 01                        │
├─────────────────────────────────────────────────────────┤
│  Overview │ Telemetry │ [Rules] │ History │ Settings    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Associated Rules (3)                    [ + Add Rule ] │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 🔴 High Temperature Alert           CRITICAL    │   │
│  │    temperature > 30°C                           │   │
│  │    Priority: 1  │  Enabled  │  Override: 35°C   │   │
│  │                                    [Edit] [🗑️]  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 🟡 Low Battery Warning              MEDIUM      │   │
│  │    battery < 20%                                │   │
│  │    Priority: 2  │  Enabled  │  No Override      │   │
│  │                                    [Edit] [🗑️]  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3. Rule Detail - Associated Devices Tab

Show devices associated with a rule:

```
┌─────────────────────────────────────────────────────────┐
│  Rule: High Temperature Alert                           │
├─────────────────────────────────────────────────────────┤
│  Configuration │ [Devices] │ History │ Test             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Associated Devices (12)              [ + Add Devices ] │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Filter: [All Types ▼] [All Status ▼] [Search...] │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ☑ │ Device Name              │ Type   │ Status │ Override │
│  ──┼──────────────────────────┼────────┼────────┼──────────│
│  ☑ │ Sensor Sala Servidor 01  │ SENSOR │ 🟢     │ 35°C     │
│  ☑ │ Sensor Sala Servidor 02  │ SENSOR │ 🟢     │ -        │
│  ☑ │ Sensor CPD               │ SENSOR │ 🟢     │ 28°C     │
│  ☑ │ Sensor Telecom           │ SENSOR │ 🔴     │ -        │
│                                                         │
│  [ Remove Selected (0) ]                                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## TypeScript Types

```typescript
// Device Rule Association
interface DeviceRule {
  id: string;
  deviceId: string;
  ruleId: string;
  priority: number;
  enabled: boolean;
  configOverrides?: ConfigOverrides | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

// Config overrides (device-specific rule adjustments)
interface ConfigOverrides {
  value?: number;
  valueHigh?: number;
  hysteresis?: number;
  duration?: number;
}

// Create request
interface CreateDeviceRuleRequest {
  deviceId: string;
  ruleId: string;
  priority?: number;
  enabled?: boolean;
  configOverrides?: ConfigOverrides;
}

// Bulk associate request
interface BulkAssociateRequest {
  deviceIds: string[];
  priority?: number;
  enabled?: boolean;
}

// Update request
interface UpdateDeviceRuleRequest {
  priority?: number;
  enabled?: boolean;
  configOverrides?: ConfigOverrides | null;
}

// Response with device info
interface DeviceRuleWithDevice {
  association: DeviceRule;
  device: DeviceSummary;
}

// Response with rule info
interface DeviceRuleWithRule {
  association: DeviceRule;
  rule: RuleSummary;
}

// Device summary for lists
interface DeviceSummary {
  id: string;
  name: string;
  type: string;
  serialNumber: string;
  connectivityStatus: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
}

// Rule summary for lists
interface RuleSummary {
  id: string;
  name: string;
  type: string;
  priority: string;
  enabled: boolean;
  alarmConfig?: AlarmConfig;
}

// Rules version info
interface RulesVersion {
  version: number;
  versionId: string;
  lastChangedAt: string;
  lastChangeType: string;
}
```

---

## React Query Examples

### Hooks

```typescript
// hooks/useDeviceRules.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// Get rules for a device
export function useDeviceRules(deviceId: string) {
  return useQuery({
    queryKey: ['device-rules', deviceId],
    queryFn: () => api.get(`/devices/${deviceId}/rules`),
    enabled: !!deviceId,
  });
}

// Get devices for a rule
export function useRuleDevices(ruleId: string) {
  return useQuery({
    queryKey: ['rule-devices', ruleId],
    queryFn: () => api.get(`/rules/${ruleId}/devices`),
    enabled: !!ruleId,
  });
}

// Associate devices with rule
export function useAssociateDevices(ruleId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (deviceIds: string[]) =>
      api.post(`/rules/${ruleId}/devices`, { deviceIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rule-devices', ruleId] });
      queryClient.invalidateQueries({ queryKey: ['device-rules'] });
    },
  });
}

// Remove association
export function useRemoveAssociation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (associationId: string) =>
      api.delete(`/device-rules/${associationId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-rules'] });
      queryClient.invalidateQueries({ queryKey: ['rule-devices'] });
    },
  });
}

// Update association
export function useUpdateAssociation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDeviceRuleRequest }) =>
      api.patch(`/device-rules/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-rules'] });
      queryClient.invalidateQueries({ queryKey: ['rule-devices'] });
    },
  });
}
```

### Component Example

```tsx
// components/RuleDeviceSelector.tsx
import { useState } from 'react';
import { useRuleDevices, useAssociateDevices, useRemoveAssociation } from '@/hooks/useDeviceRules';
import { useDevices } from '@/hooks/useDevices';

interface Props {
  ruleId: string;
  customerId: string;
}

export function RuleDeviceSelector({ ruleId, customerId }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Get currently associated devices
  const { data: associated, isLoading: loadingAssociated } = useRuleDevices(ruleId);

  // Get all available devices
  const { data: allDevices, isLoading: loadingDevices } = useDevices(customerId);

  // Mutations
  const associate = useAssociateDevices(ruleId);
  const remove = useRemoveAssociation();

  const associatedIds = associated?.data.items.map(a => a.device.id) ?? [];

  const handleAssociate = async () => {
    const newIds = selectedIds.filter(id => !associatedIds.includes(id));
    if (newIds.length > 0) {
      await associate.mutateAsync(newIds);
      setSelectedIds([]);
    }
  };

  const handleRemove = async (associationId: string) => {
    await remove.mutateAsync(associationId);
  };

  if (loadingAssociated || loadingDevices) {
    return <Spinner />;
  }

  return (
    <div>
      <h3>Associated Devices ({associated?.data.count})</h3>

      <ul>
        {associated?.data.items.map(({ association, device }) => (
          <li key={association.id}>
            {device.name}
            <button onClick={() => handleRemove(association.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>

      <h3>Add Devices</h3>

      <DeviceMultiSelect
        devices={allDevices?.data.items ?? []}
        selected={selectedIds}
        onChange={setSelectedIds}
        excludeIds={associatedIds}
      />

      <button
        onClick={handleAssociate}
        disabled={selectedIds.length === 0 || associate.isPending}
      >
        Add {selectedIds.length} Devices
      </button>
    </div>
  );
}
```

---

## Error Handling

| Status Code | Error | Description |
|-------------|-------|-------------|
| `400` | `VALIDATION_ERROR` | Invalid request body |
| `404` | `DEVICE_NOT_FOUND` | Device ID does not exist |
| `404` | `RULE_NOT_FOUND` | Rule ID does not exist |
| `409` | `ASSOCIATION_EXISTS` | Device is already associated with the rule |
| `422` | `INCOMPATIBLE_RULE` | Rule type is not compatible with device type |

**Error Response Format:**

```json
{
  "success": false,
  "error": {
    "code": "ASSOCIATION_EXISTS",
    "message": "Device is already associated with this rule",
    "details": {
      "deviceId": "device-uuid",
      "ruleId": "rule-uuid",
      "existingAssociationId": "assoc-uuid"
    }
  }
}
```

---

## Migration Notes

### For Existing Rules

Rules with `scope.type = 'DEVICE'` will continue to work. The system checks both:

1. Explicit associations in `device_rules` table (new)
2. Scope-based targeting (legacy)

Explicit associations take precedence if both exist.

### Recommended Migration

For rules targeting single devices via scope, consider migrating to explicit associations for consistency:

```typescript
// Find rules with DEVICE scope
const legacyRules = await api.get('/rules', {
  params: { scopeType: 'DEVICE' }
});

// For each, create explicit association and update scope to CUSTOMER
for (const rule of legacyRules.items) {
  await api.post('/device-rules', {
    deviceId: rule.scope.entityId,
    ruleId: rule.id,
  });

  await api.patch(`/rules/${rule.id}`, {
    scope: { type: 'CUSTOMER', entityId: rule.customerId }
  });
}
```

---

## Questions?

Contact the backend team or open an issue in the repository.
