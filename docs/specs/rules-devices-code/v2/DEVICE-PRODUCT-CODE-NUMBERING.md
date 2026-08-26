# Device Product-Code Numbering — v2 (date-stamped)

> **What changed vs v1.** v1 (`../v1/`) encoded a **global base-253 counter**
> `A.B.C` + a type byte `D` — the code told you *which* device but nothing about
> *when*. **v2 encodes the manufacturing date** (year/month/day) plus a daily
> sequential and the product type. Reading a v2 code tells you when the unit was
> made and its number that day.
>
> **Status:** authored from the 2026-08-17 spec update (voice note + layout).
> Breaking change from v1 — a different meaning for the same 4-byte dotted form.
> The v1 sources are archived under `../v1/`.

---

## 1. Format

Still **4 bytes**, dotted decimal `B1.B2.B3.B4`, but each byte is now a packed
bit-field:

```
Byte 1   Byte 2   Byte 3   Byte 4
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│YYYYMMMM│SSSDDDDD│NNNNNNNN│TTTTTTTT│
└──────┘ └──────┘ └──────┘ └──────┘
   │        │        │        └── product type (12=switch, 14=remote, 15=3f)
   │        │        └── daily sequential, 1..254
   │        └── SSS = extra sequential 0..7 (high 3 bits) · DDDDD = day-of-month 1..31 (low 5 bits)
   └── YYYY = year offset from 2026, 0..15 (high nibble) · MMMM = month 1..12 (low nibble)
```

| Byte | Bits | Field | Range | Meaning |
|---|---|---|---|---|
| **1** | high 4 | `year` | 0..15 | **year − 2026** (0 = 2026 … 15 = 2041) |
| **1** | low 4 | `month` | 1..12 | calendar month |
| **2** | high 3 | `seq3` | 0..7 | secondary/block sequential (extends the daily count) |
| **2** | low 5 | `day` | 1..31 | day of month |
| **3** | all 8 | `seq` | 1..254 | daily sequential (0 and 255 reserved) |
| **4** | all 8 | `type` | 12/14/15 | product type |

> **Lifespan:** the 4-bit year offset covers **2026 → 2041** (16 years). After
> 2041 the scheme must be revised (v3).

---

## 2. Bit math

```
Byte 1 = (year - 2026) << 4  |  month
Byte 2 = seq3 << 5           |  day
Byte 3 = seq
Byte 4 = type
```

### Encode

```js
const EPOCH_YEAR = 2026;

function encodeV2({ year, month, day, seq3 = 0, seq, type }) {
  const b1 = ((year - EPOCH_YEAR) << 4) | month;  // year 0..15, month 1..12
  const b2 = (seq3 << 5) | day;                    // seq3 0..7,  day 1..31
  const b3 = seq;                                  // 1..254
  const b4 = type;                                 // 12 | 14 | 15
  return `${b1}.${b2}.${b3}.${b4}`;
}
```

### Decode

```js
function decodeV2(code) {
  const [b1, b2, b3, b4] = code.split('.').map(Number);
  return {
    year:  EPOCH_YEAR + (b1 >> 4),   // b1 >> 4
    month: b1 & 0x0F,                // low nibble
    seq3:  b2 >> 5,                  // high 3 bits
    day:   b2 & 0x1F,                // low 5 bits (0b11111 = 31)
    seq:   b3,
    type:  b4,
  };
}
```

---

## 3. Worked example — `17.2.25.15`

| Byte | Value | Bits | Decodes to |
|---|---|---|---|
| B1 | `17` | `0001 0001` | year `0001`=1 → **2027**, month `0001` → **January** |
| B2 | `2` | `000 00010` | seq3 `000`=0, day `00010` → **day 2** |
| B3 | `25` | `00011001` | **25th product** of the day |
| B4 | `15` | `00001111` | **3f** (three-phase meter) |

➡️ **`17.2.25.15`** = a **3f** made on **2027-01-02**, unit **#25** that day.
(Matches the spec example: "ano 2027 (2026+1), dia 2, vigésimo quinto produto, 3f".)

More (note B1 is the **packed** byte `(yearOffset<<4)|month`, not "year.month"):
- `1.1.1.12` = B1 `1`=`0000 0001` → year 0 = 2026, month 1 → **2026-01-01**, unit #1, `switch`/HIDR.
- `16.x.x.x` = B1 `16`=`0001 0000` → year 1 = 2027, month `0000` = **0 (invalid month)** → shows month must be ≥ 1.
- `252.1.1.15` = B1 `252`=`1111 1100` → year 15 = **2041**, month 12 (Dec); B2 `1` → day 1, seq3 0; unit #1; 3f — the last supported year.

---

## 4. Validation

A string is a valid **v2** product code iff, after `split('.')` into `[b1,b2,b3,b4]`:

| Check | Rule |
|---|---|
| shape | exactly 4 dotted decimal bytes, each `0..255` |
| year | `b1 >> 4` ∈ `0..15` (⇒ 2026..2041) — always true for a byte |
| month | `b1 & 0x0F` ∈ **1..12** (reject 0 and 13..15) |
| day | `b2 & 0x1F` ∈ **1..31** (reject 0) |
| seq3 | `b2 >> 5` ∈ `0..7` — always true |
| seq | `b3` ∈ **1..254** (reject 0 and 255 — reserved) |
| type | `b4` ∈ **{12, 14, 15}** (or flag unknown for future types) |

Optional calendar check: reject impossible dates (e.g. day 31 in a 30-day month,
Feb 30). The bit-field allows day up to 31 regardless of month.

---

## 5. Capacity & semantics

- **Per (type, day):** `seq3` (8) × `seq` (254) = **2,032 units/day/type** if the
  two sequentials combine (block × unit). If `seq3` is unused (always 0), it is
  254 units/day/type, with 7 spare blocks in reserve.
- The code is **date-addressed**, not a global odometer — two units made on
  different days can share the same `seq`. Uniqueness = the full 4-byte tuple
  `(year, month, day, seq3, seq, type)`.

> **To confirm:** the exact role of `seq3` (byte 2 high 3 bits). Most natural
> reading = a high-order block extending the daily sequential to 2,032; the voice
> note only says "a sequential 0..7". Documented as such; confirm with the
> factory allocator before relying on the 2,032/day figure.

---

## 6. v1 → v2 differences

| | v1 (`../v1/`) | v2 (this) |
|---|---|---|
| Meaning of `A.B.C` / B1-B2 | global base-253 counter (offset 1) | **manufacturing date** (year/month/day) + `seq3` |
| Byte 3 | part of the counter | **daily sequential** 1..254 |
| Byte 4 | product type | product type (unchanged: 12/14/15) |
| Byte range | A,B,C ∈ 1..253 (254/255 reserved) | packed bit-fields; per-field ranges above |
| Carry | base-253 odometer | none — date-stamped |
| Capacity | 253³ = 16,194,277 per type (lifetime) | 2,032 per day per type |
| Info in the code | just a serial | **serial + build date** |
| Lifespan | unbounded | **2026–2041** (4-bit year) |

---

## 7. Manufacturing (unchanged — see `../v1/fluxo_fabricacao_myio.pdf`)

The 7-step production flow is version-agnostic. The v2 code is still the
**factory code written over radio (step 5)**, and the **QR sticker (step 4)**
carries the unique factory identity scanned in the field. What changed is only
how the 4 bytes are *interpreted*.

---

## 8. GCDR mapping — open questions

Cross-ref [../../DEVICE-FIELDS-CATALOG.md](../../DEVICE-FIELDS-CATALOG.md).
Inferences to verify:

1. **Where does the v2 code live in GCDR?** `serialNumber` (canonical `B1.B2.B3.B4`
   string) is the natural home; confirm and decide whether GCDR parses the date
   out (into `metadata`) or keeps it opaque.
2. **QR payload ↔ `woAddrLow`/`woAddrHigh` (RFC-0032).** Do the two `smallint`
   addr bytes carry B1/B2 (date) and B3 (seq), with `type` = B4? Confirm the QR
   layout and the `POST /wo/install` handler for v2.
3. **`type` (B4) → GCDR `deviceType`/`deviceProfile`** mapping (12=switch,
   14=remote, 15=3f, + future).
4. **Version discrimination.** v1 and v2 share the dotted 4-byte form but mean
   different things. How does a reader know which scheme a given code uses?
   (e.g. a manufacture-date cutover, a version registry, or a marker byte.)
   **This is the critical open question** — without it, `17.2.25.15` is ambiguous
   between "v1 counter" and "v2 date".
5. **Post-2041 plan** (v3) — the 4-bit year runs out.

---

_Authored 2026-08-17 from the v2 spec update. v1 sources archived in `../v1/`._
