import { z } from 'zod';

// POST /central-agent/enroll — zero-touch provisioning. The central presents its
// own uuid (its central id) plus the one-time enroll token an operator issued.
// NO centralAuthMiddleware: the central has no agent_secret yet — the enroll
// token IS the credential. On success gcdr returns the freshly-minted
// agent_secret, which the central then uses to sign its poll-loop JWT.
//
// The token is generated as crypto.randomBytes(...) hex/base64url, so a 32-byte
// token is 43+ chars (base64url) / 64 chars (hex); min(20) is a safe floor.
export const EnrollCentralSchema = z.object({
  uuid: z.string().uuid(),
  enrollToken: z.string().min(20),
});
export type EnrollCentralDTO = z.infer<typeof EnrollCentralSchema>;
