import { randomUUID } from 'node:crypto';
import { cards, events, MAX_PLAYERS, MIN_PLAYERS, reactions, themes } from '../shared/game.js';
import type {
  Action, Card, ChaosEvent, Effect, GameView, Phase, Reaction, Result, Stats, Theme, Vote,
} from '../shared/game.js';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const alphabetFrom = (total: number) => alphabet[(total - 1) % 26];
const canonical = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
export class GameError extends Error {}
function requireGame(value: unknown, message: string): asserts value {
  if (!value) throw new GameError(message);
}

export function nickname(value: unknown) {
  requireGame(typeof value === 'string' && value.length <= 80, 'Masukkan nama panggilan hingga 16 karakter.');
  const name = canonical(value);
  requireGame(name.length > 0 && [...name].length <= 16 && !/\p{C}/u.test(name), 'Masukkan nama panggilan hingga 16 karakter.');
  return name;
}

export function tally(votes: Vote[], eligible: number): Result {
  const correct = votes.filter(vote => vote === 'correct').length;
  const wrong = votes.length - correct;
  return {
    correct, wrong, abstain: eligible - votes.length,
    outcome: votes.length < Math.ceil(eligible / 2) || eligible === 0 ? 'neutral' : correct > wrong ? 'correct' : 'wrong',
    appeal: false, damage: 0, eliminated: false,
  };
}

export const durations = {
  fingers: 15_000, reveal: 4_000, answer: 30_000, speed: 15_000, panic: 20_000,
  voting: 12_000, quick: 7_000, result: 3_200, appeal: 6_000, reconnect: 30_000,
  extra: 10_000, sabotage: 5_000,
};
const newStats = (): Stats => ({ correct: 0, wrong: 0, neutral: 0, timeouts: 0, sabotages: 0, powers: 0 });
interface Player {
  id: string;
  token: string;
  socket: string | null;
  name: string;
  color: number;
  hearts: number;
  left: boolean;
  grace: number | null;
  expiry?: ReturnType<typeof setTimeout>;
  card: Card | null;
  cardUsed: boolean;
  sabotaged: boolean;
  lastReaction: number;
  stats: Stats;
}
type RoomAction = Exclude<Action, { type: 'create' | 'join' | 'resume' | 'leave' }>;

export class Room {
  players = new Map<string, Player>();
  host: string | null = null;
  phase: Phase = 'lobby';
  theme: Theme = 'Hewan';
  chaos = true;
  round = 0;
  deadline: number | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private pause: number | null = null;
  private step = 0;
  private pastEvent: ChaosEvent | null = null;
  private event: ChaosEvent | null = null;
  private forbidden: string | null = null;
  private letter: string | null = null;
  private total: number | null = null;
  private fingers = new Map<string, { value: number; auto: boolean }>();
  private participants: string[] = [];
  private rotation: string[] = [];
  private queue: string[] = [];
  private turn: string | null = null;
  private word: string | null = null;
  private words = new Set<string>();
  private eligible: string[] = [];
  private votes = new Map<string, Vote>();
  private revote = false;
  private result: Result | null = null;
  private winner: string | null = null;
  private eliminations: string[] = [];

  constructor(
    readonly code: string,
    private notify: () => void,
    private emit: (effect: Effect) => void,
    private random = Math.random,
    private time = durations,
  ) {}

  private living() { return [...this.players.values()].filter(p => p.hearts > 0 && !p.left); }
  private pick<T>(items: readonly T[]) { return items[Math.floor(this.random() * items.length)]; }
  private get current() { return this.turn ? this.players.get(this.turn) : undefined; }
  private get playing() { return this.phase !== 'lobby' && this.phase !== 'winner'; }

  add(name: string, socket: string) {
    requireGame(this.phase === 'lobby', 'Pertandingan sudah dimulai.');
    requireGame(this.players.size < MAX_PLAYERS, 'Room sudah penuh.');
    requireGame(![...this.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase()), 'Nama itu sudah dipakai.');
    const used = new Set([...this.players.values()].map(p => p.color));
    const player: Player = {
      id: randomUUID(), token: randomUUID(), name, socket, color: [0, 1, 2, 3, 4].find(i => !used.has(i))!,
      hearts: 3, left: false, grace: null, card: null, cardUsed: false,
      sabotaged: false, lastReaction: -Infinity, stats: newStats(),
    };
    this.players.set(player.id, player);
    this.host ??= player.id;
    return player;
  }

  resume(token: string, socket: string) {
    const player = [...this.players.values()].find(p => p.token === token);
    requireGame(player && !player.left && (!player.grace || Date.now() < player.grace), 'Sesi sudah berakhir. Masuk lagi dengan kode room.');
    const previous = player.socket;
    clearTimeout(player.expiry);
    player.grace = null;
    player.socket = socket;
    this.host ??= player.id;
    if (player.id === this.turn && this.pause !== null) {
      const remaining = this.pause;
      this.pause = null;
      this.arm(remaining);
    }
    return { player, previous };
  }

  disconnect(id: string, socket: string, leave = false) {
    const player = this.players.get(id);
    if (!player || player.socket !== socket) return;
    if (this.deadline !== null && this.deadline <= Date.now()) this.advance();
    player.socket = null;
    if (this.host === id) {
      const online = [...this.players.values()].filter(p => p.socket);
      this.host = (online.find(p => p.hearts > 0) ?? online[0])?.id ?? null;
    }
    if (leave) {
      this.depart(player);
      return;
    }
    player.grace = Date.now() + this.time.reconnect;
    player.expiry = setTimeout(() => this.depart(player), this.time.reconnect);
    if (this.phase === 'answer' && this.turn === id && this.deadline !== null) {
      this.pause = Math.max(1, this.deadline - Date.now());
      this.clearTimer();
    }
    this.notify();
  }

  private depart(player: Player) {
    clearTimeout(player.expiry);
    player.grace = null;
    player.left = true;
    if (this.phase === 'lobby') this.players.delete(player.id);
    if (this.playing && player.hearts > 0) {
      this.eliminate(player);
      if (!this.finishIfNeeded()) {
        if (this.turn === player.id) this.nextTurn();
        else if (this.phase === 'fingers' && this.allFingersIn()) this.reveal();
      }
    }
    this.notify();
  }

  action(id: string, action: RoomAction) {
    const player = this.players.get(id);
    requireGame(player?.socket && !player.left, 'Kamu sudah keluar dari room.');
    if (this.deadline !== null && this.deadline <= Date.now()) {
      this.advance();
      this.notify();
    }
    switch (action.type) {
      case 'reaction':
        this.react(player, action.reaction);
        break;
      case 'settings':
        this.hostOnly(id);
        requireGame(themes.includes(action.theme) && typeof action.chaos === 'boolean', 'Pengaturan room tidak valid.');
        this.theme = action.theme;
        this.chaos = action.chaos;
        break;
      case 'start':
      case 'rematch':
        this.hostOnly(id);
        requireGame(this.phase === (action.type === 'start' ? 'lobby' : 'winner'), 'Pertandingan belum siap dimulai.');
        this.start();
        break;
      default:
        requireGame(this.playing && player.hearts > 0, 'Kamu sedang menonton pertandingan.');
        requireGame(action.step === this.step, 'Fase sudah berganti.');
        switch (action.type) {
          case 'fingers':
            requireGame(this.phase === 'fingers' && this.participants.includes(id) && !this.fingers.has(id), 'Pilihan jari sudah dikunci atau fase sudah berganti.');
            requireGame(Number.isInteger(action.value) && action.value >= 1 && action.value <= 10, 'Pilih angka 1–10.');
            this.fingers.set(id, { value: action.value, auto: false });
            if (this.allFingersIn()) this.reveal();
            break;
          case 'answer':
            this.answer(id, action.word);
            break;
          case 'vote':
            requireGame(this.phase === 'voting' && this.eligible.includes(id) && !this.votes.has(id), 'Kamu tidak bisa memberikan suara saat ini.');
            requireGame(action.vote === 'correct' || action.vote === 'wrong', 'Pilihan suara tidak valid.');
            this.votes.set(id, action.vote);
            if (this.votes.size === this.eligible.length) this.resolveVote();
            break;
          case 'card':
            this.useCard(player, action.target);
            break;
          default:
            throw new GameError('Aksi tidak dikenal.');
        }
    }
    this.notify();
  }

  private react(player: Player, reaction: Reaction) {
    requireGame(player.hearts > 0 || this.phase === 'winner', 'Reaksi tersedia untuk pemain yang masih aktif.');
    requireGame(reactions.includes(reaction), 'Reaksi tidak valid.');
    const now = Date.now();
    requireGame(now - player.lastReaction >= 1_200, 'Beri jeda sebelum mengirim reaksi lagi.');
    player.lastReaction = now;
    this.emit({ type: 'reaction', id: player.id, reaction });
  }

  private hostOnly(id: string) {
    requireGame(this.host === id && (this.phase === 'lobby' || this.phase === 'winner'), 'Hanya host yang bisa mengubah pengaturan sebelum main.');
  }

  private start() {
    const roster = [...this.players.values()].filter(p => !p.left);
    requireGame(roster.length >= MIN_PLAYERS && roster.every(p => p.socket), `Butuh minimal ${MIN_PLAYERS} pemain dan semuanya harus terhubung.`);
    for (const [id, p] of this.players) {
      if (p.left) {
        this.players.delete(id);
        continue;
      }
      Object.assign(p, {
        hearts: 3, card: this.chaos ? this.pick(cards) : null,
        cardUsed: false, sabotaged: false, stats: newStats(),
      });
    }
    this.rotation = roster.map(p => p.id);
    for (let i = this.rotation.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [this.rotation[i], this.rotation[j]] = [this.rotation[j], this.rotation[i]];
    }
    this.round = 0;
    this.words.clear();
    this.eliminations = [];
    this.winner = null;
    this.pastEvent = null;
    this.nextRound();
  }

  private nextRound() {
    const alive = new Set(this.living().map(p => p.id));
    this.rotation = this.rotation.filter(id => alive.has(id));
    if (this.round > 0) this.rotation.push(this.rotation.shift()!);
    this.round++;
    this.event = this.chaos && this.random() < 0.5 ? this.pick(events.filter(event => event !== this.pastEvent)) : null;
    if (this.event) this.pastEvent = this.event;
    this.forbidden = this.event === 'forbidden' ? this.pick([...alphabet]) : null;
    this.queue = this.event === 'reverse' ? [...this.rotation].reverse() : [...this.rotation];
    this.participants = [...this.rotation];
    this.letter = null;
    this.total = null;
    this.fingers.clear();
    this.resetTurn();
    this.setPhase('fingers', this.time.fingers);
  }

  private allFingersIn() {
    return this.living().every(player => this.fingers.has(player.id));
  }

  private reveal() {
    this.participants = this.participants.filter(id => {
      const player = this.players.get(id);
      return player && !player.left && player.hearts > 0;
    });
    for (const id of this.participants) {
      if (!this.fingers.has(id)) this.fingers.set(id, { value: 1 + Math.floor(this.random() * 10), auto: true });
    }
    this.total = this.participants.reduce((sum, id) => sum + this.fingers.get(id)!.value, 0);
    this.letter = alphabetFrom(this.total);
    this.setPhase('reveal', this.time.reveal);
  }

  private resetTurn() {
    this.turn = null;
    this.word = null;
    this.eligible = [];
    this.votes.clear();
    this.revote = false;
    this.result = null;
  }

  private nextTurn() {
    if (this.finishIfNeeded()) return;
    this.resetTurn();
    this.queue = this.queue.filter(id => {
      const p = this.players.get(id);
      return p && !p.left && p.hearts > 0;
    });
    this.turn = this.queue.shift() ?? null;
    const player = this.current;
    if (!player) {
      this.nextRound();
      return;
    }
    const base = this.event === 'speed' ? this.time.speed : this.event === 'panic' ? this.time.panic : this.time.answer;
    const limit = Math.max(1, base - (player.sabotaged ? this.time.sabotage : 0));
    player.sabotaged = false;
    this.setPhase('answer', player.socket ? limit : undefined);
    if (!player.socket) this.pause = limit;
  }

  private answer(id: string, raw: string) {
    requireGame(this.phase === 'answer' && this.turn === id && this.pause === null, 'Belum giliranmu.');
    requireGame(typeof raw === 'string' && raw.length <= 200, 'Masukkan jawaban hingga 40 karakter.');
    const word = canonical(raw);
    requireGame(word.length > 0 && [...word].length <= 40 && !/\p{C}/u.test(word), 'Masukkan jawaban hingga 40 karakter.');
    requireGame(word[0].toUpperCase() === this.letter, `Jawaban harus dimulai dengan ${this.letter}.`);
    requireGame(!this.forbidden || !word.slice(1).toUpperCase().includes(this.forbidden), `Huruf ${this.forbidden} dilarang setelah huruf pertama.`);
    const key = word.toLowerCase();
    requireGame(!this.words.has(key), 'Jawaban itu sudah dipakai di pertandingan ini.');
    this.words.add(key);
    this.word = word;
    this.beginVote();
  }

  private beginVote() {
    this.eligible = this.living().filter(p => p.id !== this.turn).map(p => p.id);
    this.votes.clear();
    this.result = null;
    this.setPhase('voting', this.event === 'quick' ? this.time.quick : this.time.voting);
  }

  private resolveVote() {
    const result = tally([...this.votes.values()], this.eligible.length);
    const player = this.current!;
    result.appeal = result.outcome === 'wrong' && player.card === 'appeal' && !player.cardUsed && !this.revote;
    this.result = result;
    if (result.appeal) this.setPhase('result', this.time.appeal);
    else this.finalize(result);
  }

  private finalize(result: Result) {
    const player = this.current!;
    result.appeal = false;
    this.result = result;
    const { outcome } = result;
    if (outcome === 'correct') player.stats.correct++;
    if (outcome === 'wrong') player.stats.wrong++;
    if (outcome === 'neutral') player.stats.neutral++;
    if (outcome === 'timeout') player.stats.timeouts++;
    if (outcome === 'wrong' || outcome === 'timeout') {
      let damage = outcome === 'wrong' && this.event === 'double' ? 2 : 1;
      if (player.card === 'shield' && !player.cardUsed) {
        this.markCard(player);
        damage--;
      }
      result.damage = Math.min(player.hearts, damage);
      player.hearts -= result.damage;
      if (player.hearts === 0) {
        this.eliminate(player);
        result.eliminated = true;
      }
    }
    if (!this.finishIfNeeded()) this.setPhase('result', this.time.result);
  }

  private eliminate(player: Player) {
    player.hearts = 0;
    this.eliminations.push(player.id);
    this.emit({ type: 'elimination', id: player.id });
  }

  private finishIfNeeded() {
    const alive = this.living();
    if (alive.length > 1) return false;
    this.winner = alive[0]?.id ?? null;
    this.setPhase('winner');
    return true;
  }

  private markCard(player: Player, target?: string) {
    player.cardUsed = true;
    player.stats.powers++;
    this.emit({ type: 'card', id: player.id, card: player.card!, target });
  }

  private useCard(player: Player, target?: string) {
    requireGame(this.chaos && player.card && !player.cardUsed, 'Kartu tidak tersedia.');
    switch (player.card) {
      case 'shield':
        throw new GameError('Perisai bekerja otomatis saat kamu terkena penalti.');
      case 'time':
        requireGame(this.phase === 'answer' && this.turn === player.id && this.deadline !== null, 'Pakai kartu ini saat giliranmu menjawab.');
        this.arm(this.deadline - Date.now() + this.time.extra);
        this.markCard(player);
        break;
      case 'sabotage': {
        requireGame(typeof target === 'string' && target !== player.id, 'Pilih satu lawan.');
        const opponent = this.players.get(target);
        requireGame(opponent && opponent.hearts > 0 && !opponent.left && !opponent.sabotaged, 'Lawan ini sedang tidak bisa disabotase.');
        opponent.sabotaged = true;
        player.stats.sabotages++;
        this.markCard(player, target);
        break;
      }
      case 'appeal':
        requireGame(this.phase === 'result' && this.turn === player.id && this.result?.appeal, 'Banding tersedia setelah hasil SALAH.');
        this.markCard(player);
        this.revote = true;
        this.beginVote();
        break;
    }
  }

  private clearTimer() {
    clearTimeout(this.timer);
    this.deadline = null;
  }

  private arm(ms: number) {
    this.clearTimer();
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.advance();
      this.notify();
    }, ms);
  }

  private setPhase(phase: Phase, ms?: number) {
    this.clearTimer();
    this.pause = null;
    this.phase = phase;
    this.step++;
    if (ms !== undefined) this.arm(ms);
  }

  private advance() {
    switch (this.phase) {
      case 'fingers': this.reveal(); break;
      case 'reveal': this.nextTurn(); break;
      case 'answer': this.finalize({ outcome: 'timeout', correct: 0, wrong: 0, abstain: 0, appeal: false, damage: 0, eliminated: false }); break;
      case 'voting': this.resolveVote(); break;
      case 'result':
        if (this.result?.appeal) this.finalize(this.result);
        else this.nextTurn();
        break;
    }
  }

  view(me: string): GameView {
    const player = this.players.get(me)!;
    const openFingers = this.total !== null;
    const fingerRoster = this.phase === 'fingers' ? this.living().map(p => p.id) : this.participants;
    return {
      code: this.code, me, host: this.host, players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, color: p.color, online: !!p.socket, left: p.left, hearts: p.hearts, stats: { ...p.stats },
      })),
      theme: this.theme, chaos: this.chaos, phase: this.phase, step: this.step, round: this.round,
      serverNow: Date.now(), deadline: this.deadline, reconnectUntil: this.pause !== null ? this.current?.grace ?? null : null,
      event: this.event, forbidden: this.forbidden, letter: this.letter, total: this.total,
      fingers: openFingers ? fingerRoster.map(id => ({ id, ...this.fingers.get(id)! })) : [],
      fingerCount: fingerRoster.filter(id => this.fingers.has(id)).length,
      fingerGoal: fingerRoster.length, myFingers: this.fingers.get(me)?.value ?? null,
      turn: this.turn, turnOrder: [this.turn, ...this.queue].filter((id): id is string => id !== null),
      word: this.word, canVote: this.phase === 'voting' && player.hearts > 0 && this.eligible.includes(me) && !this.votes.has(me),
      myVote: this.votes.get(me) ?? null, voteCount: this.votes.size, voteGoal: this.eligible.length,
      revote: this.revote, result: this.result ? { ...this.result } : null, card: player.card,
      cardUsed: player.cardUsed, winner: this.winner, eliminations: [...this.eliminations],
    };
  }

  get empty() { return ![...this.players.values()].some(p => p.socket || p.grace !== null); }

  dispose() {
    this.clearTimer();
    for (const p of this.players.values()) clearTimeout(p.expiry);
  }
}
