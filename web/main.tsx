import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AudioLines, Check, CircleHelp, Copy, Crown, Hand, Heart, LogOut, Plus,
  Radio, Settings2, Sparkles, Timer, Trophy, Users, X, Zap,
} from 'lucide-react';
import { MAX_PLAYERS, MIN_PLAYERS, reactions, themes, type Action, type GameView, type PlayerView, type Result } from '../shared/game.js';
import { getSound, music, sound, unlockSound, type SoundSettings } from './audio.js';
import { cardText, chaosText, themeIcons } from './content.js';
import { useGame } from './network.js';
import './styles.css';

type Send = (action: Action) => Promise<boolean>;
type ModalName = 'help' | 'sound' | 'leave' | null;

function Brand() {
  return <div className="brand"><span className="brand-icon"><Zap size={19} fill="currentColor" strokeWidth={2.7} /></span><span>ABC <em>DUARR!</em></span></div>;
}

function Poster() {
  return <div className="poster" aria-hidden="true">
    <span className="poster-grid" />
    <div className="poster-label"><Zap size={15} fill="currentColor" /> ABC LIMA DASAR</div>
    <span className="poster-spark spark-one">✦</span><span className="poster-spark spark-two">✦</span>
    <div className="tiles"><span>A</span><span>B</span><span>C</span></div>
    <span className="poster-spark spark-three">✦</span>
    <span className="poster-stamp">DUARR<span>!</span></span>
    <span className="poster-trail">● ● ●</span>
  </div>;
}

function Landing({ connected, restoring, send }: { connected: boolean; restoring: boolean; send: Send }) {
  const invite = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
  const [mode, setMode] = useState<'create' | 'join'>(invite ? 'join' : 'create');
  const [name, setName] = useState('');
  const [code, setCode] = useState(invite.slice(0, 6));
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    await send(mode === 'create' ? { type: 'create', name } : { type: 'join', name, code });
    setBusy(false);
  }

  return <main className="landing wrap">
    <section className="hero">
      <div className="hero-kicker"><span /><b>PARTY GAME ONLINE</b></div>
      <h1>abcd <br/><em>online games</em></h1>
      <p>Adu kata, voting rame-rame, dan pertahankan nyawamu. Siapa yang bertahan sampai akhir?</p>
      <Poster />
    </section>
    <section className="entry panel" aria-label="Buat atau masuk room">
      <div className="entry-icon"><Hand size={26} strokeWidth={2.15} /></div>
      <h2>join the game</h2>
      <p>Ajak temanmu dan mulai main.</p>
      <div className="segmented" aria-label="Pilih cara masuk">
        <button className={mode === 'create' ? 'selected' : ''} aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Buat room</button>
        <button className={mode === 'join' ? 'selected' : ''} aria-pressed={mode === 'join'} onClick={() => setMode('join')}>Gabung</button>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="name">Nama panggilan</label>
        <input autoComplete="off" id="name" maxLength={16} placeholder="Contoh: tiki kata taka" required value={name} onChange={event => setName(event.target.value)} />
        {mode === 'join' && <>
          <label htmlFor="code">Kode room</label>
          <input autoComplete="off" autoCapitalize="characters" className="room-input" id="code" maxLength={6} pattern="[A-HJ-NP-Z2-9]{6}" placeholder="ABC234" required value={code} onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))} />
        </>}
        <button className="button primary wide" disabled={busy || !connected || restoring}>
          {mode === 'create' ? <Plus size={20} /> : <Users size={20} />}
          {restoring ? 'Memulihkan sesi…' : !connected ? 'Menyambungkan…' : busy ? 'Tunggu sebentar…' : mode === 'create' ? 'Buat room' : 'Gabung room'}
        </button>
      </form>
      <div className="entry-detail"><Users size={17} /> {MIN_PLAYERS}–{MAX_PLAYERS} pemain <span /> <Zap size={16} /> Real-time</div>
    </section>
    <footer className="footer"><b>ABC DUARR!</b><span>ABC Lima Dasar versi party game</span></footer>
  </main>;
}

function Avatar({ player }: { player: PlayerView }) {
  const chars = player.name.split(' ').slice(0, 2).map(word => [...word][0]).join('');
  return <span className={`avatar color-${player.color}`}>{chars.toUpperCase()}</span>;
}

function Hearts({ count }: { count: number }) {
  return <span className="hearts" aria-label={`${count} dari 3 nyawa`}>
    {[1, 2, 3].map(n => <Heart key={n} size={16} className={n <= count ? 'filled' : ''} />)}
  </span>;
}

function Roster({ view, effect }: { view: GameView; effect: ReturnType<typeof useGame>['effect'] }) {
  const lobby = view.phase === 'lobby';
  const players = view.players.filter(player => !player.left || !lobby);
  return <section className="panel roster">
    <div className="section-title"><h2>Pemain</h2><span className="chip">{lobby ? `${players.length}/${MAX_PLAYERS}` : `${players.filter(p => p.hearts > 0 && !p.left).length} aktif`}</span></div>
    <div className="players">
      {players.map(p => {
        const value = effect?.value;
        const reacting = value?.type === 'reaction' && value.id === p.id;
        const eliminated = !lobby && p.hearts === 0;
        return <div key={p.id} className={`player ${p.id === view.turn && view.phase !== 'winner' ? 'current' : ''} ${eliminated ? 'eliminated' : ''}`}>
          <div className="avatar-slot">
            <Avatar player={p} />
            {reacting && <span key={effect?.id} className="reaction-float">{value.reaction}</span>}
          </div>
          <div className="player-info">
            <div className="player-name"><strong>{p.name}</strong>{view.me === p.id && <small>kamu</small>}{view.host === p.id && <span className="host" title="Host"><Crown size={14}/></span>}</div>
            <div className="player-status"><i className={p.online ? 'online' : ''}/>{p.left ? 'Keluar' : !p.online ? 'Terputus' : eliminated ? 'Eliminasi' : lobby ? 'Terhubung' : p.id === view.turn && view.phase !== 'winner' ? 'Sedang giliran' : 'Aktif'}</div>
          </div>
          {!lobby && <Hearts count={p.hearts} />}
        </div>;
      })}
      {lobby && Array.from({ length: MAX_PLAYERS - players.length }, (_, i) => <div className="player empty" key={i}><span className="avatar"><Plus size={17}/></span><span>Slot kosong</span></div>)}
    </div>
  </section>;
}

function Settings({ view, send }: { view: GameView; send: Send }) {
  const host = view.host === view.me;
  return <div className="room-settings">
    <h3>Tema permainan</h3>
    <div className="themes">{themes.map(theme => {
      const Icon = themeIcons[theme];
      return <button key={theme} type="button" disabled={!host} aria-pressed={view.theme === theme} className={view.theme === theme ? 'active' : ''} onClick={() => void send({ type: 'settings', theme, chaos: view.chaos })}><Icon size={20}/>{theme}</button>;
    })}</div>
    <div className="chaos-control">
      <Zap size={23} />
      <div><strong>Mode Chaos</strong><p>Kartu power-up dan kejutan tiap ronde.</p></div>
      <button className="switch" role="switch" aria-label="Mode Chaos" aria-checked={view.chaos} disabled={!host} onClick={() => void send({ type: 'settings', theme: view.theme, chaos: !view.chaos })}><span/></button>
    </div>
  </div>;
}

async function copyText(value: string, toast: (text: string) => void) {
  try {
    await navigator.clipboard.writeText(value);
    toast('Berhasil disalin.');
  } catch {
    toast('Penyalinan otomatis gagal. Salin kode room secara manual.');
  }
}

function Lobby({ view, send, toast }: { view: GameView; send: Send; toast: (text: string) => void }) {
  const ready = view.players.length >= MIN_PLAYERS && view.players.every(p => p.online);
  const link = new URL(location.href);
  link.searchParams.set('room', view.code);
  return <section className="panel stage lobby">
    <div className="stage-icon"><Users size={26} /></div>
    <h1>Ruang tunggu</h1>
    <p>Bagikan kode ini ke temanmu.</p>
    <div className="invite"><strong>{view.code}</strong><button className="button secondary" onClick={() => void copyText(view.code, toast)}><Copy size={17} /> Salin kode</button></div>
    <button className="text-action" onClick={() => void copyText(link.toString(), toast)}>Salin link undangan</button>
    <Settings view={view} send={send} />
    {view.host === view.me ? <button className="button primary wide" disabled={!ready} onClick={() => void send({ type: 'start' })}><Zap size={18} /> Mulai permainan</button> : <p className="notice">Menunggu host memulai permainan.</p>}
    {!ready && <p className="hint">Butuh minimal {MIN_PLAYERS} pemain yang semuanya terhubung.</p>}
  </section>;
}

function Countdown({ view, offset, settings }: { view: GameView; offset: number; settings: SoundSettings }) {
  const deadline = view.deadline ?? view.reconnectUntil;
  const [now, setNow] = useState(Date.now);
  const tick = useRef<{ step: number; seconds: number } | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!deadline) return;
    const id = window.setInterval(() => setNow(Date.now()), 75);
    return () => window.clearInterval(id);
  }, [deadline]);
  const left = deadline ? Math.max(0, Math.ceil((deadline - now - offset) / 1000)) : null;
  const urgent = view.phase === 'answer' && !view.reconnectUntil && left !== null && left <= 5;
  useEffect(() => {
    if (urgent && left !== null && (tick.current?.seconds !== left || tick.current.step !== view.step)) {
      sound(left === 0 ? 'zero' : 'tick', settings);
      tick.current = { step: view.step, seconds: left };
    }
  }, [left, urgent, view.step, settings]);
  if (left === null) return null;
  return <div aria-label={`${left} detik tersisa`} className={`countdown ${urgent ? 'urgent' : ''} ${urgent && left === 0 ? 'expired' : ''}`}><Timer size={18}/>{String(left).padStart(2, '0')}<small>dtk</small></div>;
}

function PowerCard({ view, send }: { view: GameView; send: Send }) {
  const [target, setTarget] = useState('');
  if (!view.card || view.phase === 'winner' || view.phase === 'lobby') return null;
  const [title, desc] = cardText[view.card];
  const alive = view.players.some(p => p.id === view.me && p.hearts > 0 && !p.left);
  const usable = alive && !view.cardUsed && (
    (view.card === 'time' && view.phase === 'answer' && view.turn === view.me && view.deadline !== null) ||
    (view.card === 'appeal' && view.phase === 'result' && view.turn === view.me && view.result?.appeal) ||
    (view.card === 'sabotage' && !!target)
  );
  return <section className={`panel power ${view.cardUsed ? 'spent' : ''}`}>
    <div className="power-icon"><Sparkles size={22}/></div>
    <div><div className="power-kicker">POWER-UP</div><h3>{title}</h3><p>{view.cardUsed ? 'Sudah digunakan' : desc}</p></div>
    {!view.cardUsed && alive && view.card === 'sabotage' && <select aria-label="Target sabotase" value={target} onChange={event => setTarget(event.target.value)}><option value="">Pilih lawan</option>{view.players.filter(p => p.id !== view.me && p.hearts > 0 && !p.left).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
    {!view.cardUsed && alive && view.card !== 'shield' && <button className="button secondary" disabled={!usable} onClick={() => void send({ type: 'card', step: view.step, target: view.card === 'sabotage' ? target : undefined })}>Pakai kartu</button>}
  </section>;
}

function MatchStats({ view, send }: { view: GameView; send: Send }) {
  const winner = view.players.find(p => p.id === view.winner);
  const remaining = view.players.filter(p => !p.left);
  const ready = remaining.length >= MIN_PLAYERS && remaining.every(p => p.online);
  return <section className="panel stage winner">
    <div className="stage-icon trophy"><Trophy size={31}/></div>
    <h1>{winner ? winner.name : 'Pertandingan selesai'}</h1>
    <p>{winner ? 'Pemenang ABC DUARR!' : 'Semua pemain gugur.'} · {view.round} ronde</p>
    {view.result?.outcome === 'wrong' && view.result.eliminated && <VoteBreakdown result={view.result}/>}
    <div className="stats">
      <h3>Statistik pertandingan</h3>
      <div className="table-wrap"><table><thead><tr>{['Pemain', 'Benar', 'Salah', 'Netral', 'Waktu habis', 'Sabotase', 'Kartu'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{view.players.map(p => <tr key={p.id}><th scope="row">{p.name}</th><td>{p.stats.correct}</td><td>{p.stats.wrong}</td><td>{p.stats.neutral}</td><td>{p.stats.timeouts}</td><td>{p.stats.sabotages}</td><td>{p.stats.powers}</td></tr>)}</tbody></table></div>
    </div>
    <div className="elimination-list"><h3>Urutan eliminasi</h3><ol>{view.eliminations.map(id => <li key={id}>{view.players.find(p => p.id === id)?.name}</li>)}</ol>{!view.eliminations.length && <p>Belum ada pemain tereliminasi.</p>}</div>
    <Settings view={view} send={send} />
    {view.me === view.host ? <button className="button primary wide" disabled={!ready} onClick={() => void send({ type: 'rematch' })}><Zap size={18} /> Main lagi</button> : <p className="notice">Host bisa memulai pertandingan ulang.</p>}
    {!ready && <p className="hint">Butuh minimal {MIN_PLAYERS} pemain yang semuanya terhubung untuk bermain lagi.</p>}
  </section>;
}

const outcomeText = { correct: 'Jawaban benar!', wrong: 'Jawaban salah', neutral: 'Voting netral', timeout: 'Waktu habis!' };

function VoteBreakdown({ result }: { result: Result }) {
  return <div className="finger-summary"><span className="chip green">{result.correct} benar</span><span className="chip red">{result.wrong} salah</span><span className="chip">{result.abstain} abstain</span></div>;
}

function Arena({ view, send, offset, settings }: { view: GameView; send: Send; offset: number; settings: SoundSettings }) {
  const me = view.players.find(p => p.id === view.me)!;
  const current = view.players.find(p => p.id === view.turn);
  const mine = view.turn === view.me;
  const [word, setWord] = useState('');
  useEffect(() => { setWord(''); }, [view.step]);
  const [eventName, eventDesc] = view.event ? chaosText[view.event] : ['', ''];
  const ThemeIcon = themeIcons[view.theme];

  return <section className="panel stage arena">
    <div className="round-header"><div className="round-label"><span>RONDE {view.round}</span><b><ThemeIcon size={17}/>{view.theme}</b></div><Countdown view={view} offset={offset} settings={settings}/></div>
    {view.event && <div key={`${view.round}-chaos`} className="chaos-banner"><Zap size={19}/><div><strong>{eventName}{view.forbidden ? ` · ${view.forbidden}` : ''}</strong><span>{eventDesc}</span></div></div>}
    {me.hearts === 0 && <div className="notice spectator">Kamu tereliminasi. Kamu masih bisa menonton.</div>}
    {view.reconnectUntil && <div className="notice">Giliran dijeda. Menunggu {current?.name} kembali.</div>}
    <div key={view.step} className={`phase phase-${view.phase}`}>
      {view.phase === 'fingers' && <>
        <div className="stage-icon"><Hand size={30}/></div>
        <h1>Adu jari!</h1>
        <p>{me.hearts === 0 ? 'Pemain sedang memilih jumlah jari.' : view.myFingers ? `Kamu mengunci pilihan ${view.myFingers}.` : 'Pilih jumlah jari untuk menentukan huruf ronde ini.'}</p>
        {me.hearts > 0 && <div className="finger-buttons">{Array.from({ length: 10 }, (_, i) => i + 1).map(value => <button key={value} disabled={view.myFingers !== null} className={view.myFingers === value ? 'picked' : ''} onClick={() => void send({ type: 'fingers', step: view.step, value })}>{value}</button>)}</div>}
        <div className="notice">{view.fingerCount}/{view.fingerGoal} pemain sudah memilih</div>
      </>}
      {view.phase === 'reveal' && <>
        <h1>Huruf ronde ini</h1>
        <div className="letter reveal-letter">{view.letter}</div>
        <p>Total {view.total} jari</p>
        <div className="finger-summary">{view.fingers.map(f => <span className="chip" key={f.id}>{view.players.find(p => p.id === f.id)?.name} · {f.value}{f.auto ? ' (otomatis)' : ''}</span>)}</div>
      </>}
      {view.phase === 'answer' && <>
        <div className="letter">{view.letter}</div>
        <h1>{mine ? 'Giliranmu!' : `Giliran ${current?.name}`}</h1>
        <p>{mine ? `Tulis jawaban bertema ${view.theme.toLowerCase()} yang dimulai dengan ${view.letter}.` : `Menunggu jawaban bertema ${view.theme.toLowerCase()}.`}</p>
        {current && <Hearts count={current.hearts}/>}
        {mine && !view.reconnectUntil && <form className="answer-form" onSubmit={event => { event.preventDefault(); void send({ type: 'answer', step: view.step, word }); }}>
          <input aria-label="Jawaban" autoFocus autoComplete="off" maxLength={40} placeholder="Ketik jawabanmu" required value={word} onChange={event => setWord(event.target.value)} />
          <button className="button primary">Kirim jawaban</button>
        </form>}
        {view.turnOrder.length > 1 && <p className="hint">Berikutnya: {view.players.find(p => p.id === view.turnOrder[1])?.name}</p>}
      </>}
      {view.phase === 'voting' && <>
        <h1>{view.revote ? 'Voting ulang' : 'Saatnya voting'}</h1>
        <div className="word">{view.word}</div><p>Jawaban dari {current?.name} untuk tema {view.theme.toLowerCase()}.</p>
        {view.canVote ? <div className="vote-buttons">
          <button className="button vote-yes" onClick={() => void send({ type: 'vote', step: view.step, vote: 'correct' })}><Check size={21}/> Benar</button>
          <button className="button vote-no" onClick={() => void send({ type: 'vote', step: view.step, vote: 'wrong' })}><X size={21}/> Salah</button>
        </div> : <p className="hint">{view.myVote ? 'Suaramu sudah dikunci.' : 'Menunggu suara pemain lain.'}</p>}
        <div className="notice">{view.voteCount}/{view.voteGoal} suara masuk</div>
      </>}
      {view.phase === 'result' && view.result && <div className={view.result.outcome === 'timeout' ? 'timeout-reveal' : ''}>
        <div className={`stage-icon result-icon ${view.result.outcome}`}>{view.result.outcome === 'correct' ? <Check size={30}/> : view.result.outcome === 'timeout' ? <Timer size={30}/> : view.result.outcome === 'wrong' ? <X size={30}/> : <Users size={30}/>}</div>
        <h1>{outcomeText[view.result.outcome]}</h1>
        {view.word && <div className="word">{view.word}</div>}
        {view.result.outcome !== 'timeout' && <VoteBreakdown result={view.result}/>}
        <p>{view.result.eliminated ? `${current?.name} tereliminasi!` : view.result.appeal ? 'Banding tersedia sebelum hasil ditetapkan.' : view.result.damage ? `${current?.name} kehilangan ${view.result.damage} nyawa.` : 'Nyawa tetap utuh.'}</p>
      </div>}
    </div>
  </section>;
}

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={close} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="dialog-head"><h2>{title}</h2><button className="icon-button" aria-label="Tutup" onClick={close}><X size={21}/></button></div>
    {children}
  </dialog>;
}

function App() {
  const { view, connected, restoring, effect, message, offset, toast, send } = useGame();
  const [modal, setModal] = useState<ModalName>(null);
  const [settings, setSettings] = useState(getSound);
  const lastPhase = useRef('');
  const lastEffect = useRef(0);

  useEffect(() => {
    localStorage.setItem('duarr:sound', JSON.stringify(settings));
    if (settings.music) {
      const interval = music(settings.volume);
      return () => window.clearInterval(interval);
    }
  }, [settings]);
  useEffect(() => {
    if (!view) return;
    const phase = `${view.code}-${view.step}`;
    if (phase !== lastPhase.current) {
      if (view.phase === 'reveal' || view.phase === 'winner') sound(view.phase, settings);
      if (view.phase === 'result' && view.result?.outcome === 'timeout') sound('zero', settings);
      lastPhase.current = phase;
    }
  }, [view, settings]);
  useEffect(() => {
    if (effect && effect.id !== lastEffect.current) {
      lastEffect.current = effect.id;
      if (effect.value.type === 'card') sound('card', settings);
    }
  }, [effect, settings]);

  const me = view?.players.find(p => p.id === view.me);
  const [effectMessage, setEffectMessage] = useState('');
  useEffect(() => {
    if (!effect || effect.value.type === 'reaction') return;
    const value = effect.value;
    const name = view?.players.find(p => p.id === value.id)?.name;
    if (!name) return;
    setEffectMessage(value.type === 'elimination' ? `${name} tereliminasi!` : `${name} memakai ${cardText[value.card][0]}.`);
    const timeout = window.setTimeout(() => setEffectMessage(''), 2400);
    return () => window.clearTimeout(timeout);
  }, [effect?.id]);

  return <div onPointerDown={unlockSound} onKeyDown={unlockSound}>
    <header className="topbar"><div className="wrap top-inner"><Brand/><div className="top-actions">
      <button className="top-action" aria-label="Cara main" onClick={() => setModal('help')}><CircleHelp size={19}/><span>Cara main</span></button>
      <button className="icon-button" aria-label="Pengaturan suara" onClick={() => setModal('sound')}><Settings2 size={20}/></button>
      {view && <button className="icon-button" aria-label="Keluar dari room" onClick={() => setModal('leave')}><LogOut size={19}/></button>}
    </div></div></header>
    {!view ? <Landing connected={connected} restoring={restoring} send={send}/> : <main className="match wrap">
      <div className="room-bar"><span><Radio size={18}/> Room <strong>{view.code}</strong></span><span className="network"><i className={connected && !restoring ? 'online' : ''}/>{connected && !restoring ? 'Terhubung' : 'Menyambungkan kembali…'}</span></div>
      <div className="match-grid">
        <div className="main-column">
          {view.phase === 'lobby' ? <Lobby view={view} send={send} toast={toast}/> : view.phase === 'winner' ? <MatchStats view={view} send={send}/> : <Arena view={view} send={send} offset={offset} settings={settings}/>}
          {view.phase !== 'lobby' && view.phase !== 'winner' && <PowerCard view={view} send={send}/>}
          {me && (me.hearts > 0 || view.phase === 'winner') && <div className="reactions" aria-label="Reaksi cepat">{reactions.map(reaction => <button key={reaction} aria-label={`Kirim reaksi ${reaction}`} onClick={() => void send({ type: 'reaction', reaction })}>{reaction}</button>)}</div>}
        </div>
        <Roster view={view} effect={effect}/>
      </div>
    </main>}
    {(message || effectMessage) && <div className="toast" role="status">{message?.text ?? effectMessage}</div>}
    {modal === 'help' && <Dialog title="Cara main" close={() => setModal(null)}><ol className="rules">
      <li>Kumpulkan {MIN_PLAYERS}–{MAX_PLAYERS} pemain. Host memilih tema dan bisa mengaktifkan Mode Chaos.</li>
      <li>Pilih 1–10 jari. Total semua pilihan menentukan huruf untuk ronde itu.</li>
      <li>Saat giliranmu, jawab sesuai tema dengan huruf yang ditentukan. Jawaban yang pernah dipakai tidak bisa diulang.</li>
      <li>Pemain lain menilai jawabanmu. Jawaban salah atau kehabisan waktu mengurangi nyawa. Pemain terakhir yang bertahan menang.</li>
    </ol></Dialog>}
    {modal === 'sound' && <Dialog title="Pengaturan suara" close={() => setModal(null)}><div className="sound-options">
      <label><span><AudioLines size={19}/> Musik latar</span><input type="checkbox" checked={settings.music} onChange={event => setSettings({ ...settings, music: event.target.checked })}/></label>
      <label><span><Zap size={19}/> Efek suara</span><input type="checkbox" checked={settings.effects} onChange={event => setSettings({ ...settings, effects: event.target.checked })}/></label>
      <label htmlFor="volume">Volume <strong>{settings.volume}%</strong></label>
      <input id="volume" type="range" min="0" max="100" value={settings.volume} onChange={event => setSettings({ ...settings, volume: Number(event.target.value) })}/>
    </div></Dialog>}
    {modal === 'leave' && <Dialog title="Keluar dari room?" close={() => setModal(null)}><p>Keluar saat permainan berlangsung akan mengakhiri giliranmu dan mengeliminasimu.</p><div className="dialog-actions"><button className="button secondary" onClick={() => setModal(null)}>Batal</button><button className="button vote-no" onClick={async () => { if (await send({ type: 'leave' })) setModal(null); }}>Keluar</button></div></Dialog>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
