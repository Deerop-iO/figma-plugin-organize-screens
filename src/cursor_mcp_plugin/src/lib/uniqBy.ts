/** Deduplicate an array by a key derived from each item. */
export function uniqBy<T>(
  arr: T[],
  predicate: ((item: T) => unknown) | keyof T
): T[] {
  const cb =
    typeof predicate === "function"
      ? predicate
      : (o: T) => (o as Record<string, unknown>)[predicate as string];
  return [
    ...arr
      .reduce((map, item) => {
        const key = item === null || item === undefined ? item : cb(item);
        if (!map.has(key)) map.set(key, item);
        return map;
      }, new Map<unknown, T>())
      .values(),
  ];
}
