import { AsyncLocalStorage } from "node:async_hooks";
import { mock } from "bun:test";

mock.module("server-only", () => ({}));

// Next picks its request storage once, when its async-local-storage module
// first loads: the real one if globalThis.AsyncLocalStorage is set, else a
// fake that throws. Next's server baseline sets it; in a test run that only
// happens if a server import loads first, so a random order could cache the
// fake for the whole run (#481). Set it before any file loads, as Next does.
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
