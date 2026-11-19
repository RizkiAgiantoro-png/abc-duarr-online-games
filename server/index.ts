import { createApp } from './app.js';

const port = Number(process.env.PORT ?? '3000');
const origins = (process.env.CLIENT_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
const app = createApp(origins);

app.http.listen(port, '0.0.0.0', () => console.log(`ABC DUARR aktif di port ${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close(); });
}
