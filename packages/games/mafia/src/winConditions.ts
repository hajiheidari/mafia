import type { MafiaState, MafiaWinner } from './types';

/**
 * Town wins when no mafia is alive; mafia wins when alive mafia ≥ alive
 * non-mafia (doctor and detective count as town). Server-side only.
 */
export function evaluateWinner(state: Pick<MafiaState, 'players'>): MafiaWinner | null {
  let mafia = 0;
  let town = 0;
  for (const p of state.players) {
    if (!p.alive) continue;
    if (p.role === 'MAFIA') mafia++;
    else town++;
  }
  if (mafia === 0) return 'TOWN';
  if (mafia >= town) return 'MAFIA';
  return null;
}
