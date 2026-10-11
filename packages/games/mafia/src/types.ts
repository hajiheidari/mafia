// Mafia's own types. Nothing outside packages/games/mafia (and its UI)
// may depend on these — the platform only sees GameDefinition.

export type MafiaRole = 'MAFIA' | 'CITIZEN' | 'DOCTOR' | 'DETECTIVE';

export type MafiaPhase =
  | 'ROLE_REVEAL'
  | 'NIGHT'
  | 'DAY_ANNOUNCEMENT'
  | 'DISCUSSION'
  | 'VOTING'
  | 'VOTE_RESULT'
  | 'GAME_FINISHED';

export type EliminationCause = 'MAFIA' | 'VOTE' | 'LEFT';

export type MafiaWinner = 'MAFIA' | 'TOWN';

export interface MafiaPlayerState {
  id: string;
  displayName: string;
  role: MafiaRole;
  alive: boolean;
  eliminationCause: EliminationCause | null;
  eliminationRound: number | null;
  roleReadyAcked: boolean;
  /** Index in the original player list — tie-breaker for the mafia "leader". */
  joinOrder: number;
}

export interface MafiaNightActions {
  /** mafiaId → targetId. Last vote of each member counts. */
  mafiaVotes: Record<string, string>;
  doctorTarget: string | null;
  detectiveTarget: string | null;
}

export interface MafiaInvestigationRecord {
  round: number;
  detectiveId: string;
  targetId: string;
  isMafia: boolean;
}

export interface MafiaVoteState {
  /** voterId → targetId, or null = explicit abstain. Missing = abstain. */
  votes: Record<string, string | null>;
}

export interface EliminationRecord {
  round: number;
  playerId: string;
  cause: EliminationCause;
  revealedRole: MafiaRole;
}

export interface MafiaConfig {
  mafiaCount: number;
  doctorEnabled: boolean;
  detectiveEnabled: boolean;
  roleRevealSeconds: number;
  nightSeconds: number;
  dayAnnouncementSeconds: number;
  discussionSeconds: number;
  votingSeconds: number;
  voteResultSeconds: number;
}

/** What a host may send. Missing fields get player-count-dependent defaults. */
export type MafiaConfigInput = Partial<
  Pick<MafiaConfig, 'mafiaCount' | 'doctorEnabled' | 'detectiveEnabled' | 'nightSeconds' | 'discussionSeconds' | 'votingSeconds'>
>;

/** Public outcome of the last night / vote, kept for the announcement screens. */
export interface NightOutcome {
  round: number;
  eliminatedPlayerId: string | null;
  revealedRole: MafiaRole | null;
}

export interface VoteOutcome {
  round: number;
  eliminatedPlayerId: string | null;
  revealedRole: MafiaRole | null;
  wasTie: boolean;
}

export interface MafiaState {
  phase: MafiaPhase;
  phaseEndsAt: number | null;
  round: number;
  config: MafiaConfig;
  players: MafiaPlayerState[];
  currentNightActions: MafiaNightActions;
  lastDoctorTargetByDoctorId: Record<string, string>;
  investigations: MafiaInvestigationRecord[];
  currentVotes: MafiaVoteState;
  eliminationHistory: EliminationRecord[];
  lastNightOutcome: NightOutcome | null;
  lastVoteOutcome: VoteOutcome | null;
  winner: MafiaWinner | null;
}

export type MafiaAction =
  | { type: 'ROLE_READY' }
  | { type: 'MAFIA_SELECT_TARGET'; targetUserId: string }
  | { type: 'DOCTOR_PROTECT'; targetUserId: string }
  | { type: 'DETECTIVE_INVESTIGATE'; targetUserId: string }
  | { type: 'PLAYER_VOTE'; targetUserId: string | null };

export interface MafiaPublicPlayer {
  id: string;
  displayName: string;
  alive: boolean;
  /** Only set for eliminated players (or everyone once the game is over). */
  revealedRole: MafiaRole | null;
  roleReadyAcked: boolean;
}

export interface MafiaVoteTally {
  votes: Record<string, string | null>;
  counts: Record<string, number>;
}

export interface MafiaTeammateView {
  id: string;
  displayName: string;
  alive: boolean;
  currentTargetId: string | null;
}

export interface MafiaPlayerView {
  phase: MafiaPhase;
  phaseEndsAt: number | null;
  round: number;
  setup: { mafiaCount: number; doctorEnabled: boolean; detectiveEnabled: boolean; playerCount: number };
  you: {
    id: string;
    role: MafiaRole | null;
    alive: boolean;
    roleReadyAcked: boolean;
    /** This player's own submitted target for the current night (never others'). */
    nightTargetId: string | null;
  };
  players: MafiaPublicPlayer[];
  currentVoteTally: MafiaVoteTally | null;
  eliminationHistory: EliminationRecord[];
  lastNightOutcome: NightOutcome | null;
  lastVoteOutcome: VoteOutcome | null;
  winner: MafiaWinner | null;
  mafiaTeammates?: MafiaTeammateView[];
  doctorLastProtectedId?: string | null;
  detectiveInvestigations?: MafiaInvestigationRecord[];
}

/** Injected so tests can control time and randomness. */
export interface MafiaRuntime {
  now: () => number;
  /** Uniform integer in [0, maxExclusive). */
  randomInt: (maxExclusive: number) => number;
}
