# RFC-0058 — BOX Device Profile (device enclosures that contain devices)

- **Feature Name:** `box-device-profile`
- **Start Date:** 2026-08-17
- **RFC PR:** _(this PR)_
- **Tracking Issue:** _TBD_
- **Authors:** GCDR Core Team
- **Status:** Draft
- **Domain:** Devices / Master Data / Manufacturing identity
- **Related:** `docs/specs/rules-devices-code/v2/DEVICE-BOX-PROFILE.md` (design notes),
  `DEVICE-PRODUCT-CODE-NUMBERING.md` (v2 code), `DEVICE-NAME-SPEC.md` (v2 name),
  `DEVICE-FIELDS-CATALOG.md`, RFC-0008 (device attributes), RFC-0032 (QR addressing).

---

## Summary

Introduce a **BOX** device profile: a device that represents a **physical
enclosure** (a manufactured, labelled product) which **contains a set of other
devices** of mixed types — e.g. `3` × `3F` + `2` × `HIDR`. A BOX has its own
product code and QR sticker, and owns its member devices through a single
self-referential `box_id` foreign key. The BOX produces no telemetry of its own;
it is an **identity + grouping** so that scanning one label in the field resolves
the enclosure and everything inside it.

## Motivation

Today every `devices` row is a leaf: a meter or sensor identified by a type such
as `3F`, `HIDR`, `TEMP`. Hardware, however, is frequently **shipped and installed
as a boxed set** — one enclosure holding several meters wired together. There is
no first-class way to:

1. Give that enclosure **one scannable identity** (label the box, not each meter).
2. Record **which devices are inside** a given box, and **how many of each type**.
3. Restock/replace a member without losing the box's identity.

Operators end up tracking box contents in spreadsheets or by convention in device
names. This RFC makes the enclosure a modeled entity so the field app can scan a
box QR and immediately know its contents, and so master data can answer
"what is in box X?" and "which box is device Y in?".

## Guide-level explanation

A **BOX** is a device whose profile is `BOX` instead of a meter type. It looks
like this:

```
BOX 270102-0001            (deviceProfile = BOX, its own product code + QR)
 ├── 3F 270102-0001
 ├── 3F 270102-0002
 ├── 3F 270102-0003
 ├── HIDR 270102-0001
 └── HIDR 270102-0002       contents = { 3F: 3, HIDR: 2 }
```

- The BOX is manufactured like any product (RFC-0032 / the production flow): it
  gets a **unique QR sticker** and a **factory code**. The QR encodes the box's
  identity; scanning it in the field returns the box and, from the box, its
  members.
- Each **member** is still a full, independent device with its own code, name,
  `slaveId`/`centralId`, and telemetry. Membership is a pointer from the member to
  the box — a device belongs to **at most one** box.
- **Contents are heterogeneous and counted:** a box may hold any mix of member
  types, summarized by a group-by over the members.
- Moving a device between boxes, or removing it, is a single field update on the
  member. Deleting a box **orphans** (does not delete) its members.

For an operator: label the box once, scan it anywhere, see "BOX 270102-0001 —
3× 3F, 2× HIDR" and drill into each member.

## Reference-level explanation

### Identity, code, and name

- **Product type byte.** BOX takes a new type byte `B4 = 18` in the numbering
  registry (`DEVICE-NAME-SPEC.md §3a`); `BOX_GROUP = 19` is reserved for a higher
  tier (see Future possibilities). These bytes must be **ratified** before use.
- **Code.** The v2 date-stamped code applies unchanged: `B1.B2.B3.18` (e.g.
  `17.2.1.18`). The BOX's daily sequential is independent of its members'.
- **Name.** The v2 name applies: `BOX 270102-0001` (prefix `BOX`, a space, then
  `YYMMDD-NNNN`). The `BOX` prefix is keyword-detectable the same way the existing
  `attributes-sync.js` `handleDeviceType()` detects `3F`/`HIDR`/etc.
- The BOX's canonical code lives in `devices.serialNumber`; its name in
  `devices.name`; `deviceProfile = 'BOX'`.

### Data model

A BOX is an ordinary `devices` row plus **one new column**:

```ts
// devices table
deviceProfile = 'BOX'                                  // marks the container (no migration; free varchar)
boxId: uuid('box_id').references(() => devices.id)     // NEW column, nullable, self-referential
```

```sql
ALTER TABLE devices ADD COLUMN box_id uuid REFERENCES devices(id) ON DELETE SET NULL;
CREATE INDEX devices_box_id_idx ON devices (tenant_id, box_id);
```

Semantics:

- `box_id` on a **member** points at a `deviceProfile = 'BOX'` device.
- `box_id` on a **BOX** is `NULL` (unless nested under a `BOX_GROUP`; Future).
- `ON DELETE SET NULL`: deleting a BOX detaches its members, never deletes them.
- Invariants enforced in the **service layer** (a SQL `CHECK` cannot read the
  referenced row's profile):
  - `box_id` must reference a `BOX` (or `BOX_GROUP`) in the **same tenant**;
  - a device may not reference itself;
  - a `BOX` may not be a member of another `BOX` (only of a `BOX_GROUP`).

### Queries

```sql
-- members of a box
SELECT * FROM devices WHERE tenant_id = :t AND box_id = :box;

-- contents summary  -> { '3F': 3, 'HIDR': 2 }
SELECT device_profile, count(*)
FROM devices WHERE tenant_id = :t AND box_id = :box
GROUP BY device_profile;
```

### API

Fits the existing `/devices` surface:

- `POST /devices` with `deviceProfile: 'BOX'` → create an enclosure.
- `GET /devices?boxId={id}` → members (new filter alongside `centralId`/`slaveId`).
- `GET /devices/{id}/contents` → `{ "3F": 3, "HIDR": 2, "total": 5 }`.
- `PATCH /devices/{id}` `{ "boxId": "…" | null }` → assign / move / detach a member,
  validated against the invariants above.

### QR code

The label on the physical enclosure encodes the BOX identity so a scan resolves
the box and (via `box_id`) its members:

- **Payload (recommended):** a marked code string — `MYIO:BOX:17.2.1.18`
  (`scheme:type:code`) so a scanner can dispatch by scheme/version. A bare
  `17.2.1.18` also works (the `18` byte already means BOX).
- On scan the field app resolves `serialNumber = 17.2.1.18` → the BOX device →
  `GET /devices?boxId={box.id}` for contents.
- The printed label SHOULD also carry the human name (`BOX 270102-0001`) and a
  contents summary (`3× 3F · 2× HIDR`).
- Generation uses the same pipeline as the per-device sticker; any QR library over
  the payload string suffices.

## Drawbacks

- **A device that contains devices** is a slight departure from the "device = leaf"
  model; `box_id` is a self-referential FK that tooling must understand.
- **Service-layer invariants.** Profile/tenant/cycle checks cannot be expressed as
  SQL `CHECK`s, so they live in code and must be tested (a raw `UPDATE` could
  violate them).
- **Two identity spaces to keep aligned:** the BOX code/QR and the members'
  codes/QRs. Restocking a box changes contents but not the box identity — intended,
  but requires the UI to make the distinction clear.
- **A new product type byte** (`18`) permanently consumes a slot in the registry
  and must be ratified before anything mints BOX codes.

## Rationale and alternatives

- **BOX as a device vs. an asset.** GCDR assets already model a hierarchy
  (`SITE→…→EQUIPMENT`) and devices carry `assetId`; a BOX *could* be an EQUIPMENT
  asset. It is modeled as a **device** because it is a manufactured **product**
  with its own code / QR / factory flow, and because the requirement is explicitly
  "a device with a profile". The asset hierarchy still applies: a BOX device has an
  `assetId` for where it is installed.
- **`box_id` FK vs. join table.** Physical containment is `1 box : N devices` and a
  device is in exactly one box, so the FK is the cheapest correct model. A join
  table (`device_box_members(box_id, device_id, slot)`) is only justified if a
  **slot/position** inside the box matters or a device can belong to several
  *logical* groupings — deferred until there is a need.
- **`deviceProfile='BOX'` vs. a new `type` enum value.** `deviceProfile` is a free
  varchar, so `BOX` needs **no migration** for the marker; the `type` enum has no
  container value (`OTHER` is used). Adding `type='CONTAINER'` is a small optional
  migration if a first-class enum is preferred.
- **Separate BOX code vs. deriving it from contents.** A first-class, scannable box
  identity that is **independent of its (changing) contents** lets a member be
  replaced without reprinting the box's identity.

## Prior art

- **RFC-0008** — device attributes (`slaveId`, `centralId`), the precedent for
  additive device columns and channel-centric identity.
- **RFC-0032** — QR addressing populated by the field app (`woAddrLow`/`High`,
  `woIdentifier`); the BOX QR reuses the same scan-in-the-field pattern.
- **v2 numbering/name specs** (`docs/specs/rules-devices-code/v2/`) — the code and
  name formats this RFC extends with the `BOX` type.
- The existing `attributes-sync.js` `handleDeviceType()` keyword vocabulary — the
  BOX prefix joins it as a container keyword.

## Unresolved questions

1. **Type bytes** — ratify `BOX = 18` (and `BOX_GROUP = 19` if adopted).
2. **`deviceProfile='BOX'`** marker vs. a first-class `type='CONTAINER'` enum value.
3. **FK vs. join table** — does slot/position inside the box matter?
4. **QR payload** — marked `MYIO:BOX:{code}` vs. bare `{code}`.
5. **Contents rules** — may a box mix domains (energy + water)? Is there a max member
   count?
6. **Uniqueness/telemetry** — the BOX has a `serialNumber` (unique per tenant) but no
   telemetry; confirm downstream consumers tolerate a device that never reports.
7. **API scope** — is the `?boxId` filter + `/contents` endpoint needed in GCDR, or is
   BOX membership only consumed by the field app?

## Future possibilities

- **BOX_GROUP** (`type byte 19`, prefix `BOXGRP`): a container of boxes (a pallet or
  logical set). `box_id` becomes a generic parent pointer; depth is bounded by a
  service rule (`member → BOX → BOX_GROUP`, max two levels) to prevent cycles.
- **Box templates** — a named recipe ("standard energy box = 3× 3F + 1× entry")
  that pre-populates contents on creation.
- **Contents validation** against a template at QA time (manufacturing step 6).
- **Box-level rules/incidents** — e.g. a NO_CONSUMPTION incident rolled up to the box
  when all members go silent.
