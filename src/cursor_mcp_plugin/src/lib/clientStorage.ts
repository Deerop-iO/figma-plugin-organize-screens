// @ts-nocheck
/**
 * Serialised clientStorage writes. See kit rule figma-plugin-storage.mdc.
 * Reads are not chained; only get → mutate → set composites use queueWrite.
 */

let writeChain: Promise<unknown> = Promise.resolve();

export function queueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

export function setClientStorage(key: string, value: unknown): Promise<void> {
  return queueWrite(() => figma.clientStorage.setAsync(key, value));
}
