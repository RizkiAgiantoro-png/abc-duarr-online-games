import { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Action, ClientEvents, Effect, GameView, ServerEvents, Session } from '../shared/game.js';

const socket: Socket<ServerEvents, ClientEvents> = io(import.meta.env.VITE_SOCKET_URL || undefined, { autoConnect: false });
const sessionKey = 'duarr:session';

function readSession(): Session | null {
  try {
    const session = JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null');
    return typeof session?.code === 'string' && typeof session?.token === 'string' ? session : null;
  } catch { return null; }
}

function request(action: Action) {
  return socket.timeout(8000).emitWithAck('action', action);
}

export function useGame() {
  const [view, setView] = useState<GameView | null>(null);
  const [connected, setConnected] = useState(false);
  const [restoring, setRestoring] = useState(() => !!readSession());
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const [effect, setEffect] = useState<{ value: Effect; id: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const toast = useCallback((text: string) => setMessage({ text, id: performance.now() }), []);

  useEffect(() => {
    function sync() {
      if (!socket.connected) return;
      const start = Date.now();
      socket.timeout(4000).emit('clock', (error, serverNow) => {
        if (!error) setOffset(serverNow - (start + Date.now()) / 2);
      });
    }

    async function connect() {
      setConnected(true);
      sync();
      const saved = readSession();
      if (!saved) return;
      try {
        const reply = await request({ type: 'resume', ...saved });
        if (!reply.ok) {
          sessionStorage.removeItem(sessionKey);
          setView(null);
          toast(reply.error);
        }
      } catch {
        toast('Koneksi belum pulih. Coba lagi sebentar.');
        if (socket.connected) socket.disconnect().connect();
      } finally {
        setRestoring(false);
      }
    }

    function disconnect(reason: string) {
      setConnected(false);
      if (reason === 'io server disconnect') {
        sessionStorage.removeItem(sessionKey);
        setRestoring(false);
        setView(null);
        toast('Sesi ini sudah dibuka di tab lain.');
        socket.connect();
      }
    }

    function receiveState(state: GameView) {
      setView(state);
      setRestoring(false);
    }

    function receiveEffect(value: Effect) {
      setEffect({ value, id: performance.now() });
    }

    socket.on('connect', connect).on('disconnect', disconnect).on('state', receiveState).on('effect', receiveEffect);
    socket.connect();
    const clock = window.setInterval(sync, 10_000);
    return () => {
      window.clearInterval(clock);
      socket.off('connect', connect).off('disconnect', disconnect).off('state', receiveState).off('effect', receiveEffect);
      socket.disconnect();
    };
  }, [toast]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 3600);
    return () => window.clearTimeout(timer);
  }, [message]);

  const send = useCallback(async (action: Action) => {
    if (!socket.connected) {
      toast('Koneksi ke server terputus.');
      return false;
    }
    try {
      const reply = await request(action);
      if (!reply.ok) {
        toast(reply.error);
        return false;
      }
      if (reply.session) sessionStorage.setItem(sessionKey, JSON.stringify(reply.session));
      if (action.type === 'leave') {
        sessionStorage.removeItem(sessionKey);
        setView(null);
      }
      return true;
    } catch {
      toast('Server belum merespons. Coba lagi.');
      return false;
    }
  }, [toast]);

  return { view, connected, restoring, message, effect, offset, toast, send };
}
