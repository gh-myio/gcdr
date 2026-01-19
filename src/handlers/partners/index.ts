export { handler as registerHandler } from './register';
export { handler as getHandler } from './get';
export { handler as listHandler } from './list';
export { handler as updateHandler } from './update';
export { handler as approveHandler } from './approve';
export { handler as rejectHandler } from './reject';
export { handler as suspendHandler } from './suspend';
export { handler as activateHandler } from './activate';

// API Key handlers
export { handler as createApiKeyHandler } from './createApiKey';
export { handler as revokeApiKeyHandler } from './revokeApiKey';
export { handler as rotateApiKeyHandler } from './rotateApiKey';
export { handler as listApiKeysHandler } from './listApiKeys';

// OAuth handlers
export { handler as createOAuthClientHandler } from './createOAuthClient';
export { handler as listOAuthClientsHandler } from './listOAuthClients';
export { handler as revokeOAuthClientHandler } from './revokeOAuthClient';
export { handler as tokenHandler } from './token';

// Webhook handlers
export { handler as createWebhookHandler } from './createWebhook';
export { handler as listWebhooksHandler } from './listWebhooks';
export { handler as updateWebhookHandler } from './updateWebhook';
export { handler as deleteWebhookHandler } from './deleteWebhook';
