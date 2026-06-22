# GCDR — Template Render Guide for Alarm Backend

How the alarm backend fetches and renders notification templates from GCDR.

---

## Overview

GCDR stores all notification templates (Telegram, Email, etc.) and exposes a single render endpoint.
The alarm backend sends the alarm data; GCDR resolves the correct template for that customer,
substitutes all `{{variables}}`, and returns the ready-to-send content.

**Resolution order (first match wins):**
1. Customer-specific template override
2. Parent customer template (walks hierarchy)
3. Tenant default template

---

## Endpoint

```
POST /api/v1/templates/render
```

**Auth:** API Key M2M (`X-API-Key: gcdr_pk_*`) or Bearer JWT  
**Headers:**
```
X-API-Key: <alarm-backend-api-key>
X-Tenant-Id: 11111111-1111-1111-1111-111111111111
Content-Type: application/json
```

**Response headers returned by GCDR:**
```
X-Template-Version: 1
X-Template-Source: tenant   (or "customer")
X-Theme-Source: customer
```

---

## Telegram — Alarm Opened

```json
POST /api/v1/templates/render

{
  "type": "TELEGRAM_ALARM_OPENED",
  "customerId": "56614a70-326f-11ef-ad2c-53aeabe7d3fa",
  "data": {
    "alarm": {
      "id":          "d4e5f6a7-0001-0001-0001-000000000001",
      "title":       "Dispositivos de Água — Sem Leitura 12h",
      "description": "Device has not sent readings for 12 consecutive hours.",
      "severity":    "HIGH",
      "raisedAt":    "07/04/2026 10:22:00"
    },
    "customer": {
      "name": "Myio"
    },
    "device": {
      "name":  "Sensor Água 01",
      "value": null,
      "unit":  null
    }
  }
}
```

**Rendered output (returned in `data.rendered`):**
```
🚨 ALARME ABERTO — HIGH

Dispositivos de Água — Sem Leitura 12h
Device has not sent readings for 12 consecutive hours.

📍 Cliente: Myio
🔧 Dispositivo: Sensor Água 01
⏰ Aberto em: 07/04/2026 10:22:00

ID: d4e5f6a7-0001-0001-0001-000000000001
```

---

## Telegram — Alarm Closed

```json
POST /api/v1/templates/render

{
  "type": "TELEGRAM_ALARM_CLOSED",
  "customerId": "56614a70-326f-11ef-ad2c-53aeabe7d3fa",
  "data": {
    "alarm": {
      "id":         "d4e5f6a7-0001-0001-0001-000000000001",
      "title":      "Dispositivos de Água — Sem Leitura 12h",
      "raisedAt":   "07/04/2026 10:22:00",
      "closedAt":   "07/04/2026 14:05:00",
      "resolution": "Device resumed normal data transmission."
    },
    "customer": {
      "name": "Myio"
    },
    "device": {
      "name": "Sensor Água 01"
    }
  }
}
```

---

## Telegram — Alarm Escalated

```json
POST /api/v1/templates/render

{
  "type": "TELEGRAM_ALARM_ESCALATED",
  "customerId": "56614a70-326f-11ef-ad2c-53aeabe7d3fa",
  "data": {
    "alarm": {
      "id":              "d4e5f6a7-0001-0001-0001-000000000001",
      "title":           "Dispositivos de Água — Sem Leitura 12h",
      "severity":        "HIGH",
      "raisedAt":        "07/04/2026 10:22:00",
      "escalatedAt":     "07/04/2026 11:00:00",
      "escalationLevel": 1,
      "dispatchCount":   2
    },
    "customer": {
      "name": "Myio"
    },
    "device": {
      "name": "Sensor Água 01"
    }
  }
}
```

---

## Email — Alarm Notification

```json
POST /api/v1/templates/render

{
  "type": "EMAIL_ALARM",
  "customerId": "56614a70-326f-11ef-ad2c-53aeabe7d3fa",
  "data": {
    "gateway": {
      "name": "MessageGatewayMyio",
      "type": "MESSAGE_GATEWAY"
    },
    "summary": {
      "rulesCount":   1,
      "devicesCount": 3
    },
    "rules": [
      {
        "name":        "Dispositivos de Água — Sem Leitura 12h",
        "description": "Device has not sent readings for 12 consecutive hours.",
        "condition":   "LAST water_flow == 0 for 12h",
        "emails":      "suporte@myio.com.br",
        "devices": [
          { "name": "Sensor Água 01", "value": null, "status": "offline", "timestamp": "07/04/2026 10:22:00" },
          { "name": "Sensor Água 02", "value": null, "status": "offline", "timestamp": "07/04/2026 10:23:00" }
        ]
      }
    ]
  }
}
```

---

## Telegram — Alarm Digest

Triggered when multiple alarms of the same type are grouped (dedup guard).

```json
POST /api/v1/templates/render

{
  "type": "TELEGRAM_ALARM_DIGEST",
  "customerId": "56614a70-326f-11ef-ad2c-53aeabe7d3fa",
  "data": {
    "alarm": {
      "count":    7,
      "type":     "Sem Leitura 12h",
      "severity": "HIGH"
    },
    "digest": {
      "windowStart": "07/04/2026 10:00:00",
      "windowEnd":   "07/04/2026 10:10:00",
      "threshold":   5
    },
    "customer": {
      "name": "Myio"
    }
  }
}
```

---

## Available `type` values

| Type                         | Event                        |
|------------------------------|------------------------------|
| `TELEGRAM_ALARM_OPENED`      | Alarm raised                 |
| `TELEGRAM_ALARM_CLOSED`      | Alarm resolved               |
| `TELEGRAM_ALARM_ESCALATED`   | Alarm escalated (manual)     |
| `TELEGRAM_ALARM_ACKNOWLEDGED`| Alarm acknowledged (ACK)     |
| `TELEGRAM_ALARM_SNOOZED`     | Alarm snoozed                |
| `TELEGRAM_ALARM_DIGEST`      | Grouped alarm digest         |
| `EMAIL_ALARM`                | Email alarm notification     |
| `EMAIL_REPORT`               | Periodic report              |
| `EMAIL_WELCOME`              | User welcome email           |

---

## Notes

- All `data` fields are optional at the API level — missing fields render as empty string in the template.
- Pass `"version": 2` in the body to pin a specific template version (omit for latest ACTIVE).
- `X-Template-Source` header tells you whether a customer override or the tenant default was used.
- Tag catalog per type: `GET /api/v1/templates/tag-catalog?type=TELEGRAM_ALARM_OPENED`
