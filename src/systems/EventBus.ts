/**
 * EventBus - typed pub/sub for the city simulation.
 * Pure TypeScript, framework-agnostic. Keep SimEventMap in sync with
 * consumers; the `// keep in sync with SimEventMap` marker on per-case
 * handlers documents this contract.
 */

export interface SimEvent {
  readonly seq: number;
  readonly at: number;
  readonly type: string;
  readonly payload: unknown;
}

export interface MoneyChangedPayload {
  readonly delta: number;
  readonly treasury: number;
  readonly reason: string;
}

export interface CitizenHiredPayload {
  readonly citizenId: string;
  readonly companyId: string;
  readonly companyType: string;
}

export interface ShiftStartedPayload {
  readonly companyId: string;
  readonly hour: number;
}

export interface ShiftEndedPayload {
  readonly companyId: string;
  readonly hour: number;
}

export interface BuildingConstructedPayload {
  readonly buildingId: string;
  readonly defId: string;
  readonly origin: { readonly x: number; readonly y: number };
}

export interface TickPayload {
  readonly tick: number;
  readonly hour: number;
  readonly day: number;
}

export interface SimEventMap {
  readonly 'money.changed': MoneyChangedPayload;
  readonly 'citizen.hired': CitizenHiredPayload;
  readonly 'shift.started': ShiftStartedPayload;
  readonly 'shift.ended': ShiftEndedPayload;
  readonly 'building.constructed': BuildingConstructedPayload;
  readonly 'tick': TickPayload;
}

export type SimEventType = keyof SimEventMap;
export type SimEventOf<K extends SimEventType> = {
  readonly seq: number;
  readonly at: number;
  readonly type: K;
  readonly payload: SimEventMap[K];
};

type Handler<K extends SimEventType> = (event: SimEventOf<K>) => void;

export class EventBus {
  private readonly listeners: { [K in SimEventType]?: Set<Handler<K>> } = {};
  private sequence = 0;

  on<K extends SimEventType>(type: K, handler: Handler<K>): () => void {
    let bucket = this.listeners[type] as Set<Handler<K>> | undefined;
    if (!bucket) {
      bucket = new Set<Handler<K>>();
      (this.listeners as Record<K, Set<Handler<K>>>)[type] = bucket;
    }
    bucket.add(handler);
    return () => {
      bucket?.delete(handler);
    };
  }

  emit<K extends SimEventType>(type: K, payload: SimEventMap[K]): SimEventOf<K> {
    this.sequence += 1;
    const event: SimEventOf<K> = {
      seq: this.sequence,
      at: Date.now(),
      type,
      payload,
    };
    const bucket = this.listeners[type] as Set<Handler<K>> | undefined;
    if (bucket) {
      for (const handler of Array.from(bucket)) {
        handler(event);
      }
    }
    return event;
  }

  clear(): void {
    for (const key of Object.keys(this.listeners) as SimEventType[]) {
      (this.listeners as Record<SimEventType, Set<Handler<SimEventType>> | undefined>)[key] = undefined;
    }
  }
}
