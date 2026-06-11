-- Migration 0036: recoverable customer API keys
--
-- Keys must be retrievable after creation: operators copy them into
-- ThingsBoard customer SERVER_SCOPE attributes, often long after the key
-- was minted. Stores the plaintext alongside the SHA-256 hash (the hash
-- remains the lookup/validation path), following the same precedent as the
-- integrations MQTT passwords: retrieval only via a dedicated, audit-logged
-- reveal endpoint (API_KEY_REVEALED), never in list/detail payloads.
--
-- Keys created before this migration have no recorded plaintext (NULL) and
-- stay unrecoverable — recreate them to make them revealable.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction and
-- rejects explicit transaction-control statements.

ALTER TABLE customer_api_keys ADD COLUMN IF NOT EXISTS key_plain text;
