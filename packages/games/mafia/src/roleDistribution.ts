import type { GamePlayer } from '@platform/types';
import type { MafiaConfig, MafiaPlayerState, MafiaRole } from './types';

/** In-place Fisher–Yates with an injectable integer RNG. */
export function shuffle<T>(items: T[], randomInt: (maxExclusive: number) => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/**
 * Shuffles the players, then hands out: first `mafiaCount` → MAFIA, then
 * DOCTOR, then DETECTIVE (if enabled), everyone else CITIZEN. The shuffle
 * order is never stored or sent anywhere — only the resulting roles,
 * which live solely in the server-side state.
 */
export function assignRoles(
  players: GamePlayer[],
  config: MafiaConfig,
  randomInt: (maxExclusive: number) => number,
): MafiaPlayerState[] {
  const order = shuffle(
    players.map((_, i) => i),
    randomInt,
  );
  const roleByIndex = new Map<number, MafiaRole>();
  let cursor = 0;
  for (let m = 0; m < config.mafiaCount; m++) roleByIndex.set(order[cursor++]!, 'MAFIA');
  if (config.doctorEnabled) roleByIndex.set(order[cursor++]!, 'DOCTOR');
  if (config.detectiveEnabled) roleByIndex.set(order[cursor++]!, 'DETECTIVE');

  return players.map((p, i) => ({
    id: p.id,
    displayName: p.displayName,
    role: roleByIndex.get(i) ?? 'CITIZEN',
    alive: true,
    eliminationCause: null,
    eliminationRound: null,
    roleReadyAcked: false,
    joinOrder: i,
  }));
}
