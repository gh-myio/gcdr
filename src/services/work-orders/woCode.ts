// Work-order code generator — OS-<Mercosul plate> (LLLNLNN).
//
// The alphabet excludes the lookalike characters I, O, 1 and 0 so codes stay
// unambiguous when read aloud or hand-copied from a printed OS. Uniqueness
// (per tenant, non-deleted) is enforced by the work_orders_tenant_code_unique
// index; callers must retry on collision.

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // 24 letters, no I/O
const DIGITS = '23456789'; // 8 digits, no 0/1

function pick(alphabet: string): string {
  return alphabet[Math.floor(Math.random() * alphabet.length)];
}

export function generateWorkOrderCode(): string {
  return (
    'OS-' +
    pick(LETTERS) +
    pick(LETTERS) +
    pick(LETTERS) +
    pick(DIGITS) +
    pick(LETTERS) +
    pick(DIGITS) +
    pick(DIGITS)
  );
}
