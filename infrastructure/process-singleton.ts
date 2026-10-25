/**
 * Keeps one instance of an expensive object per server process.
 *
 * The holder is `globalThis` by default because Next.js re-evaluates modules
 * on hot reload in development, which would lose a module-level variable.
 * Production uses the same holder: there is no environment switch, so a
 * production server can never build a second instance by accident.
 */
export type SingletonHolder = Record<string, unknown>;

export const processSingleton = <T>(
  key: string,
  build: () => T,
  holder: SingletonHolder = globalThis as unknown as SingletonHolder,
): (() => T) => {
  return () => {
    const existing = holder[key];
    if (existing !== undefined) return existing as T;
    const created = build();
    // The holder is the cache, so storing into it is the point of this function.
    Object.assign(holder, { [key]: created });
    return created;
  };
};
