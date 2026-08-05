import { z } from 'zod';

/**
 * RFC-0005 — Gateway (Central) Hardware Replacement.
 *
 * Body of POST /centrals/:oldUuid/replace. The new hardware identity comes in;
 * everything logical (customer, asset, devices, serial by default) is preserved
 * server-side in ONE transaction. `replacementId` is the idempotency key: a
 * repeat call with the same id (and same old→new pair) returns the SAME result
 * without redoing any work.
 */
export const ReplaceCentralSchema = z
  .object({
    /** New hardware UUID — becomes the new centrals.id (PK). */
    newUuid: z.string().uuid(),
    /** New Yggdrasil mesh IPv6 of the replacement board. */
    newIpv6Yggdrasil: z.string().ip({ version: 'v6' }).max(64),
    /**
     * Keep the logical Central ID (dotted serialNumber) — the default. The
     * serial is the field-visible identity (printed labels, frequency
     * inheritance); reissuing is the rare exception behind this toggle.
     */
    keepSerialNumber: z.boolean().default(true),
    /** Required iff keepSerialNumber=false; must be null/absent otherwise. */
    newSerialNumber: z.string().min(1).max(100).nullable().optional(),
    /** Durable idempotency key for the whole multi-system replacement. */
    replacementId: z.string().uuid(),
  })
  .superRefine((val, ctx) => {
    if (!val.keepSerialNumber && !val.newSerialNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newSerialNumber'],
        message: 'newSerialNumber is required when keepSerialNumber is false',
      });
    }
    if (val.keepSerialNumber && val.newSerialNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newSerialNumber'],
        message: 'newSerialNumber must be null when keepSerialNumber is true',
      });
    }
  });

export type ReplaceCentralDTO = z.infer<typeof ReplaceCentralSchema>;

/** Compact central snapshot used in the replace response + ledger record. */
export interface ReplacedCentralSummary {
  id: string;
  serialNumber: string;
  name: string;
  displayName: string;
  status: string;
  customerId: string;
  assetId: string;
  frequency: number;
  ipv6Yggdrasil: string | null;
}

/** Response of POST /centrals/:oldUuid/replace (RFC-0005 §1). */
export interface ReplaceCentralResult {
  replacementId: string;
  oldCentral: ReplacedCentralSummary;
  newCentral: ReplacedCentralSummary;
  devicesRepointed: number;
}
