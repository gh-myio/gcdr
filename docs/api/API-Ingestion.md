# API — Ingestion Integration

How the **ingestion system** addresses GCDR resources by its **own** customer id, and the
endpoint it uses to fetch the alarm-rules verify bundle.

- **Base URL (local):** `http://localhost:3015/api/v1`
- **Base URL (prod):** `https://gcdr-api.a.myio-bas.com/api/v1`

---

## 1. The `ingestionCustomerId` field

A customer is identified by **three different ids**, which must not be confused:

| id | field | source | notes |
|---|---|---|---|
| GCDR internal id | `customers.id` (`customerId`) | GCDR | the canonical UUID used everywhere internally |
| ThingsBoard id | `customers.external_id` (`externalId`) | ThingsBoard (`metadata.tbId`) | the TB customer id |
| **Ingestion id** | `customers.ingestion_customer_id` (`ingestionCustomerId`) | **Ingestion system** (`metadata.ingestionId`) | **the id the ingestion system uses for this customer** |

`ingestionCustomerId` is a **UUID**, unique per tenant, and is **distinct** from
`externalId` (ThingsBoard). It previously lived only inside `customers.metadata.ingestionId`;
it is now a first-class column so it can be indexed, resolved, and edited.

### Reading / editing
`ingestionCustomerId` is included in the customer response and is writable on
create/update:

```jsonc
// GET /customers/{customerId} → data:
{
  "id": "84e0370e-636a-4741-9874-504b5e0b3577",
  "externalId": "5085bf40-b4dd-11f0-be7f-e760d1498268",   // ThingsBoard (tbId)
  "ingestionCustomerId": "211ae3f9-935d-43f7-8ffe-61801595f2a8", // ingestion id
  "name": "Moxuara",
  ...
}
```

```jsonc
// PATCH /customers/{customerId}  (or POST to create)
{ "ingestionCustomerId": "211ae3f9-935d-43f7-8ffe-61801595f2a8" }  // must be a UUID, or null to clear
```

---

## 2. `GET /ingestion/customers/{ingestionCustomerId}/alarm-rules/bundle/to-verify-service`

The alarm-rules **verify bundle**, keyed by the customer's **ingestion id** instead of the
GCDR internal `customerId`. It resolves `ingestionCustomerId` → internal customer, then
returns the **identical** payload as
`GET /customers/{customerId}/alarm-rules/bundle/to-verify-service`.

This is what the ingestion / no-consumption evaluator calls when it only knows its own
customer id.

### Auth
Same as `/customers/{customerId}/alarm-rules/bundle/to-verify-service` — `authMiddleware`
(master key **or** JWT). The tenant is taken from the authenticated context; the resolution
is scoped to that tenant.

### Path & query
| in | name | required | meaning |
|---|---|---|---|
| path | `ingestionCustomerId` | yes | the customer's id in the ingestion system (UUID) |
| query | `domain` | no | filter by metric domain |
| query | `deviceType` | no | filter by device type |
| query | `includeDisabled` | no | `true` to include disabled rules |
| header | `X-Central-Id` | no | scope the bundle to one central |

### Response — `200 OK`
Standard success envelope; `data` is byte-identical to the internal-id verify endpoint:

```jsonc
{
  "versionId": "<bundle version>",
  "deviceIndex": { /* device id → metadata */ },
  "rules": [ /* enriched rules incl. per-action notifications */ ],
  "noConsumptionRules": [ /* present only when the customer has NO_CONSUMPTION rules */ ]
}
```

### Errors
| status | when |
|---|---|
| `400` | `ingestionCustomerId` missing |
| `404` | no customer in this tenant maps to that `ingestionCustomerId` |
| `401/403` | auth failed |

### Example
```bash
curl -s \
  -H "Authorization: Bearer $JWT" \
  "http://localhost:3015/api/v1/ingestion/customers/211ae3f9-935d-43f7-8ffe-61801595f2a8/alarm-rules/bundle/to-verify-service"
```

### Equivalent by internal id (for reference)
```
GET /customers/{customerId}/alarm-rules/bundle/to-verify-service
```
Both return the same `data`; only the addressing differs.

---

## 3. Operational notes

- **Migration:** `drizzle/migrations/0074_customer_ingestion_customer_id.sql` adds the column
  + `(tenant_id, ingestion_customer_id)` index (idempotent).
- **Backfill:** `scripts/db/ops/backfill-customer-ingestion-customer-id.sql` loads the column
  from `metadata->>'ingestionId'` (UUID-guarded; only fills rows still NULL; idempotent; it
  reports any rows whose `metadata.ingestionId` is present but not a valid UUID, which are
  skipped rather than failing the load). Run it **after** the migration.
- Going forward, the ingestion sync (or a manual edit in customer detail) keeps
  `ingestion_customer_id` populated; the backfill is only for existing rows.
