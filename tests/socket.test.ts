import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import type { Action, ClientEvents, GameView, ServerEvents } from '../shared/game.js';
import { createApp } from '../server/app.js';
import { durations } from '../server/room.js';

test('lima klien WebSocket menyinkronkan room, jari, voting rahasia dan reconnect', { timeout: 10_000 }, async t => {
  const app = createApp([], { ...durations, reveal: 100, result: 160 });
  const clients: Socket<ServerEvents, ClientEvents>[] = [];
  t.after(async () => {
    for (const client of clients) client.disconnect();
    await app.close();
  });
  app.http.listen(0, '127.0.0.1');
  await once(app.http, 'listening');
  const url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  assert.equal((await fetch(url + '/healthz')).status, 200);

  async function connect() {
    const socket: Socket<ServerEvents, ClientEvents> = io(url, { transports: ['websocket'], reconnection: false });
    clients.push(socket);
    let state: GameView;
    socket.on('state', next => { state = next; });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return {
      socket,
      get state() { return state; },
      send: (action: Action) => socket.timeout(1800).emitWithAck('action', action),
      wait(predicate: (state: GameView) => boolean) {
        if (state && predicate(state)) return Promise.resolve(state);
        return new Promise<GameView>((resolve, reject) => {
          const timer = setTimeout(() => {
            socket.off('state', onState);
            reject(new Error(`Snapshot tidak tiba. Fase terakhir: ${state?.phase}`));
          }, 2000);
          function onState(next: GameView) {
            if (!predicate(next)) return;
            clearTimeout(timer);
            socket.off('state', onState);
            resolve(next);
          }
          socket.on('state', onState);
        });
      },
    };
  }

  const [a, b, c, d, e, spare] = await Promise.all(Array.from({ length: 6 }, connect));
  const created = await a.send({ type: 'create', name: 'Ayu' });
  assert.ok(created.ok && created.session);
  const { code, token } = created.session;
  const firstId = a.state.me;
  const join = (name: string): Action => ({ type: 'join', name, code });
  assert.equal((await a.send({ type: 'start' })).ok, false);
  assert.equal((await b.send(join('  '))).ok, false);
  assert.equal((await b.send(join('ayu'))).ok, false);
  for (const [client, name] of [[b, 'Bima'], [c, 'Citra'], [d, 'Dodi']] as const) {
    assert.equal((await client.send(join(name))).ok, true);
  }
  await a.wait(s => s.players.length === 4);
  assert.equal((await b.send({ type: 'start' })).ok, false);
  assert.equal((await e.send(join('Eka'))).ok, true);
  const full = await spare.send(join('Fani'));
  assert.ok(!full.ok && /penuh/.test(full.error));
  await a.wait(s => s.players.length === 5);
  assert.equal((await a.send({ type: 'settings', theme: 'Benda', chaos: false })).ok, true);
  assert.equal((await a.send({ type: 'start' })).ok, true);
  const group = [a, b, c, d, e];
  await Promise.all(group.map(client => client.wait(s => s.phase === 'fingers')));
  const step = a.state.step;
  assert.equal((await a.send({ type: 'fingers', step, value: 7 })).ok, true);
  await b.wait(s => s.fingerCount === 1);
  assert.equal(b.state.myFingers, null);
  assert.deepEqual(b.state.fingers, []);
  const picks = await Promise.all([b, c, d, e].map(client => client.send({ type: 'fingers', step, value: 5 })));
  assert.ok(picks.every(reply => reply.ok));
  const reveal = await a.wait(s => s.phase === 'reveal');
  assert.equal(reveal.letter, 'A');
  assert.equal(reveal.total, 27);
  await Promise.all(group.map(client => client.wait(s => s.phase === 'answer')));
  const current = group.find(client => client.state.turn === client.state.me)!;
  const voters = group.filter(client => client !== current);
  assert.equal((await current.send({ type: 'answer', step: current.state.step, word: '  Almari  ' })).ok, true);
  await Promise.all(group.map(client => client.wait(s => s.phase === 'voting')));
  const voteStep = a.state.step;
  assert.equal((await current.send({ type: 'vote', step: voteStep, vote: 'correct' })).ok, false);
  assert.equal((await voters[0].send({ type: 'vote', step: voteStep, vote: 'wrong' })).ok, true);
  await voters[1].wait(s => s.voteCount === 1);
  assert.equal(voters[1].state.myVote, null);
  assert.equal(voters[1].state.result, null);
  for (const [index, client] of voters.slice(1).entries()) {
    assert.equal((await client.send({ type: 'vote', step: voteStep, vote: index === 0 ? 'wrong' : 'correct' })).ok, true);
  }
  const result = await a.wait(s => s.phase === 'result');
  assert.equal(result.result?.outcome, 'wrong');
  assert.equal(result.result?.damage, 1);
  a.socket.disconnect();
  await b.wait(s => s.host === b.state.me && s.players.some(p => p.id === firstId && !p.online));
  const resumed = await spare.send({ type: 'resume', code, token });
  assert.ok(resumed.ok);
  assert.equal(spare.state.me, firstId);
  assert.equal(spare.state.players.length, 5);
  assert.equal(spare.state.host, b.state.me);
  const copied = await connect();
  const oldDisconnected = new Promise<void>(resolve => spare.socket.once('disconnect', () => resolve()));
  assert.ok((await copied.send({ type: 'resume', code, token })).ok);
  await oldDisconnected;
  assert.equal(copied.state.me, firstId);
  assert.equal(copied.state.players.length, 5);
});
