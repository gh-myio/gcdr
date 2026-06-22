# GCDR — Telegram Daily Summary Templates

Two daily summary templates available for the alarm backend to send once a day via Telegram.

| Template | Scope | Target group |
|----------|-------|--------------|
| `TELEGRAM_DAILY_SUMMARY` | Single customer | Customer's own Telegram group |
| `TELEGRAM_DAILY_SUMMARY_MULTI` | All customers | Internal MYIO support group |

---

## Option 1 — Single Customer (`TELEGRAM_DAILY_SUMMARY`)

Sent once a day per customer to that customer's Telegram group.

### Payload

```json
POST /api/v1/templates/render
X-API-Key: gcdr_alarm_integration_key_2026
X-Tenant-Id: 11111111-1111-1111-1111-111111111111

{
  "type": "TELEGRAM_DAILY_SUMMARY",
  "customerId": "<customer-uuid>",
  "data": {
    "report": {
      "date": "08/04/2026",
      "generatedAt": "08/04/2026 23:59:00"
    },
    "customer": {
      "name": "Moxuara"
    },
    "summary": {
      "alarmsOpened": 5,
      "alarmsClosed": 3,
      "alarmsActive": 2,
      "devicesOnline": 142,
      "devicesOffline": 3
    },
    "activeAlarms": [
      { "alarm": { "title": "Dispositivos de Água — Sem Leitura 12h", "raisedAt": "08/04/2026 10:22:00" } },
      { "alarm": { "title": "Fancoil Ligado Fora do Horário",        "raisedAt": "08/04/2026 18:45:00" } }
    ]
  }
}
```

`activeAlarms` pode ser `[]` — o bloco `{{#if summary.alarmsActive}}` suprime automaticamente.

### Rendered output

```
📅 RESUMO DO DIA — 08/04/2026
📍 Moxuara

━━━━━━━━━━━━━━━━━━━━
🚨 Alarmes
  • Abertos hoje: 5
  • Resolvidos: 3
  • Ainda ativos: 2

📡 Dispositivos
  • Online: 142
  • Offline: 3

⚠️ Alarmes em aberto:
  · Dispositivos de Água — Sem Leitura 12h (desde 08/04/2026 10:22:00)
  · Fancoil Ligado Fora do Horário (desde 08/04/2026 18:45:00)
━━━━━━━━━━━━━━━━━━━━
Gerado automaticamente às 08/04/2026 23:59:00
```

### Tag catalog

| Tag | Description | Example |
|-----|-------------|---------|
| `{{report.date}}` | Summary date | `08/04/2026` |
| `{{report.generatedAt}}` | Generation time | `08/04/2026 23:59:00` |
| `{{customer.name}}` | Customer name | `Moxuara` |
| `{{summary.alarmsOpened}}` | Alarms opened today | `5` |
| `{{summary.alarmsClosed}}` | Alarms resolved today | `3` |
| `{{summary.alarmsActive}}` | Alarms still open | `2` |
| `{{summary.devicesOnline}}` | Devices online | `142` |
| `{{summary.devicesOffline}}` | Devices offline | `3` |
| `{{#if summary.alarmsActive}}` | Renders block only if there are active alarms | — |
| `{{#each activeAlarms}}` | Loop over active alarms | — |
| `{{alarm.title}}` | Alarm title *(inside each)* | `Sem Leitura 12h` |
| `{{alarm.raisedAt}}` | Alarm open time *(inside each)* | `08/04/2026 10:22:00` |

---

## Option 2 — Multi Customer (`TELEGRAM_DAILY_SUMMARY_MULTI`)

Single message sent once a day to the internal MYIO support group with a consolidated view of all customers.

**Target group:** `945acbfb-9b96-4073-9555-c0f61a4860be` (Grupo Interno MYIO Alarmes)

### Status icon logic (computed by alarm backend)

| Icon | Condition |
|------|-----------|
| 🔴 | `alarmsActive > 0` |
| 🟡 | `alarmsActive === 0` and `devicesOffline > 0` |
| 🟢 | `alarmsActive === 0` and `devicesOffline === 0` |

### Payload

```json
POST /api/v1/templates/render
X-API-Key: gcdr_alarm_integration_key_2026
X-Tenant-Id: 11111111-1111-1111-1111-111111111111

{
  "type": "TELEGRAM_DAILY_SUMMARY_MULTI",
  "customerId": "56614a70-326f-11ef-ad2c-53aeabe7d3fa",
  "data": {
    "report": {
      "date": "08/04/2026",
      "generatedAt": "08/04/2026 23:59:00"
    },
    "summary": {
      "totalCustomers": 8,
      "totalAlarmsActive": 5,
      "totalDevicesOffline": 12
    },
    "customers": [
      {
        "statusIcon": "🔴",
        "name": "Moxuara",
        "alarmsOpened": 3,
        "alarmsActive": 2,
        "devicesOffline": 4
      },
      {
        "statusIcon": "🟡",
        "name": "Mestre Álvaro",
        "alarmsOpened": 1,
        "alarmsActive": 0,
        "devicesOffline": 2
      },
      {
        "statusIcon": "🟢",
        "name": "Shopping da Ilha",
        "alarmsOpened": 0,
        "alarmsActive": 0,
        "devicesOffline": 0
      }
    ]
  }
}
```

### Rendered output

```
📅 RESUMO DO DIA — 08/04/2026
🏢 8 clientes monitorados

━━━━━━━━━━━━━━━━━━━━
🚨 5 alarmes ativos  |  📡 12 dispositivos offline

🔴 Moxuara
   Alarmes: 2 ativos / 3 abertos hoje  |  Offline: 4

🟡 Mestre Álvaro
   Alarmes: 0 ativos / 1 abertos hoje  |  Offline: 2

🟢 Shopping da Ilha
   Alarmes: 0 ativos / 0 abertos hoje  |  Offline: 0

━━━━━━━━━━━━━━━━━━━━
Gerado automaticamente às 08/04/2026 23:59:00
```

### Tag catalog

| Tag | Description | Example |
|-----|-------------|---------|
| `{{report.date}}` | Summary date | `08/04/2026` |
| `{{report.generatedAt}}` | Generation time | `08/04/2026 23:59:00` |
| `{{summary.totalCustomers}}` | Total customers monitored | `8` |
| `{{summary.totalAlarmsActive}}` | Total active alarms across all customers | `5` |
| `{{summary.totalDevicesOffline}}` | Total offline devices across all customers | `12` |
| `{{#each customers}}` | Loop over customers | — |
| `{{customer.statusIcon}}` | Status icon computed by alarm backend *(inside each)* | `🔴` |
| `{{customer.name}}` | Customer name *(inside each)* | `Moxuara` |
| `{{customer.alarmsActive}}` | Active alarms *(inside each)* | `2` |
| `{{customer.alarmsOpened}}` | Alarms opened today *(inside each)* | `3` |
| `{{customer.devicesOffline}}` | Offline devices *(inside each)* | `4` |

---

## Notes

- Both templates are resolved with customer hierarchy: customer override → tenant default.
- Telegram has a **4096 character limit** per message. For large customer lists, the alarm backend should consider sending only customers with `alarmsActive > 0` or `devicesOffline > 0` to keep the message concise.
- Recommended cron schedule: **23:59** (end of day) or **07:00** (start of next day with previous day data).
- Tag catalog available at: `GET /api/v1/templates/tag-catalog?type=TELEGRAM_DAILY_SUMMARY_MULTI`
