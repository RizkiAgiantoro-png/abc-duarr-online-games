import { randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientEvents, ServerEvents, Session } from '../shared/game.js';
import { durations, GameError, nickname, Room } from './room.js';

interface Member { room: Room; id: string }
const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const maxRooms = 500;

export function createApp(origins: string[] = [], time = durations) {
  const app = express();
  const http = createServer(app);
  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, { member?: Member }>(http, {
    maxHttpBufferSize: 4096,
    cors: { origin: origins },
    allowRequest(req, done) {
      const origin = req.headers.origin;
      const host = req.headers.host;
      done(null, !origin || origin === `http://${host}` || origin === `https://${host}` || origins.includes(origin));
    },
  });
  const rooms = new Map<string, Room>();

  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  const frontend = resolve('dist/web');
  app.use(express.static(frontend));

  function publish(room: Room) {
    if (room.empty) {
      room.dispose();
      rooms.delete(room.code);
      return;
    }
    for (const player of room.players.values()) {
      if (player.socket) io.to(player.socket).emit('state', room.view(player.id));
    }
  }

  function makeRoom() {
    if (rooms.size >= maxRooms) throw new GameError('Server penuh. Coba lagi sebentar.');
    let code: string;
    do {
      code = Array.from({ length: 6 }, () => codeChars[randomInt(codeChars.length)]).join('');
    } while (rooms.has(code));
    const room = new Room(code, () => publish(room), effect => io.to(code).emit('effect', effect), Math.random, time);
    rooms.set(code, room);
    return room;
  }

  function findRoom(code: unknown) {
    if (typeof code !== 'string' || !/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new GameError('Masukkan kode room 6 karakter.');
    const room = rooms.get(code);
    if (!room) throw new GameError('Room tidak ditemukan atau sudah ditutup.');
    return room;
  }

  io.on('connection', socket => {
    let windowStarted = Date.now();
    let requests = 0;

    socket.on('clock', reply => {
      if (typeof reply === 'function') reply(Date.now());
    });

    socket.on('action', (action, reply) => {
      if (typeof reply !== 'function') return;
      if (Date.now() - windowStarted >= 1_000) {
        windowStarted = Date.now();
        requests = 0;
      }
      if (++requests > 15) return reply({ ok: false, error: 'Terlalu banyak aksi. Coba lagi sebentar.' });

      try {
        if (!action || typeof action !== 'object' || typeof action.type !== 'string') throw new GameError('Aksi tidak valid.');
        const member = socket.data.member;
        let session: Session | undefined;

        switch (action.type) {
          case 'create':
          case 'join':
          case 'resume': {
            if (member) throw new GameError('Kamu sudah berada di room.');
            const name = action.type === 'resume' ? null : nickname(action.name);
            const room = action.type === 'create' ? makeRoom() : findRoom(action.code);
            if (action.type === 'resume' && (typeof action.token !== 'string' || action.token.length !== 36)) {
              throw new GameError('Sesi tidak valid.');
            }
            const { player, previous } = action.type === 'resume'
              ? room.resume(action.token, socket.id)
              : { player: room.add(name!, socket.id), previous: null };
            if (previous && previous !== socket.id) io.sockets.sockets.get(previous)?.disconnect();
            socket.data.member = { room, id: player.id };
            void socket.join(room.code);
            session = { code: room.code, token: player.token };
            publish(room);
            break;
          }
          case 'leave':
            if (member) {
              delete socket.data.member;
              void socket.leave(member.room.code);
              member.room.disconnect(member.id, socket.id, true);
            }
            break;
          default:
            if (!member) throw new GameError('Masuk ke room dulu.');
            member.room.action(member.id, action);
        }

        reply({ ok: true, session });
      } catch (error) {
        if (!(error instanceof GameError)) console.error(error);
        reply({ ok: false, error: error instanceof GameError ? error.message : 'Ada gangguan pada server. Coba lagi.' });
      }
    });

    socket.on('disconnect', () => {
      const member = socket.data.member;
      if (member) member.room.disconnect(member.id, socket.id);
    });
  });

  return {
    http,
    async close() {
      await io.close();
      for (const room of rooms.values()) room.dispose();
      rooms.clear();
    },
  };
}
