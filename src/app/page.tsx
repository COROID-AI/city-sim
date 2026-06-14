'use client';

/**
 * Root page for the Next.js 15 / React 19 app.
 * Wires the EventBus, TimeControls, and CityLog together on the client.
 */

import * as React from 'react';
import { CityLog } from '@/ui/CityLog';
import { TimeControls, type TimeController } from '@/ui/TimeControls';
import { EventBus } from '@/systems/EventBus';
import type { SimEvent } from '@/systems/EventBus';

class ClientTimeController implements TimeController {
  private paused = false;
  private speed: 0 | 1 | 2 | 4 = 1;

  isPaused(): boolean {
    return this.paused;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  getSpeed(): 0 | 1 | 2 | 4 {
    return this.speed;
  }

  setSpeed(speed: 0 | 1 | 2 | 4): void {
    this.speed = speed;
  }
}

const LOGGED_EVENTS = [
  'money.changed',
  'citizen.hired',
  'shift.started',
  'shift.ended',
  'building.constructed',
] as const;

export default function Page(): React.JSX.Element {
  const busRef = React.useRef<EventBus | null>(null);
  const controllerRef = React.useRef<TimeController | null>(null);
  const [events, setEvents] = React.useState<ReadonlyArray<SimEvent>>([]);

  if (busRef.current === null) {
    busRef.current = new EventBus();
    controllerRef.current = new ClientTimeController();
  }

  React.useEffect(() => {
    const bus = busRef.current;
    if (!bus) {
      return;
    }
    const offs: Array<() => void> = [];
    for (const type of LOGGED_EVENTS) {
      offs.push(
        bus.on(type, (e) => {
          setEvents((prev) => [...prev, e]);
        }),
      );
    }
    return () => {
      for (const off of offs) {
        off();
      }
    };
  }, []);

  return (
    <main className="app-shell">
      <header className="app-shell__header">
        <h1>Dark Factory City</h1>
        {controllerRef.current && <TimeControls controller={controllerRef.current} />}
      </header>
      <CityLog events={events} />
    </main>
  );
}
