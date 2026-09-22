import { CHANNEL_NAME, EPSILON, RUN_REQUEST_KEY, SNAPSHOT_KEY } from './config.ts';
import { isValidCircuit } from './quantum.ts';
import type { PublishedSnapshot } from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidSnapshot(value: unknown): value is PublishedSnapshot {
  if (!isRecord(value) || value.version !== 1 ||
      !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return false;
  if ('welcome' in value) return value.welcome === true;
  if (!isValidCircuit(value.circuit)) return false;
  if (!['runId', 'puzzleId', 'title', 'goal'].every(key => typeof value[key] === 'string')) return false;
  if (typeof value.example !== 'boolean' || ![0, 1].includes(value.variant as number)) return false;
  if (!Number.isInteger(value.step) || (value.step as number) < 0 ||
      (value.step as number) > value.circuit.operations.length) return false;
  if (!['playing', 'paused', 'complete'].includes(value.status as string)) return false;
  if (value.status === 'complete' && value.step !== value.circuit.operations.length) return false;
  if (!Array.isArray(value.state) || value.state.length !== 2 ** value.circuit.initial.length) return false;
  let norm = 0;
  for (const amplitude of value.state) {
    if (!isRecord(amplitude) || typeof amplitude.re !== 'number' || typeof amplitude.im !== 'number' ||
        !Number.isFinite(amplitude.re) || !Number.isFinite(amplitude.im)) return false;
    norm += amplitude.re ** 2 + amplitude.im ** 2;
  }
  if (Math.abs(norm - 1) > EPSILON) return false;
  return value.feedback === null || (isRecord(value.feedback) &&
    ['success', 'info', 'retry'].includes(value.feedback.tone as string) &&
    typeof value.feedback.text === 'string');
}

function parseSnapshot(text: string | null): PublishedSnapshot | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isValidSnapshot(value) ? value : null;
  } catch { return null; }
}

export function readSnapshot(): PublishedSnapshot | null {
  try { return parseSnapshot(localStorage.getItem(SNAPSHOT_KEY)); }
  catch { return null; }
}

export function nextRevision(previous = 0): number {
  return Math.max(Date.now(), previous + 1);
}

export function createSync(
  onSnapshot: (snapshot: PublishedSnapshot) => void,
  onRequest?: () => void,
  onRun?: () => void,
): { publish(snapshot: PublishedSnapshot): void; request(): void; run(): void; close(): void } {
  let channel: BroadcastChannel | null = null;
  let latestReceived = -1;
  const handledRuns = new Set<string>();
  try { channel = new BroadcastChannel(CHANNEL_NAME); } catch { /* Storage events still work. */ }

  const receive = (value: unknown) => {
    if (!isValidSnapshot(value) || value.revision <= latestReceived) return;
    latestReceived = value.revision;
    onSnapshot(value);
  };
  const receiveRun = (id: unknown) => {
    if (!onRun || typeof id !== 'string' || handledRuns.has(id)) return;
    // Both transports may deliver the same click, including for an empty circuit.
    handledRuns.add(id);
    if (handledRuns.size > 32) handledRuns.delete(handledRuns.values().next().value!);
    onRun();
  };
  if (channel) channel.onmessage = (event: MessageEvent<unknown>) => {
    if (!isRecord(event.data)) return;
    if (event.data.type === 'request') onRequest?.();
    else if (event.data.type === 'run') receiveRun(event.data.id);
    else if (event.data.type === 'snapshot') receive(event.data.snapshot);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === SNAPSHOT_KEY) receive(parseSnapshot(event.newValue));
    else if (event.key === RUN_REQUEST_KEY) receiveRun(event.newValue);
  };
  window.addEventListener('storage', onStorage);

  return {
    publish(snapshot) {
      // Only revealed frames are published. Draft edits never reach the projector.
      try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot)); }
      catch { /* Private browsing or full storage should not interrupt a live run. */ }
      channel?.postMessage({ type: 'snapshot', snapshot });
    },
    request() { channel?.postMessage({ type: 'request' }); },
    run() {
      const id = crypto.randomUUID();
      // Commands are delivered live only; a stored click is never replayed on startup.
      try { localStorage.setItem(RUN_REQUEST_KEY, id); } catch { /* The channel can still deliver. */ }
      channel?.postMessage({ type: 'run', id });
    },
    close() {
      window.removeEventListener('storage', onStorage);
      channel?.close();
    },
  };
}
