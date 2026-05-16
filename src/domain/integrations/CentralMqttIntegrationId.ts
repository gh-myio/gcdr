// RFC-0035 — Plural MQTT Integrations on Centrals.
// Closed enum of supported MQTT destinations a single central can publish to.
// One central -> N entries in centrals.config.mqttIntegrations[], one per id.
// Adding a new destination requires a code change here + a Zod schema entry.

export const CENTRAL_MQTT_INTEGRATION_IDS = [
  'gcdr',         // future: telemetry/control via GCDR-owned broker (not impl in v1)
  'alarms',       // future: alarm dispatch via alarms-orchestrator broker (not impl in v1)
  'thingsboard',  // mirror to ThingsBoard MQTT
  'ingestion',    // primary telemetry -> data-ingestion service
] as const;

export type CentralMqttIntegrationId = (typeof CENTRAL_MQTT_INTEGRATION_IDS)[number];

export function isCentralMqttIntegrationId(value: unknown): value is CentralMqttIntegrationId {
  return typeof value === 'string'
    && (CENTRAL_MQTT_INTEGRATION_IDS as readonly string[]).includes(value);
}
