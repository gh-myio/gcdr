# Device Product-Code Numbering — Reverse-Engineered Spec

> **What this is.** A reverse-engineering of MYIO's compact 4-byte device
> identity `A.B.C.D`, reconstructed from the internal sources in this folder:
> - `MYIO · Padrão de numeração de dispositivos.pdf` (the spec, v1.0 · 2026)
> - `myio-generate-product-code.html` (the reference generator — **authoritative
>   algorithm**, its `<script>` is the ground truth)
> - `fluxo_fabricacao_myio.pdf` (manufacturing flow — where the code is assigned)
>
> **Goal:** catalog the scheme so GCDR can generate, validate and map it.
> **Status:** reverse-engineered draft · algorithm verified against the HTML.

---

## 1. Overview

Every device gets a compact **4-byte** identity in the dotted form **`A.B.C.D`**:

```
A . B . C . D
└───┬───┘   └── product type (category discriminator)
    └────────── base-253 sequential counter, offset 1 (the unique serial within a type)
```

- **`A.B.C`** — the three high bytes form a **base-253 counter with offset 1**
  (an odometer): they encode a sequential index `N` (1-based) that is the
  device's unique serial *within its product type*.
- **`D`** — the fourth byte is the **product type** (category), not part of the
  counter. It namespaces the counter: each type has its own full `A.B.C` space.

Example: `1.1.1.12` = the **first** `switch` device; `2.1.1.12` = the 64,010th.

---

## 2. Formal rules (from the spec)

| # | Rule | Detail |
|---|---|---|
| **R1** | **Byte range** | `A`, `B`, `C` ∈ **1..253**. Zero is not used; **254 and 255 are reserved** for future use. |
| **R2** | **Carry propagation** | When `C` passes 253 it wraps to 1 and `B` increments; same between `B` and `A`. A base-253 odometer. |
| **R3** | **Type discriminator** | `D` identifies the category: **`12` = switch (hidrômetro/water meter)**, **`14` = remote**, **`15` = 3f (three-phase meter)**. |
| **R4** | **Capacity per type** | Each product type holds **253³ = 16,194,277** unique devices before the numbering is exhausted. |

**Product-type registry (as of v1.0):**

| `D` | Type | Notes |
|---|---|---|
| `12` | `switch` | labelled "hidrômetro" (water meter) in the spec |
| `14` | `remote` | |
| `15` | `3f` | three-phase meter |

> `13` is **not assigned** — the known types are 12/14/15. `D` is a separate
> namespace from the counter; treat it as a small registry, not a range.

---

## 3. Constants

```js
const STEP_B   = 253;          // B place value
const STEP_A   = 253 * 253;    // 64,009  — A place value
const CAPACITY = 253 ** 3;     // 16,194,277 — max index per type (MAX_INDEX)
```

- Index `N` is **1-based** and runs `1 .. 16,194,277` per type.
- Internally the algorithm uses the 0-based `i = N - 1`.

---

## 4. Algorithm (authoritative — from the HTML generator)

```js
// Encode: sequential index N (1-based) -> A.B.C
function indexToABC(n) {
  const i = n - 1;
  return {
    a: Math.floor(i / STEP_A) + 1,          // Math.floor(i / 64009) + 1
    b: (Math.floor(i / STEP_B) % 253) + 1,  // (Math.floor(i / 253) % 253) + 1
    c: (i % 253) + 1,
  };
}

// Decode: A.B.C -> sequential index N
function abcToIndex(a, b, c) {
  return (a - 1) * STEP_A + (b - 1) * STEP_B + c;
}

// Canonical device id string
function deviceId(n, productType) {
  const { a, b, c } = indexToABC(n);
  return `${a}.${b}.${c}.${productType}`;
}
```

The two conversions are exact inverses for `N ∈ [1, 16194277]` and
`A,B,C ∈ [1, 253]`.

---

## 5. Worked examples

| Index `N` | `A.B.C` | Device id (type 12) | What happens |
|---|---|---|---|
| 1 | `1.1.1` | `1.1.1.12` | first device |
| 253 | `1.1.253` | `1.1.253.12` | last before the first C→B carry |
| 254 | `1.2.1` | `1.2.1.12` | C wrapped, B incremented (R2) |
| 64,009 | `1.253.253` | `1.253.253.12` | last before the first B→A carry |
| 64,010 | `2.1.1` | `2.1.1.12` | B wrapped, A incremented (R2) |
| 16,194,277 | `253.253.253` | `253.253.253.12` | last possible device of the type (R4) |

Same `N` under a different type just swaps `D`: `deviceId(1, 14)` → `1.1.1.14`.

---

## 6. Validation rules (for a generator/validator)

A string is a **valid device product code** iff:

1. It matches `^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$` (four dotted decimal bytes).
2. `A`, `B`, `C` are each in **1..253** (reject `0`, `254`, `255`).
3. `D` is a **known product type** (currently `12`, `14`, `15`) — or, if you
   accept future types, any byte, but flag unknown values.
4. Round-trip: `indexToABC(abcToIndex(a,b,c))` returns the same `a,b,c`.

Allocation of the next id per type = `deviceId(nextFreeIndex[type], type)` where
`nextFreeIndex[type]` is a per-type monotonic counter (1-based, capped at
16,194,277).

---

## 7. Where the code is assigned (manufacturing flow)

From `fluxo_fabricacao_myio.pdf` — the identity is burned in during production:

| Step | Stage | Relevance to the code |
|---|---|---|
| 1–2 | Intake + manual assembly | — |
| 3 | **Firmware flash** | base behavior written to the board |
| 4 | **Unique QR sticker** | a software-generated **unique factory ID**, printed and applied — the physical identity the field app later scans |
| 5 | **Factory code written over radio** | the code is transmitted **wirelessly** (USB + radio module, OTA — no physical contact) into the device |
| 6 | QA + certification | |
| 7 | Batch distribution | |

So the `A.B.C.D` code is the **factory code** (step 5), and the **QR sticker**
(step 4) carries the unique ID that is scanned in the field.

---

## 8. How it maps to GCDR (needs confirmation)

Cross-referencing [DEVICE-FIELDS-CATALOG.md](../DEVICE-FIELDS-CATALOG.md). These
are **inferences to verify**, not confirmed contracts:

- The **QR sticker** (step 4) is what the field app decodes on
  `POST /api/v1/wo/install` (**RFC-0032**), populating `woAddrLow` / `woAddrHigh`
  / `woIdentifier`. Whether the QR encodes the full `A.B.C.D`, or `A.B.C` split
  across the two `smallint` addr bytes plus `D` as type, **must be confirmed**
  against the QR payload format and the install handler.
- The device's GCDR **`serialNumber`** (unique per tenant) is the natural home
  for the canonical `A.B.C.D` string — but this is not yet asserted in code.
- The **product type `D`** likely corresponds to GCDR `deviceType` /
  `deviceProfile` (e.g. `switch`/`3f`), but the mapping table (12/14/15 →
  GCDR enum/profile) is not documented.

> **Open questions for cataloging**
> 1. Exact QR payload byte layout — does `woAddrLow`/`woAddrHigh` carry the
>    base-253 counter, and how is `D` conveyed?
> 2. Canonical home in GCDR: is `A.B.C.D` stored in `serialNumber`, `code`, or
>    reconstructed from the WO addr fields?
> 3. `D` → GCDR `deviceType`/`deviceProfile` mapping (12=switch, 14=remote,
>    15=3f, +future).
> 4. Who owns `nextFreeIndex[type]` allocation (factory software today; does GCDR
>    need to know/validate it)?
> 5. Reserved `254`/`255` and unassigned `13` — enforced anywhere in GCDR?

---

## 9. Notes & caveats

- **This is v1.0** of an internal spec; the type registry (12/14/15) will grow —
  keep the mapping table above authoritative and additive.
- The HTML generator is a **visualizer/reference**, not the production allocator;
  the real per-type counter lives in factory tooling.
- Base-253 (not 256) is deliberate: it keeps each byte in `1..253` and reserves
  `0` (unused) and `254`/`255` (future), so the dotted form never collides with
  those sentinels.

---

_Sources: `MYIO · Padrão de numeração de dispositivos.pdf` (v1.0 · 2026),
`myio-generate-product-code.html`, `fluxo_fabricacao_myio.pdf` — this folder.
Reverse-engineered 2026-08-17._
