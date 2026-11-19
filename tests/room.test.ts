import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { events, type Effect } from '../shared/game.js';
import { alphabetFrom, durations, Room, tally } from '../server/room.js';

function game(t: TestContext, random: () => number = () => 0.99, chaos = false, playerCount = 4) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10_000 });
  const effects: Effect[] = [];
  const room = new Room('ABC234', () => {}, effect => effects.push(effect), random);
  t.after(() => room.dispose());
  const players = ['Ayu', 'Bima', 'Citra', 'Dodi', 'Eka'].slice(0, playerCount).map((name, i) => room.add(name, String(i)));
  const ids = players.map(p => p.id);
  const view = () => room.view(ids[0]);
  room.action(ids[0], { type: 'settings', theme: 'Hewan', chaos });
  room.action(ids[0], { type: 'start' });
  function fingers() {
    for (const p of view().players.filter(p => p.hearts > 0)) {
      room.action(p.id, { type: 'fingers', step: view().step, value: 1 });
    }
    t.mock.timers.tick(durations.reveal);
  }
  function answer(word: string) {
    room.action(view().turn!, { type: 'answer', step: view().step, word });
  }
  function vote(vote: 'correct' | 'wrong', limit = Infinity) {
    for (const id of ids.filter(id => room.view(id).canVote).slice(0, limit)) {
      room.action(id, { type: 'vote', step: view().step, vote });
    }
  }
  function card(id = view().turn!, target?: string) {
    room.action(id, { type: 'card', step: view().step, target });
  }
  return { room, players, ids, view, effects, fingers, answer, vote, card };
}

test('alfabet berulang, voting mayoritas, seri, dan kuorum', () => {
  assert.deepEqual([1, 9, 26, 27, 30, 50].map(alphabetFrom), ['A', 'I', 'Z', 'A', 'D', 'X']);
  assert.equal(tally(['correct', 'correct', 'wrong'], 3).outcome, 'correct');
  assert.equal(tally(['correct', 'wrong'], 3).outcome, 'wrong');
  assert.equal(tally(['wrong'], 4).outcome, 'neutral');
});

test('dua pemain bisa bermain, voting dengan satu pemilih, dan rematch', t => {
  const { room, ids, view, fingers, answer, vote } = game(t, () => 0.99, false, 2);
  assert.equal(view().fingerGoal, 2);
  for (let round = 1; round <= 3; round++) {
    fingers();
    assert.equal(view().letter, 'B');
    while (view().phase === 'answer') {
      const hostTurn = view().turn === ids[0];
      answer(hostTurn ? `Burung ${round}` : `Banteng ${round}`);
      assert.equal(view().voteGoal, 1);
      vote(hostTurn ? 'correct' : 'wrong');
      if (view().phase === 'winner') break;
      assert.equal(view().result?.outcome, hostTurn ? 'correct' : 'wrong');
      t.mock.timers.tick(durations.result);
    }
  }
  assert.equal(view().winner, ids[0]);
  assert.deepEqual(view().eliminations, [ids[1]]);
  room.action(ids[0], { type: 'rematch' });
  assert.equal(view().phase, 'fingers');
  assert.equal(view().fingerGoal, 2);
  assert.ok(view().players.every(p => p.hearts === 3));
});

test('tiga pemain bisa memulai pertandingan', t => {
  const { view } = game(t, () => 0.99, false, 3);
  assert.equal(view().phase, 'fingers');
  assert.equal(view().fingerGoal, 3);
});

test('jari otomatis, giliran berputar, validasi huruf dan duplikat', t => {
  const { room, ids, view, fingers, answer, vote } = game(t);
  room.action(ids[0], { type: 'fingers', step: view().step, value: 10 });
  assert.equal(room.view(ids[1]).fingers.length, 0);
  assert.equal(room.view(ids[1]).myFingers, null);
  t.mock.timers.tick(durations.fingers);
  assert.equal(view().letter, 'N');
  assert.equal(view().fingers.filter(f => f.auto).length, 3);
  t.mock.timers.tick(durations.reveal);
  const first = view().turn;
  assert.throws(() => answer('Kucing'), /dimulai dengan N/);
  answer('  Naga   Laut  ');
  assert.equal(view().word, 'Naga Laut');
  assert.throws(() => room.action(first!, { type: 'vote', step: view().step, vote: 'correct' }), /tidak bisa/);
  vote('correct');
  assert.equal(view().result?.outcome, 'correct');
  t.mock.timers.tick(durations.result);
  assert.throws(() => answer('nAGA lAUT'), /sudah dipakai/);
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(durations.answer);
    assert.equal(view().result?.outcome, 'timeout');
    t.mock.timers.tick(durations.result);
  }
  assert.equal(view().round, 2);
  fingers();
  assert.notEqual(view().turn, first);
});

test('voting timeout menyembunyikan suara dan mencatat abstain', t => {
  const { room, ids, view, fingers, answer, vote } = game(t);
  fingers();
  answer('Domba');
  const voter = ids.find(id => room.view(id).canVote)!;
  vote('wrong', 1);
  assert.equal(room.view(voter).myVote, 'wrong');
  assert.equal(view().myVote, null);
  assert.equal(view().result, null);
  t.mock.timers.tick(durations.voting);
  assert.equal(view().result?.outcome, 'neutral');
  assert.equal(view().result?.abstain, 2);
  assert.equal(view().players[0].hearts, 3);
});

test('perisai menyerap satu poin secara otomatis', t => {
  const { view, effects, fingers, answer, vote } = game(t, () => 0, true);
  fingers();
  const target = view().turn;
  answer('Domba');
  vote('wrong');
  assert.equal(view().result?.damage, 0);
  assert.ok(effects.some(e => e.type === 'card' && e.id === target && e.card === 'shield'));
  assert.equal(view().players.find(p => p.id === target)?.stats.powers, 1);
});

test('waktu ekstra menambah 10 detik tepat sekali', t => {
  const { view, fingers, card } = game(t, () => 0.3, true);
  fingers();
  const deadline = view().deadline!;
  card();
  assert.equal(view().deadline, deadline + 10_000);
  assert.throws(() => card(), /Kartu tidak tersedia/);
});

test('sabotase mengurangi waktu giliran lawan berikutnya', t => {
  const { view, fingers, card } = game(t, () => 0.65, true);
  fingers();
  const [first, next] = view().turnOrder;
  assert.throws(() => card(first, first), /Pilih satu lawan/);
  card(first, next);
  t.mock.timers.tick(durations.answer);
  t.mock.timers.tick(durations.result);
  assert.equal(view().turn, next);
  assert.equal(view().deadline! - Date.now(), 25_000);
  assert.equal(view().players.find(p => p.id === first)?.stats.sabotages, 1);
});

test('banding menunda penalti dan voting kedua menjadi hasil final', t => {
  const { view, fingers, answer, vote, card } = game(t, () => 0.9, true);
  fingers();
  answer('Domba');
  vote('wrong');
  assert.equal(view().result?.appeal, true);
  assert.equal(view().players[0].hearts, 3);
  card();
  assert.equal(view().phase, 'voting');
  assert.equal(view().revote, true);
  vote('correct');
  assert.equal(view().result?.outcome, 'correct');
  assert.equal(view().players[0].stats.correct, 1);
  assert.equal(view().players[0].stats.wrong, 0);
});

for (const [index, event] of events.entries()) {
  test(`event ${event} mengubah aturan ronde`, t => {
    let draws = 0;
    const random = () => {
      draws++;
      if (draws === 9) return (index + 0.1) / events.length;
      if (draws === 7) return 0.9;
      return 0;
    };
    const { view, ids, fingers, answer, vote } = game(t, random, true);
    assert.equal(view().event, event);
    fingers();
    if (event === 'reverse') assert.deepEqual(view().turnOrder, [ids[0], ids[3], ids[1], ids[2]]);
    if (event === 'speed') assert.equal(view().deadline! - Date.now(), 15_000);
    if (event === 'panic') assert.equal(view().deadline! - Date.now(), 20_000);
    if (event === 'forbidden') assert.throws(() => answer('Dara'), /dilarang/);
    answer('Dodo');
    if (event === 'quick') assert.equal(view().deadline! - Date.now(), 7_000);
    vote('wrong');
    assert.equal(view().result?.damage, event === 'double' ? 1 : 0);
    t.mock.timers.tick(durations.result);
    for (let i = 0; i < 3; i++) {
      t.mock.timers.tick(event === 'speed' ? durations.speed : event === 'panic' ? durations.panic : durations.answer);
      t.mock.timers.tick(durations.result);
    }
    assert.equal(view().round, 2);
    assert.ok(view().event);
    assert.notEqual(view().event, event);
  });
}

test('host berpindah, timer dijeda, reconnect mempertahankan pemain hingga grace habis', t => {
  const { room, ids, view, players, fingers } = game(t);
  fingers();
  assert.equal(view().turn, ids[0]);
  t.mock.timers.tick(5_000);
  room.disconnect(ids[0], '0');
  assert.equal(view().host, ids[1]);
  assert.equal(view().deadline, null);
  assert.equal(view().reconnectUntil, Date.now() + 30_000);
  t.mock.timers.tick(20_000);
  assert.equal(room.resume(players[0].token, 'new').player.id, ids[0]);
  assert.equal(view().deadline, Date.now() + 25_000);
  assert.equal(view().host, ids[1]);
  room.disconnect(ids[0], 'new');
  t.mock.timers.tick(30_000);
  assert.equal(view().players[0].hearts, 0);
  assert.equal(view().turn, ids[1]);
  assert.throws(() => room.resume(players[0].token, 'late'), /Sesi sudah berakhir/);
});

test('eliminasi, pemenang terakhir, dan rematch', t => {
  const { room, ids, view, fingers, answer, vote } = game(t);
  for (let round = 1; round <= 3; round++) {
    fingers();
    while (view().phase === 'answer') {
      if (view().turn === ids[0]) {
        answer(`${view().letter}ijawab ${round}`);
        vote('correct');
      } else t.mock.timers.tick(durations.answer);
      if (view().phase === 'winner') break;
      t.mock.timers.tick(durations.result);
    }
  }
  assert.equal(view().phase, 'winner');
  assert.equal(view().winner, ids[0]);
  assert.equal(view().eliminations.length, 3);
  assert.throws(() => room.action(ids[1], { type: 'fingers', value: 1, step: view().step }), /menonton/);
  room.action(ids[0], { type: 'settings', theme: 'Makanan', chaos: true });
  room.action(ids[0], { type: 'rematch' });
  assert.equal(view().phase, 'fingers');
  assert.equal(view().theme, 'Makanan');
  assert.equal(view().round, 1);
  assert.deepEqual(view().eliminations, []);
  assert.ok(view().players.every(p => p.hearts === 3 && p.stats.correct === 0));
  assert.ok(view().card);
});
