/**
 * Tracks which socket ids are currently open for a given (roomId, userId).
 * Exists so that opening a second browser tab doesn't cause the user to
 * flicker "disconnected" when the first tab's socket drops — presence is
 * "at least one active socket", not "exactly one". See Milestone 5
 * follow-up §4.
 *
 * Single-server-instance MVP: in-memory, same documented tradeoff as
 * pendingDisconnectTimers in registerRealtimeHandlers.ts (see ARCHITECTURE.md
 * §2). A restart drops this bookkeeping; affected users simply need to
 * reconnect once, which repopulates it.
 */
function key(roomId: string, userId: string): string {
  return `${roomId}:${userId}`;
}

const activeSockets = new Map<string, Set<string>>();

/** Registers a socket as active for this user in this room. Returns whether this is their FIRST active socket (i.e. they were fully disconnected before). */
export function trackSocketConnected(roomId: string, userId: string, socketId: string): { wasFullyDisconnected: boolean } {
  const k = key(roomId, userId);
  const set = activeSockets.get(k) ?? new Set<string>();
  const wasFullyDisconnected = set.size === 0;
  set.add(socketId);
  activeSockets.set(k, set);
  return { wasFullyDisconnected };
}

/** Unregisters a socket. Returns whether the user now has ZERO active sockets left in this room. */
export function trackSocketDisconnected(roomId: string, userId: string, socketId: string): { isNowFullyDisconnected: boolean } {
  const k = key(roomId, userId);
  const set = activeSockets.get(k);
  if (!set) return { isNowFullyDisconnected: true };
  set.delete(socketId);
  const isNowFullyDisconnected = set.size === 0;
  if (isNowFullyDisconnected) activeSockets.delete(k);
  return { isNowFullyDisconnected };
}

export function hasActiveSocket(roomId: string, userId: string): boolean {
  const set = activeSockets.get(key(roomId, userId));
  return !!set && set.size > 0;
}

/** Test/shutdown helper — mirrors clearAllPendingDisconnectTimers. */
export function clearAllSocketTracking(): void {
  activeSockets.clear();
}
