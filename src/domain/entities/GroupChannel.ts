/**
 * GroupChannel — per-group notification channel target.
 *
 * Stores WHERE to send notifications for a group.
 * Credentials (bot tokens, SMTP passwords) stay in customer_channels.
 *
 * channel  → target format
 * EMAIL    → email address or alias   "ops@company.com"
 * TELEGRAM → Telegram chat_id         "-100123456789"
 * WHATSAPP → phone number             "+5531988880000"
 * WEBHOOK  → URL                      "https://hooks.company.com/gcdr"
 * SLACK    → channel name             "#alertas"
 * SMS      → phone number             "+5531988880000"
 */
export interface GroupChannel {
  id: string;
  tenantId: string;
  groupId: string;
  channel: string;
  active: boolean;
  target: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
