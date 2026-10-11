import type { MafiaConfig, MafiaConfigInput } from './types';

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 20;

type TimerKey =
  | 'roleRevealSeconds'
  | 'nightSeconds'
  | 'dayAnnouncementSeconds'
  | 'discussionSeconds'
  | 'votingSeconds'
  | 'voteResultSeconds';

/** [min, max, default] in seconds. */
export const TIMER_RANGES: Record<TimerKey, readonly [number, number, number]> = {
  roleRevealSeconds: [5, 30, 10],
  nightSeconds: [20, 120, 45],
  dayAnnouncementSeconds: [5, 20, 8],
  discussionSeconds: [30, 300, 90],
  votingSeconds: [20, 120, 45],
  voteResultSeconds: [5, 20, 8],
};

/** Keys a host may set in v1. Anything else in the input is rejected. */
export const HOST_CONFIGURABLE_KEYS: readonly (keyof MafiaConfigInput)[] = [
  'mafiaCount',
  'doctorEnabled',
  'detectiveEnabled',
  'nightSeconds',
  'discussionSeconds',
  'votingSeconds',
];

export class MafiaConfigError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'MafiaConfigError';
  }
}

/** 6–7 → 1, 8–10 → 2, 11–14 → 3, 15–20 → 4. */
export function defaultMafiaCount(playerCount: number): number {
  if (playerCount <= 7) return 1;
  if (playerCount <= 10) return 2;
  if (playerCount <= 14) return 3;
  return 4;
}

export function defaultConfigFor(playerCount: number): MafiaConfig {
  return {
    mafiaCount: defaultMafiaCount(playerCount),
    doctorEnabled: true,
    detectiveEnabled: true,
    roleRevealSeconds: TIMER_RANGES.roleRevealSeconds[2],
    nightSeconds: TIMER_RANGES.nightSeconds[2],
    dayAnnouncementSeconds: TIMER_RANGES.dayAnnouncementSeconds[2],
    discussionSeconds: TIMER_RANGES.discussionSeconds[2],
    votingSeconds: TIMER_RANGES.votingSeconds[2],
    voteResultSeconds: TIMER_RANGES.voteResultSeconds[2],
  };
}

/**
 * Builds the effective config from the host's (partial, untrusted) input and
 * the actual player count, or throws MafiaConfigError. Server-side only.
 */
export function resolveConfig(input: unknown, playerCount: number): MafiaConfig {
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new MafiaConfigError('player_count_out_of_range');
  }
  if (input !== undefined && input !== null && (typeof input !== 'object' || Array.isArray(input))) {
    throw new MafiaConfigError('config_not_object');
  }
  const raw = (input ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (raw[key] === undefined) continue;
    if (!(HOST_CONFIGURABLE_KEYS as readonly string[]).includes(key)) {
      throw new MafiaConfigError(`not_configurable:${key}`);
    }
  }

  const config = defaultConfigFor(playerCount);
  const defaultCount = config.mafiaCount;

  if (raw.mafiaCount !== undefined) {
    const n = raw.mafiaCount;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new MafiaConfigError('mafia_count_invalid');
    if (Math.abs(n - defaultCount) > 1) throw new MafiaConfigError('mafia_count_out_of_range');
    config.mafiaCount = n;
  }
  for (const key of ['doctorEnabled', 'detectiveEnabled'] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'boolean') throw new MafiaConfigError(`${key}_invalid`);
    config[key] = raw[key] as boolean;
  }
  for (const key of ['nightSeconds', 'discussionSeconds', 'votingSeconds'] as const) {
    if (raw[key] === undefined) continue;
    const v = raw[key];
    const [min, max] = TIMER_RANGES[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      throw new MafiaConfigError(`${key}_out_of_range`);
    }
    config[key] = v;
  }

  validateConfig(config, playerCount);
  return config;
}

/** Structural invariants that must hold for ANY config (also re-checked on resolved configs). */
export function validateConfig(config: MafiaConfig, playerCount: number): void {
  if (!Number.isInteger(config.mafiaCount) || config.mafiaCount < 1) throw new MafiaConfigError('mafia_count_invalid');
  if (config.mafiaCount * 2 >= playerCount) throw new MafiaConfigError('too_many_mafia');
  const specials = (config.doctorEnabled ? 1 : 0) + (config.detectiveEnabled ? 1 : 0);
  if (config.mafiaCount + specials > playerCount - 1) throw new MafiaConfigError('no_room_for_citizen');
  for (const key of Object.keys(TIMER_RANGES) as TimerKey[]) {
    const [min, max] = TIMER_RANGES[key];
    const v = config[key];
    if (!Number.isInteger(v) || v < min || v > max) throw new MafiaConfigError(`${key}_out_of_range`);
  }
}
