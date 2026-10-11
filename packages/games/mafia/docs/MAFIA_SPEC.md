# Mafia — implementation spec (v2, Milestone 7B)

Server-authoritative. The full state lives only in `game_sessions.state`;
clients receive `getPlayerView(state, playerId)` and public events, nothing else.

## Roles and setup

| Players | Mafia (default) |
|---|---|
| 6–7 | 1 |
| 8–10 | 2 |
| 11–14 | 3 |
| 15–20 | 4 |

Doctor and Detective are on by default; everyone else is a Citizen.

Host overrides (`POST /api/rooms/:id/start` body `{ config }`), validated in `config.ts`:

- `mafiaCount`: integer ≥ 1, at most ±1 from the default, `mafia*2 < players`, at least one citizen left.
- `doctorEnabled` / `detectiveEnabled`: booleans (disabled role → citizen).
- `nightSeconds` 20–120 (45), `discussionSeconds` 30–300 (90), `votingSeconds` 20–120 (45).
- Fixed in v1: role reveal 10s, day announcement 8s, vote result 8s.
- Any other key (e.g. `roles`) → rejected. Invalid config → HTTP 400 `INVALID_CONFIG`.

Roles are dealt by Fisher–Yates with `crypto.randomInt` (the RNG is
injectable for tests). The shuffle order is never stored or sent.

## Phases

`ROLE_REVEAL → NIGHT → DAY_ANNOUNCEMENT → DISCUSSION → VOTING → VOTE_RESULT → NIGHT …`

The win check is evaluated right after every elimination (night kill, vote,
permanent leave); a winner moves the game straight to `GAME_FINISHED`.

| Phase | Actions | Ends |
|---|---|---|
| ROLE_REVEAL | `ROLE_READY` | timer, or early once every alive player is ready |
| NIGHT | `MAFIA_SELECT_TARGET`, `DOCTOR_PROTECT`, `DETECTIVE_INVESTIGATE` | timer, or early once every alive night role has acted |
| DAY_ANNOUNCEMENT | — | timer |
| DISCUSSION | chat (alive only) | timer |
| VOTING | `PLAYER_VOTE` | timer |
| VOTE_RESULT | — | timer |
| GAME_FINISHED | — | — (all roles revealed) |

Entering NIGHT bumps `round` and clears the night actions.

## Rules

- **Mafia**: target must be alive, not self, not mafia. Each member's last
  vote counts; majority wins; a tie goes to the leader (alive mafia with the
  lowest `joinOrder`); leader didn't vote, or nobody voted → no kill.
  Alive mafia see teammates and their current votes.
- **Doctor**: protects any alive player, including themselves; never the same
  player two nights in a row. No action → no protection.
- **Detective**: alive target, not self, once per night. The result
  (`isMafia`) is stored immediately and only appears in the detective's view.
- **Voting**: alive voters only; target alive or `null` (abstain); self-vote
  allowed; votes are public and changeable; a tie or no votes → nobody out.
- **Win**: town when no mafia is alive; mafia when alive mafia ≥ alive non-mafia.
- **Leaving for good** (explicit leave, kick, grace period expiry — never a
  temporary disconnect): dead, cause `LEFT`, role revealed, pending night
  action/vote removed, win re-checked; otherwise the phase and timer go on.
- **Chat**: alive players only while the game runs; open to all after
  `GAME_FINISHED` (the session gets `endedAt`).

Action rejections check the actor's role before anything about the target,
so a rejection is never an oracle about someone else's role.

## Events

Public (`GAME_EVENT`, persisted): `PLAYER_ROLE_ACKED`, `NIGHT_STARTED`,
`NIGHT_RESOLVED{round, eliminatedPlayerId, revealedRole}`, `DAY_STARTED`,
`DISCUSSION_STARTED`, `VOTE_STARTED`, `VOTE_CAST{voterId, targetId}`,
`VOTE_RESOLVED{eliminatedPlayerId, revealedRole, wasTie}`,
`PLAYER_LEFT{playerId, revealedRole}`, `MAFIA_WON` / `CITIZENS_WON{finalRoles}`.

Private (never in `events`, only via the actor's view): mafia target,
doctor protection, detective result.

## Player view

| Recipient | Sees |
|---|---|
| everyone | phase, `phaseEndsAt`, round, setup, roster (role only for the eliminated), public votes, elimination history, last night/vote outcome, winner |
| alive mafia | + own role, teammates and their current night votes |
| alive doctor | + own role, `doctorLastProtectedId` |
| alive detective | + own role, own investigations |
| alive citizen | + own role |
| eliminated | public info + own (already public) role |
| host | nothing extra |
| GAME_FINISHED | every role |

## Package layout

`src/types` · `config` · `roleDistribution` · `validation` · `actions` ·
`phases` · `resolution` · `winConditions` · `leave` · `playerView` ·
`events` · `definition` · `index`.
