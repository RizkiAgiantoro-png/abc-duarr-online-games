import { BriefcaseBusiness, Cat, Clapperboard, Package, Utensils } from 'lucide-react';
import type { Card, ChaosEvent, Theme } from '../shared/game.js';

export const themeIcons = { Benda: Package, Pekerjaan: BriefcaseBusiness, Hewan: Cat, Anime: Clapperboard, Makanan: Utensils } satisfies Record<Theme, typeof Cat>;
export const chaosText: Record<ChaosEvent, [string, string]> = {
  reverse: ['Balik arah', 'Urutan pemain dibalik di ronde ini.'],
  speed: ['Ronde kilat', 'Cuma 15 detik untuk menjawab.'],
  double: ['Serangan ganda', 'Suara SALAH mengurangi dua nyawa.'],
  forbidden: ['Huruf terlarang', 'Huruf ini hanya boleh muncul sebagai huruf pertama.'],
  quick: ['Voting kilat', 'Cuma 7 detik untuk memberi suara.'],
  panic: ['Ronde panik', 'Cuma 20 detik untuk menjawab.'],
};
export const cardText: Record<Card, [string, string]> = {
  shield: ['Perisai', 'Otomatis menahan satu poin kerusakan.'],
  time: ['Waktu ekstra', 'Tambah 10 detik saat giliranmu.'],
  sabotage: ['Sabotase', 'Kurangi 5 detik dari giliran berikutnya seorang lawan.'],
  appeal: ['Banding', 'Minta voting ulang setelah jawabanmu dinilai salah.'],
};
