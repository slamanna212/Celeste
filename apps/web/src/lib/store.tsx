import type { PlayerStateDTO, QueueDTO, RadioNowPlaying, SessionDTO } from '@celeste/shared';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSessionEndedHandler } from './api';
import { interpolatePosition } from './time';

interface PanelState {
  session: SessionDTO | null;
  player: PlayerStateDTO | null;
  queue: QueueDTO | null;
  /** Latest radio now-playing pushed over SSE (player.radio is the snapshot). */
  radio: RadioNowPlaying | null;
  live: boolean;
  setQueue: (q: QueueDTO) => void;
}

const Ctx = createContext<PanelState | null>(null);

export function PanelProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDTO | null>(null);
  const [player, setPlayer] = useState<PlayerStateDTO | null>(null);
  const [queue, setQueue] = useState<QueueDTO | null>(null);
  const [radio, setRadio] = useState<RadioNowPlaying | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    setSessionEndedHandler(() => navigate('/ended', { replace: true }));
    return () => setSessionEndedHandler(() => {});
  }, [navigate]);

  useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const snapshot = () => {
      api
        .session()
        .then((s) => !closed && setSession(s))
        .catch(() => {});
      api
        .player()
        .then((p) => !closed && (setPlayer(p), setRadio(p.radio)))
        .catch(() => {});
      api
        .queue()
        .then((q) => !closed && setQueue(q))
        .catch(() => {});
    };

    const connect = () => {
      es = new EventSource('/api/events');
      es.onopen = () => {
        attempt = 0;
        setLive(true);
        // The stream pushes player + queue on connect but not the session; refetch it in case
        // the initial snapshot failed.
        api
          .session()
          .then((s) => !closed && setSession(s))
          .catch(() => {});
      };
      es.addEventListener('player', (e) => {
        const p = JSON.parse((e as MessageEvent<string>).data) as PlayerStateDTO;
        setPlayer(p);
        setRadio(p.radio);
      });
      es.addEventListener('queue', (e) =>
        setQueue(JSON.parse((e as MessageEvent<string>).data) as QueueDTO),
      );
      es.addEventListener('radio', (e) => {
        const r = JSON.parse((e as MessageEvent<string>).data) as RadioNowPlaying;
        setRadio(r);
        setPlayer((p) => (p ? { ...p, radio: r } : p));
      });
      es.addEventListener('session-ended', () => {
        closed = true;
        es?.close();
        navigate('/ended', { replace: true });
      });
      es.onerror = () => {
        setLive(false);
        es?.close();
        if (closed) return;
        // EventSource gives no status; probe the API so a dead session is detected (401 -> /ended via api layer).
        api.session().then(
          () => {
            const delay = Math.min(15000, 1000 * 2 ** attempt++);
            retry = setTimeout(() => {
              snapshot();
              connect();
            }, delay);
          },
          () => {
            const delay = Math.min(15000, 1000 * 2 ** attempt++);
            retry = setTimeout(connect, delay);
          },
        );
      };
    };

    snapshot();
    connect();
    return () => {
      closed = true;
      es?.close();
      clearTimeout(retry);
    };
  }, [navigate]);

  const value = useMemo(
    () => ({ session, player, queue, radio, live, setQueue }),
    [session, player, queue, radio, live],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePanel(): PanelState {
  const v = useContext(Ctx);
  if (!v) throw new Error('PanelProvider missing');
  return v;
}

/** Interpolated playback position, ticking ~4x/s while playing. */
export function usePosition(player: PlayerStateDTO | null): number {
  const [now, setNow] = useState(() => Date.now());
  const ticking = !!player && !player.paused && !!player.current;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [ticking]);
  return player ? interpolatePosition(player, ticking ? now : Date.now()) : 0;
}
