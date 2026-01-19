import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { EventTypeValue } from '../../shared/events/eventTypes';

const eventBridge = new EventBridgeClient({
  region: process.env.REGION || 'sa-east-1',
});

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'gcdr-events-dev';
const EVENT_SOURCE = 'gcdr.myio';

export interface EventPayload {
  tenantId: string;
  entityType: string;
  entityId: string;
  action: string;
  data?: Record<string, unknown>;
  actor?: {
    userId?: string;
    type: 'user' | 'system' | 'partner';
  };
  correlationId?: string;
}

export class EventService {
  async publish(eventType: EventTypeValue, payload: EventPayload): Promise<void> {
    const event = {
      EventBusName: EVENT_BUS_NAME,
      Source: EVENT_SOURCE,
      DetailType: eventType.code,
      Detail: JSON.stringify({
        ...payload,
        timestamp: new Date().toISOString(),
        eventDescription: eventType.description,
      }),
    };

    try {
      await eventBridge.send(
        new PutEventsCommand({
          Entries: [event],
        })
      );
    } catch (error) {
      // Log but don't fail the operation
      console.error('Failed to publish event:', eventType.code, error);
    }
  }

  async publishBatch(events: Array<{ eventType: EventTypeValue; payload: EventPayload }>): Promise<void> {
    const entries = events.map(({ eventType, payload }) => ({
      EventBusName: EVENT_BUS_NAME,
      Source: EVENT_SOURCE,
      DetailType: eventType.code,
      Detail: JSON.stringify({
        ...payload,
        timestamp: new Date().toISOString(),
        eventDescription: eventType.description,
      }),
    }));

    // EventBridge allows max 10 events per batch
    const batches = [];
    for (let i = 0; i < entries.length; i += 10) {
      batches.push(entries.slice(i, i + 10));
    }

    try {
      await Promise.all(
        batches.map((batch) =>
          eventBridge.send(
            new PutEventsCommand({
              Entries: batch,
            })
          )
        )
      );
    } catch (error) {
      console.error('Failed to publish batch events:', error);
    }
  }
}

export const eventService = new EventService();
