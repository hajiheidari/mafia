import type { GameDefinition } from '@platform/types';

/**
 * Central registry of game modules. This is the ONLY place Core Platform
 * code is allowed to reference a game module by id. Core/Room/Lobby code
 * must go through this registry — never `import` a game package directly.
 */
class GameRegistryImpl {
  private games = new Map<string, GameDefinition<any, any, any>>();

  register(definition: GameDefinition<any, any, any>): void {
    if (this.games.has(definition.id)) {
      throw new Error(`Game "${definition.id}" is already registered`);
    }
    this.games.set(definition.id, definition);
  }

  get(id: string): GameDefinition<any, any, any> | undefined {
    return this.games.get(id);
  }

  requireGame(id: string): GameDefinition<any, any, any> {
    const game = this.get(id);
    if (!game) throw new Error(`Unknown game id "${id}"`);
    return game;
  }

  all(): GameDefinition<any, any, any>[] {
    return Array.from(this.games.values());
  }

  /** Test-only: clears registrations so test suites don't leak state. */
  _resetForTests(): void {
    this.games.clear();
  }
}

export const GameRegistry = new GameRegistryImpl();
