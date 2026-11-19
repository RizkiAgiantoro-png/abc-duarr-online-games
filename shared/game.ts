export const themes = ['Benda', 'Pekerjaan', 'Hewan', 'Anime', 'Makanan'] as const;
export type Theme = typeof themes[number];
export const events = ['reverse', 'speed', 'double', 'forbidden', 'quick', 'panic'] as const;
export type ChaosEvent = typeof events[number];
export const cards = ['shield', 'time', 'sabotage', 'appeal'] as const;
export type Card = typeof cards[number];
export const reactions = ['😂', '🤡', '😭', '😈', '🔥'] as const;
export type Reaction = typeof reactions[number];
export type Phase = 'lobby' | 'fingers' | 'reveal' | 'answer' | 'voting' | 'result' | 'winner';
export type Vote = 'correct' | 'wrong';
export type Outcome = Vote | 'neutral' | 'timeout';
export interface Stats {
  correct: number;
  wrong: number;
  neutral: number;
  timeouts: number;
  sabotages: number;
  powers: number;
}
export interface PlayerView {
  id: string;
  name: string;
  color: number;
  online: boolean;
  left: boolean;
  hearts: number;
  stats: Stats;
}
export interface Result {
  outcome: Outcome;
  correct: number;
  wrong: number;
  abstain: number;
  appeal: boolean;
  damage: number;
  eliminated: boolean;
}
export interface GameView {
  code: string;
  me: string;
  host: string | null;
  players: PlayerView[];
  theme: Theme;
  chaos: boolean;
  phase: Phase;
  step: number;
  round: number;
  serverNow: number;
  deadline: number | null;
  reconnectUntil: number | null;
  event: ChaosEvent | null;
  forbidden: string | null;
  letter: string | null;
  total: number | null;
  fingers: { id: string; value: number; auto: boolean }[];
  fingerCount: number;
  fingerGoal: number;
  myFingers: number | null;
  turn: string | null;
  turnOrder: string[];
  word: string | null;
  canVote: boolean;
  myVote: Vote | null;
  voteCount: number;
  voteGoal: number;
  revote: boolean;
  result: Result | null;
  card: Card | null;
  cardUsed: boolean;
  winner: string | null;
  eliminations: string[];
}
export type Action =
  | { type: 'create'; name: string }
  | { type: 'join'; name: string; code: string }
  | { type: 'resume'; code: string; token: string }
  | { type: 'leave' }
  | { type: 'settings'; theme: Theme; chaos: boolean }
  | { type: 'start' | 'rematch' }
  | { type: 'fingers'; step: number; value: number }
  | { type: 'answer'; step: number; word: string }
  | { type: 'vote'; step: number; vote: Vote }
  | { type: 'card'; step: number; target?: string }
  | { type: 'reaction'; reaction: Reaction };
export type Session = { code: string; token: string };
export type Reply = { ok: true; session?: Session } | { ok: false; error: string };
export type Effect =
  | { type: 'reaction'; id: string; reaction: Reaction }
  | { type: 'card'; id: string; card: Card; target?: string }
  | { type: 'elimination'; id: string };
export interface ClientEvents {
  action: (action: Action, reply: (reply: Reply) => void) => void;
  clock: (reply: (now: number) => void) => void;
}
export interface ServerEvents {
  state: (state: GameView) => void;
  effect: (effect: Effect) => void;
}
