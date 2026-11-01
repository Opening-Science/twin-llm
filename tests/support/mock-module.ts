/** A module's exports, as `import()` returns them. */
export type ModuleExports = Readonly<Record<string, unknown>>;

/** The parts of `bun:test` the helper uses, passed in by the test file. */
export type BunTestHooks = Readonly<{
  mock: Readonly<{
    module: (specifier: string, factory: () => ModuleExports) => unknown;
  }>;
  afterAll: (run: () => void) => void;
}>;

/** The module a test file sees: every real export, with some replaced. */
export const withOverrides = (
  real: ModuleExports,
  overrides: ModuleExports,
): ModuleExports => ({ ...real, ...overrides });

/**
 * Returns `mockModuleForFile(specifier, overrides)`, which replaces some
 * exports of a module for the rest of the calling test file, then puts the
 * real module back once that file is done (#359).
 *
 * Bun keeps a `mock.module` replacement for every later file in the same
 * process, so a bare mock leaks into whichever files a randomized run puts
 * after it: a later import finds an export missing (`next/headers` without
 * `headers`) or gets a fake it never asked for. Here the real exports are
 * copied before mocking, kept in the replacement, and registered again in
 * `afterAll`. Call it at the top level of a test file, before the code under
 * test is imported:
 *
 *   const mockModuleForFile = moduleMocker({ mock, afterAll });
 *   await mockModuleForFile("@/infrastructure/auth-actor", { resolveActorId });
 */
export const moduleMocker =
  ({ mock, afterAll }: BunTestHooks) =>
  async (specifier: string, overrides: ModuleExports): Promise<void> => {
    const real: ModuleExports = { ...((await import(specifier)) as ModuleExports) };
    mock.module(specifier, () => withOverrides(real, overrides));
    afterAll(() => {
      mock.module(specifier, () => real);
    });
  };
