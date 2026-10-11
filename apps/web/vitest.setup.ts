import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// @testing-library/react's auto-cleanup relies on detecting a global
// `afterEach` (as Jest provides); since this project imports test hooks
// explicitly from 'vitest' rather than enabling `test.globals`, register
// cleanup here so each test starts with a fresh DOM.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement crypto.randomUUID in all versions; useRoom.ts
// calls it when sending a GAME_ACTION.
if (!globalThis.crypto?.randomUUID) {
  // @ts-expect-error - test-only polyfill
  globalThis.crypto = { ...globalThis.crypto, randomUUID: () => Math.random().toString(36).slice(2) };
}
