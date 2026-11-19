export interface SoundSettings { music: boolean; effects: boolean; volume: number }
const fallback: SoundSettings = { music: false, effects: true, volume: 45 };

export function getSound(): SoundSettings {
  try {
    const saved = JSON.parse(localStorage.getItem('duarr:sound') ?? 'null');
    return saved && typeof saved.music === 'boolean' && typeof saved.effects === 'boolean' &&
      Number.isFinite(saved.volume) && saved.volume >= 0 && saved.volume <= 100 ? saved : fallback;
  } catch { return fallback; }
}

let context: AudioContext | undefined;
export function unlockSound() {
  if (!window.AudioContext) return;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume().catch(() => {});
}

function note(hz: number, delay: number, length: number, volume: number, wave: OscillatorType) {
  if (!context || context.state !== 'running' || volume <= 0) return;
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = wave;
  oscillator.frequency.value = hz;
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, start + length);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}

export function sound(kind: 'tick' | 'zero' | 'reveal' | 'card' | 'winner', settings: SoundSettings) {
  if (!settings.effects) return;
  const notes = {
    tick: [620], zero: [210, 150], reveal: [392, 494, 659],
    card: [520, 780], winner: [392, 523, 659, 784],
  };
  notes[kind].forEach((hz, i) => note(hz, i * 0.09, 0.13, settings.volume / 1000, 'triangle'));
}

export function music(volume: number) {
  const melody = [146.83, 0, 220, 261.63, 130.81, 0, 196, 220, 155.56, 0, 233.08, 293.66, 130.81, 196, 0, 261.63];
  let beat = 0;
  return window.setInterval(() => {
    const hz = melody[beat++ % melody.length];
    if (hz) note(hz, 0, 0.18, volume / 2200, 'triangle');
  }, 245);
}
