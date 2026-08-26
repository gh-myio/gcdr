# Device Name — Specification (v2)

> **Purpose.** A human-readable device **name** that mirrors the v2 product code
> ([DEVICE-PRODUCT-CODE-NUMBERING.md](./DEVICE-PRODUCT-CODE-NUMBERING.md)): same
> manufacturing date + daily unit, but with a **category prefix** instead of the
> numeric type byte. The name is self-documenting, sortable, and — **for hardware
> prefixes** (`3F`, `HIDR`, `REM`, `TANK`…) — **losslessly convertible** to/from
> the numeric code. For **functional prefixes** (MOTR, COMPRESSOR, ELEV…) the name
> carries the *installed role* only; the hardware byte (usually `3F`) is not
> recoverable from the code alone — the authoritative source of "what a MOTR
> really is" is the device's **`deviceType`/`deviceProfile`**, not the name.
> See §3b.
>
> **Status:** definition draft (2026-08-17). Ties to the v2 date-stamped code.

---

## 1. Canonical form

```
{PREFIX} {YYMMDD}-{NNNN}
```

**The separator after the PREFIX is a SPACE, not a hyphen** — this keeps the name
in the same shape as the existing production names (`3F LOJA 203`,
`MOTR RECALQUE`, `HIDR AREA COMUM`) so the keyword type-detection in
`CENTRAL_PRE_SETUP/attributes-sync.js` (`handleDeviceType`, which uses
`.includes()` and word-boundary checks like `'REL '` / `' AC '`) still works. The
date and unit stay joined by a hyphen.

Example — the code `17.2.25.15` becomes:

```
3F 270102-0025
│     │     └── NNNN = unit of the day, 0001..2032 (zero-padded)
│     └── YYMMDD = build date: YY=27 (2027) · MM=01 (Jan) · DD=02 (day 2)
└── PREFIX = product/type keyword (space after it), e.g. 3F, HIDR, TANK, MOTR…
```

Read as: *"a 3F device, built 2027-01-02, the 25th unit that day."*

- **UPPERCASE**, ASCII. **One space** after the PREFIX, then `YYMMDD-NNNN`. Regex:
  `^[A-Z0-9]{2,12} \d{6}-\d{4}$`
- Fixed widths (`YYMMDD` = 6, `NNNN` = 4) so names **sort chronologically**
  within a prefix by plain string order.

---

## 2. Fields

| Part | Width | Source in the code | Range |
|---|---|---|---|
| `PREFIX` | 2–8 | type byte `B4` (via the registry, §3) | see registry |
| `YY` | 2 | `B1 >> 4` (+2026) → last two digits | `26`..`41` (2026–2041) |
| `MM` | 2 | `B1 & 0x0F` | `01`..`12` |
| `DD` | 2 | `B2 & 0x1F` | `01`..`31` |
| `NNNN` | 4 | `seq3` (`B2 >> 5`) and `seq` (`B3`) combined | `0001`..`2032` |

**Unit of the day (`NNNN`)** merges the two sequentials into one number so the
name shows "the Nth unit of the day":

```
unit = seq3 * 254 + seq          // seq3 ∈ 0..7, seq ∈ 1..254  →  unit ∈ 1..2032
```

---

## 3. Prefix vocabulary

The PREFIX is a **type keyword**, and there are **two levels** to keep distinct:

### 3a. Hardware product type (the code's byte `B4`)

The physical product built in the factory. Only a few values, one per byte:

| `B4` | PREFIX | Product | Status |
|---|---|---|---|
| 12 | `HIDR` | hidrômetro (water meter) | **existing** (was "switch") |
| 14 | `REM` | remote | **existing** |
| 15 | `3F` | three-phase meter | **existing** |
| 16 | `TEMP` | temperature sensor | **proposed** — byte to ratify |
| 17 | `TANK` | tank level | **proposed** — byte to ratify |

`13` is a gap; `B4` is a full byte (0–255) so extend additively. New hardware
prefixes are not real until a byte is ratified.

### 3b. Functional keyword (the *installed role* — from `attributes-sync.js`)

In production the device **name** is keyword-detected into a `deviceType` by
`CENTRAL_PRE_SETUP/attributes-sync.js` → `handleDeviceType()`. This is the
**source of truth for the name prefix** and is broader than the hardware set —
a `3F` meter installed on a compressor is named with the **COMPRESSOR** keyword.

| Keyword(s) in the name | `deviceType` | Domain |
|---|---|---|
| `3F` | `3F_MEDIDOR` (also the **default**) | energy |
| `COMPRESSOR` | `COMPRESSOR` | energy |
| `VENT` | `VENTILADOR` | energy |
| `ESRL` | `ESCADA_ROLANTE` | energy |
| `ELEV` | `ELEVADOR` | energy |
| `MOTR`/`MOTOR`/`RECALQUE` | `MOTOR` | energy |
| `RELOG`/`RELOGIO`/`REL ` | `RELOGIO` | energy |
| `ENTRADA`/`SUBEST`/`SUBESTACAO` | `ENTRADA` | energy |
| `HIDR` | `HIDROMETRO` | water |
| `SCD`/`CX DAGUA`/`CXDAGUA`/`CAIXA DAGUA` | `CAIXA_DAGUA` | water |
| `TANK`/`TANQUE`/`RESERVATORIO` | `TANK` | water |
| `TEMP`/`TERMO`/`TERMOSTATO` | `TERMOSTATO` | — |
| `AC` (word) | `CONTROLE REMOTO` | — |
| `AUTOMATICO` | `SELETOR_AUTO_MANUAL` · `ABRE` → `SOLENOIDE` · `AUTOMACAO`/`GW_AUTO` → `GLOBAL_AUTOMACAO` | — |

> **Why the space after the prefix matters:** `handleDeviceType` matches with
> `.includes()` and some **word-boundary** checks (`'REL '`, `' AC '`,
> `.endsWith(' AC')`). A hyphen would fuse the prefix into the next token and
> could break those matches. `PREFIX␣YYMMDD-NNNN` keeps the keyword a standalone
> token.

**Relationship:** the name prefix = **functional keyword** (3b), which for the
three hardware families coincides with `B4` (3b `3F`/`HIDR` ↔ 3a `15`/`12`) but
for functional roles (COMPRESSOR, ELEVADOR, MOTOR…) is name-level only — the
underlying hardware byte usually defaults to `3F` (15). So the numeric code can
**always** be derived from name+build-info **only when the prefix is a hardware
prefix**; for functional prefixes, `B4` must be carried separately (or defaulted).

> **Consequence for reverse conversion (code → identity):** many functional
> roles (MOTOR, COMPRESSOR, ELEVADOR, VENTILADOR, ENTRADA…) all collapse onto the
> same hardware byte `3F` (15) — see the `handleDeviceType()` default
> (`return '3F_MEDIDOR'`). Given only the code you therefore **cannot** tell a
> MOTR from a COMPRESSOR; both read back as `3F`. To recover the installed role
> you must read the device's **`deviceType`/`deviceProfile`** (the value
> `handleDeviceType()` derived from the *name* and synced to ThingsBoard), never
> the numeric code. This is why the round-trip is lossless **only** for the
> hardware-prefix subset.

---

## 4. Conversion (lossless for hardware prefixes; see §3b for functional ones)

```js
const EPOCH_YEAR = 2026;
const SEQ_MAX = 254;                 // seq per block (1..254)
// PREFIX <-> B4 from the §3 registry:
const BYTE_BY_PREFIX = { HIDR:12, REM:14, '3F':15, TEMP:16, TANK:17 };
const PREFIX_BY_BYTE = Object.fromEntries(Object.entries(BYTE_BY_PREFIX).map(([p,b]) => [b, p]));
const p2 = n => String(n).padStart(2, '0');
const p4 = n => String(n).padStart(4, '0');

// code "B1.B2.B3.B4"  ->  name
function codeToName(code) {
  const [b1, b2, b3, b4] = code.split('.').map(Number);
  const year = EPOCH_YEAR + (b1 >> 4), month = b1 & 0x0F;
  const day = b2 & 0x1F, seq3 = b2 >> 5, seq = b3;
  const unit = seq3 * SEQ_MAX + seq;                 // 1..2032
  const prefix = PREFIX_BY_BYTE[b4] ?? `T${b4}`;     // unknown type -> Tnn fallback
  return `${prefix} ${p2(year % 100)}${p2(month)}${p2(day)}-${p4(unit)}`;  // SPACE after prefix
}

// name  ->  code "B1.B2.B3.B4"
function nameToCode(name) {
  const m = /^([A-Z0-9]{2,12}) (\d{2})(\d{2})(\d{2})-(\d{4})$/.exec(name);  // SPACE after prefix
  if (!m) throw new Error('invalid device name');
  const [, prefix, yy, mm, dd, nnnn] = m;
  const year = 2000 + Number(yy), month = Number(mm), day = Number(dd), unit = Number(nnnn);
  const seq3 = Math.floor((unit - 1) / SEQ_MAX);     // 0..7
  const seq  = ((unit - 1) % SEQ_MAX) + 1;           // 1..254
  const b4 = BYTE_BY_PREFIX[prefix];
  if (b4 === undefined) throw new Error(`unknown prefix ${prefix}`);
  const b1 = ((year - EPOCH_YEAR) << 4) | month, b2 = (seq3 << 5) | day, b3 = seq;
  return `${b1}.${b2}.${b3}.${b4}`;
}
```

`codeToName(nameToCode(x)) === x` for every valid name, and vice-versa.

---

## 5. Validation

A string is a valid **canonical device name** iff:

1. Matches `^[A-Z0-9]{2,12} \d{6}-\d{4}$` (one **space** after the prefix).
2. `PREFIX` is in the registry (§3) — or accept the `T{B4}` fallback for unknown types.
3. `YY` ∈ `26..41` (2026–2041, the scheme's lifespan).
4. `MM` ∈ `01..12`; `DD` ∈ `01..31` (optionally reject impossible calendar dates).
5. `NNNN` ∈ `0001..2032`.
6. Round-trips through `nameToCode` → `codeToName` unchanged.

---

## 6. Worked examples

| Code | Name | Meaning |
|---|---|---|
| `17.2.25.15` | `3F 270102-0025` | 3F, 2027-01-02, unit #25 (B1 `17`=`(1<<4)\|1`) |
| `1.1.1.12` | `HIDR 260101-0001` | hidrômetro, 2026-01-01, unit #1 (B1 `1`=`(0<<4)\|1`) |
| `1.34.10.15` | `3F 260102-0264` | 3F, 2026-01-02, `seq3=1,seq=10` → unit 1·254+10 = 264 (B2 `34`=`(1<<5)\|2`) |
| `252.1.254.14` | `REM 411201-0254` | remote, 2041-12-01, unit #254 — last year (B1 `252`=`(15<<4)\|12`) |

---

## 7. GCDR mapping

Cross-ref [../../DEVICE-FIELDS-CATALOG.md](../../DEVICE-FIELDS-CATALOG.md).

| Concept | GCDR field | Note |
|---|---|---|
| Canonical name `PREFIX YYMMDD-NNNN` | `name` (unique per `tenant+customer`) | technical/canonical identity |
| Friendly label (e.g. `+ Loja 203`) | `displayName` | UI label; may append location — **not** part of the canonical name |
| Numeric code `B1.B2.B3.B4` | `serialNumber` | unique per tenant |
| `PREFIX` | `deviceType` / `deviceProfile` | via the §3 registry |
| Build date (Y/M/D) | derivable from the name/code | optionally cached in `metadata` |

**Uniqueness:** the name is unique per `(type, day, unit)` — the same tuple the
code guarantees. It maps cleanly onto `devices_tenant_customer_name_unique`.

**Friendly names:** keep location/context in `displayName`
(`3F 270102-0025 · Loja 203`), never inside the canonical `name`, so the
name ↔ code invertibility holds.

---

## 8. Open decisions (to ratify)

1. **Type bytes for new prefixes** — `TEMP=16`, `TANK=17` are proposals; ratify
   the actual bytes (and any other categories) in §3.
2. **Year width** — `YY` (2 digits, chosen) vs full `YYYY`. `YY` is unambiguous
   within 2026–2041; full year removes the century assumption at +2 chars.
3. **Unit vs visible block** — `NNNN` merges `seq3+seq` (chosen). If `seq3` is a
   meaningful *production batch*, an alternative is `PREFIX YYMMDD-B{seq3}-{seq}`.
4. **Legacy devices** — devices made before this scheme keep their existing
   names; this format applies from adoption forward.

---

_Authored 2026-08-17. Companion to the v2 code spec in this folder._
