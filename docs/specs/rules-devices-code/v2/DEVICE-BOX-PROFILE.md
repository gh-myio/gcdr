# BOX Device Profile — Design (v2)

> **Concept.** A **BOX** is a physical enclosure (a shipped product) that
> **contains several devices** of mixed types — e.g. `3` × 3F + `2` × HIDR. It is
> modeled as a **device with `deviceProfile = BOX`** (a container profile,
> instead of a leaf meter type like 3F/HIDR), has its **own product code + QR
> sticker**, and **owns a set of member devices**.
>
> **Status:** design draft (2026-08-17). Companion to the v2 numbering/name specs
> in this folder.

---

## 1. What a BOX is (and is not)

- A BOX is a **product** you build, label and ship — one enclosure.
- Inside it sit **N member devices** (3F, HIDR, TEMP…), each still a full device
  with its own code, name, `slaveId`/`centralId`, telemetry.
- The BOX itself does **not** produce telemetry; it is an **identity + grouping**:
  scan the box QR in the field and you know exactly which devices are inside.
- Contents are **heterogeneous and counted**: "this box = 3× 3F + 2× HIDR".

```
BOX  (deviceProfile = BOX, own code + QR)
 ├── 3F  270102-0001
 ├── 3F  270102-0002
 ├── 3F  270102-0003
 ├── HIDR 270102-0001
 └── HIDR 270102-0002
```

---

## 2. The BOX device

A BOX is a normal `devices` row with:

| Field | Value |
|---|---|
| `deviceProfile` | `BOX` (the container profile) |
| `type` (enum) | `OTHER` — or a new `CONTAINER` enum value (see §7) |
| `serialNumber` | its own product code (dotted `B1.B2.B3.B4`, BOX type byte — §4) |
| `name` | `BOX {YYMMDD}-{NNNN}` (v2 name spec) |
| everything else | normal device fields; `slaveId`/`centralId` may be null (a BOX is not a Modbus point) |

The BOX gets the **same factory identity treatment** as any product: a unique QR
sticker (manufacturing step 4) and a factory code over radio (step 5) — see
`../v1/fluxo_fabricacao_myio.pdf`.

---

## 3. Membership model

A member device belongs to **at most one** physical box. The simplest, correct
model is a **self-referential FK** on `devices`:

```ts
// devices table — new column
boxId: uuid('box_id').references(() => devices.id),   // nullable; points to a deviceProfile='BOX' device
```

```sql
-- migration sketch
ALTER TABLE devices ADD COLUMN box_id uuid REFERENCES devices(id) ON DELETE SET NULL;
CREATE INDEX devices_box_id_idx ON devices (tenant_id, box_id);
-- guard: box_id must point to a BOX, and a BOX cannot be its own member
--   (enforce in the service layer; a CHECK cannot see the referenced row's profile)
```

- **"devices in box X"** → `SELECT … FROM devices WHERE box_id = :X`.
- **contents summary (X 3F, Y HIDR)** → `GROUP BY device_profile`:
  ```sql
  SELECT device_profile, count(*)
  FROM devices WHERE tenant_id = :t AND box_id = :box
  GROUP BY device_profile;   -- -> { '3F': 3, 'HIDR': 2 }
  ```
- Move a device between boxes = update its `box_id`. Remove from a box = `NULL`.
- `ON DELETE SET NULL`: deleting the BOX orphans (does not delete) its members.

> **Alternative — join table** `device_box_members(box_id, device_id, slot)` if a
> device can belong to several *logical* groupings, or if physical **slot/position**
> inside the box matters. For pure physical containment the FK is enough and cheaper.

---

## 4. Numbering & name

The BOX is a product type, so it takes a **type byte** in the registry
(`DEVICE-NAME-SPEC.md §3a`) and a **name prefix**:

| `B4` | PREFIX | Product | Status |
|---|---|---|---|
| 18 | `BOX` | device enclosure (container) | **proposed** — byte to ratify |
| 19 | `BOXGRP` | box group (§8) | **proposed** — optional |

- **Code:** `B1.B2.B3.18` (v2 date-stamped) → e.g. `17.2.1.18`.
- **Name:** `BOX 270102-0001` (v2 name spec, space after prefix).
- The BOX's `NNNN` is its own daily sequential — **independent** of the member
  devices' sequentials (each type counts separately).

Members keep their own codes/names (`3F 270102-0001`, `HIDR 270102-0001`, …);
the BOX code is not derived from them.

---

## 5. QR code (label the box)

The QR printed on the enclosure encodes the **BOX identity**, so scanning it in
the field resolves the box and — via §3 — all its members.

**Payload (recommended):** the canonical product code string, prefixed with a
scheme marker so a scanner knows how to read it:

```
MYIO:BOX:17.2.1.18          # scheme:type:code  (human-scannable, version-safe)
```

- Minimal alternative: just the dotted code `17.2.1.18` (type byte already says BOX).
- On scan, the field app calls GCDR to resolve `serialNumber = 17.2.1.18` →
  the BOX device → `GET /devices?boxId={box.id}` for the contents.
- Generation: any QR lib (e.g. `qrcode`) over the payload string; same pipeline
  as the per-device sticker (manufacturing step 4). A BOX label should also print
  the human name (`BOX 270102-0001`) and the contents summary (`3× 3F · 2× HIDR`).

> A companion generator HTML can be added next to `myio-generate-device-name.html`
> to render the box code + QR + contents label. (Not built yet — say the word.)

---

## 6. GCDR mapping & API

Cross-ref [../../DEVICE-FIELDS-CATALOG.md](../../DEVICE-FIELDS-CATALOG.md).

**Schema changes**
1. Registry: add `18 = BOX` (`19 = BOXGRP` optional) to the type table.
2. `devices.box_id uuid` FK (§3) + index.
3. Convention: `deviceProfile = 'BOX'` marks the container row.

**API sketch** (fits the existing `/devices` surface)
- `POST /devices` with `deviceProfile: 'BOX'` → creates the enclosure.
- `GET /devices?boxId={id}` → members (already have `centralId`/`slaveId` filters;
  add `boxId`).
- `GET /devices/{boxId}/contents` → `{ '3F': 3, 'HIDR': 2, total: 5 }` (the GROUP BY).
- `PATCH /devices/{id}` `{ boxId }` → assign/move/remove (null) a member.
- Validation: `boxId` must reference a `deviceProfile='BOX'` device in the same
  tenant; a BOX cannot reference itself; (optional) reject nesting a BOX in a BOX
  unless BOX_GROUP is used (§8).

---

## 7. `type` enum vs `deviceProfile`

- `deviceProfile`/`deviceType` are free varchars → `deviceProfile='BOX'` needs **no
  migration** and is the lightest marker. **Recommended.**
- The `type` enum (`SENSOR|ACTUATOR|GATEWAY|CONTROLLER|METER|CAMERA|OUTLET|INFRARED|OTHER`)
  has no container value; use `OTHER`, or add `CONTAINER` in a migration if a
  first-class enum is wanted. Adding an enum value is a small migration; the
  `deviceProfile` marker works today without one.

---

## 8. BOX_GROUP (optional higher tier)

If boxes themselves need grouping (a pallet/rack of boxes, or a logical set):

- Same pattern, one level up: `deviceProfile = 'BOX_GROUP'`, type byte `19`,
  prefix `BOXGRP`. A BOX's `box_id` then points to a `BOX_GROUP` device.
- `box_id` becomes a generic "parent container" pointer; depth is limited by a
  service-layer rule (e.g. member → BOX → BOX_GROUP, max 2 levels) to avoid cycles.
- Keep it out of v1 unless there is a real need — the single BOX level covers
  "one box with mixed devices".

---

## 9. Rationale & alternatives

- **Why a device, not an asset?** GCDR assets already model a hierarchy
  (SITE→…→EQUIPMENT) and devices carry `assetId`. A BOX *could* be an EQUIPMENT
  asset. It is modeled as a **device** here because (a) it is a manufactured
  **product** with its own code/QR/factory flow, and (b) the ask is explicitly a
  *device with a profile*. The asset hierarchy still applies: a BOX device has an
  `assetId` (where it is installed) just like any device.
- **Why FK over join table?** Physical containment is 1 box : N devices, and a
  device is in exactly one box. The FK is the cheapest correct model; the join
  table only earns its keep with slots or multi-membership (§3).
- **Why a separate BOX product code?** So the box has a first-class, scannable
  identity independent of its (changing) contents — you can restock/replace a
  member without reprinting the box label's identity.

---

## 10. Open decisions

1. **Type byte** for `BOX` (proposed `18`) and `BOX_GROUP` (`19`) — ratify.
2. **`deviceProfile='BOX'`** (no migration) vs a new `type='CONTAINER'` enum value.
3. **FK (`box_id`)** vs **join table** — driven by whether slot/position matters.
4. **QR payload** format: `MYIO:BOX:{code}` (marked) vs bare `{code}`.
5. **Contents rules:** can a box mix domains (energy + water)? any max count?
6. **BOX_GROUP**: in scope now, or defer (§8)?
7. Does GCDR need a **`box` filter** on `/devices` and a **contents endpoint**, or
   is the BOX just metadata consumed by the field app?

---

_Authored 2026-08-17. Companion to `DEVICE-PRODUCT-CODE-NUMBERING.md` and
`DEVICE-NAME-SPEC.md`._
