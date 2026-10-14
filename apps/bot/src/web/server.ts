import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { count, desc, eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import type {
  HistoryEntryDTO,
  OkResponse,
  Paginated,
  RadioStationDTO,
  SessionDTO,
  SseEventMap,
  SseEventType,
  TrackInfo,
} from '@celeste/shared';
import type { App } from '../app.js';
import { playHistory } from '../db/schema.js';
import { UserError, type Actor } from '../music/service.js';
import { SessionRateLimiter } from './ratelimit.js';
import {
  controlBody,
  filterBody,
  historyQuery,
  moveBody,
  playBody,
  queueIdParam,
  radioBody,
  searchQuery,
  seekBody,
  volumeBody,
} from './schemas.js';
import type { ActiveSession } from './sessions.js';
import { isSessionUsable, originAllowed } from './tokens.js';

export const SESSION_COOKIE = 'celeste_session';
export const SPA_ROUTES = ['/player', '/queue', '/search', '/radio', '/history', '/ended'] as const;
const HISTORY_PAGE_SIZE = 20;
const MAX_SSE_PER_SESSION = 5;

declare module 'fastify' {
  interface FastifyRequest {
    webSession?: ActiveSession;
  }
}

export function defaultStaticDir(): string {
  // dist/web/server.js -> apps/web/dist (dev layout). In the image set WEB_STATIC_DIR.
  return path.resolve(import.meta.dirname, '../../../web/dist');
}

function webActor(s: ActiveSession): Actor {
  return { id: `web:${s.id}`, name: 'Web panel', web: true };
}

export async function buildWebServer(app: App): Promise<FastifyInstance> {
  const fastify = Fastify({
    loggerInstance: app.log.child({ c: 'web' }, { level: 'warn' }),
    bodyLimit: 16 * 1024,
  });
  const limiter = new SessionRateLimiter(10, 60);
  const sseCounts = new Map<string, number>();

  await fastify.register(fastifyCookie, { secret: app.env.WEB_SESSION_SECRET });

  fastify.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', "frame-ancestors 'none'");
  });

  fastify.setErrorHandler((error, _req, reply) => {
    const err = error as Error;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'bad_request',
        message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
    if (err instanceof UserError)
      return reply.code(400).send({ error: 'bad_request', message: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500)
      return reply.code(status).send({ error: 'bad_request', message: err.message });
    app.log.error({ err }, 'web request failed');
    return reply.code(500).send({ error: 'internal', message: 'Internal error' });
  });

  // ---- session link ----
  fastify.get<{ Params: { token: string } }>('/s/:token', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const session = await app.sessions.lookupToken(req.params.token);
    if (!session || !app.access.isGuildAllowed(session.guildId))
      return reply.redirect('/ended', 302);
    reply.setCookie(SESSION_COOKIE, session.id, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      signed: true,
      maxAge: 60 * 60 * 24,
    });
    return reply.redirect('/player', 302);
  });

  // ---- API auth ----
  const unauthorized = (reply: FastifyReply) =>
    reply.code(401).send({ error: 'session_ended', message: 'This session has ended.' });

  async function authenticate(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | void> {
    reply.header('Cache-Control', 'no-store');
    const raw = req.cookies[SESSION_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    const session =
      unsigned?.valid && unsigned.value ? app.sessions.byIdActive(unsigned.value) : undefined;
    if (
      !isSessionUsable(
        session ? { endedAt: null, guildId: session.guildId } : null,
        !!session && app.access.isGuildAllowed(session.guildId),
      )
    ) {
      return unauthorized(reply);
    }
    req.webSession = session;
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    if (mutating) {
      if (!originAllowed(req.headers.origin, app.settings.get().panel_base_url)) {
        return reply.code(403).send({ error: 'forbidden', message: 'Bad origin.' });
      }
      const ct = req.headers['content-type'];
      if (
        req.method === 'POST' &&
        !(typeof ct === 'string' && ct.toLowerCase().startsWith('application/json'))
      ) {
        return reply
          .code(415)
          .send({ error: 'bad_request', message: 'Content-Type must be application/json.' });
      }
    }
    if (!limiter.allow(session!.id, mutating)) {
      return reply.code(429).send({ error: 'rate_limited', message: 'Too many requests.' });
    }
  }

  await fastify.register(
    async (api) => {
      api.addHook('preHandler', authenticate);
      const sess = (req: FastifyRequest) => req.webSession!;
      const ok = (message?: string): OkResponse => ({ ok: true, ...(message ? { message } : {}) });
      const announce = (s: ActiveSession, text: string) =>
        void app.lifecycle.notify(s.guildId, `Web panel (session ${s.id.slice(0, 8)}): ${text}`);

      api.get('/session', async (req): Promise<SessionDTO> => {
        const s = sess(req);
        const guild = app.client.guilds.cache.get(s.guildId);
        const p = app.music.getPlayer(s.guildId);
        const vcId = p?.voiceChannelId ?? s.voiceChannelId;
        return {
          sessionId: s.id,
          guild: {
            id: s.guildId,
            name: guild?.name ?? 'Server',
            iconUrl: guild?.iconURL({ size: 128 }) ?? null,
          },
          voiceChannel: { id: vcId, name: guild?.channels.cache.get(vcId)?.name ?? 'voice' },
          startedAt: s.createdAt.toISOString(),
        };
      });
      api.get('/player', async (req) => app.music.snapshot(sess(req).guildId));
      api.get('/queue', async (req) => app.music.queueDto(sess(req).guildId));

      const playHandler = (next: boolean) => async (req: FastifyRequest) => {
        const s = sess(req);
        const { query } = playBody.parse(req.body);
        const p = app.music.getPlayer(s.guildId);
        const res = await app.music.play(s.guildId, webActor(s), query, {
          next,
          voiceChannelId: p?.voiceChannelId ?? s.voiceChannelId,
          textChannelId: p?.textChannelId ?? null,
        });
        if ('radio' in res) return ok(`Playing radio ${res.radio.name}`);
        return ok(
          res.playlistName ? `Queued ${res.added} tracks` : `Queued ${res.first.info.title}`,
        );
      };
      api.post('/play', playHandler(false));
      api.post('/playnext', playHandler(true));

      api.post('/control', async (req) => {
        const s = sess(req);
        const body = controlBody.parse(req.body);
        const g = s.guildId;
        const actor = webActor(s);
        switch (body.action) {
          case 'pause':
            await app.music.pause(g);
            break;
          case 'resume':
            await app.music.resume(g);
            break;
          case 'skip': {
            const title = app.music.getPlayer(g)?.queue.current?.info.title ?? 'track';
            await app.music.skip(g, actor);
            announce(s, `skipped **${title}**`);
            break;
          }
          case 'voteskip': {
            const r = await app.music.voteSkip(g, actor);
            return ok(r.skipped ? 'Skipped' : `Vote ${r.votes}/${r.needed}`);
          }
          case 'stop':
            announce(s, 'stopped playback');
            await app.music.stop(g, actor);
            break;
          case 'shuffle':
            await app.music.shuffle(g);
            break;
          case 'loop':
            await app.music.setLoop(g, body.value!);
            break;
        }
        return ok();
      });

      api.post('/seek', async (req) => {
        const { ms } = seekBody.parse(req.body);
        await app.music.seek(sess(req).guildId, ms);
        return ok();
      });
      api.post('/volume', async (req) => {
        const { value } = volumeBody.parse(req.body);
        const s = sess(req);
        await app.music.setVolume(s.guildId, webActor(s), value);
        return ok();
      });
      api.post('/filter', async (req) => {
        const { preset } = filterBody.parse(req.body);
        const s = sess(req);
        await app.music.setFilter(s.guildId, webActor(s), preset);
        return ok();
      });
      api.post('/queue/move', async (req) => {
        const { from, to } = moveBody.parse(req.body);
        const s = sess(req);
        await app.music.move(s.guildId, webActor(s), from, to);
        return ok();
      });
      api.delete('/queue/:id', async (req) => {
        const { id } = queueIdParam.parse(req.params);
        const s = sess(req);
        await app.music.removeById(s.guildId, webActor(s), id);
        return ok();
      });
      api.delete('/queue', async (req) => {
        const s = sess(req);
        const n = await app.music.clear(s.guildId, webActor(s));
        announce(s, `cleared the queue (${n} track(s))`);
        return ok();
      });

      api.get('/search', async (req) => {
        const { q, source } = searchQuery.parse(req.query);
        const s = sess(req);
        return app.music.search(s.guildId, q, source, { id: `web:${s.id}`, name: 'Web panel' });
      });

      api.get('/radio/stations', async (): Promise<RadioStationDTO[]> => {
        const [stations, nps] = await Promise.all([
          app.catalog.stations(),
          app.catalog.nowPlayingByStation(),
        ]);
        return stations.map((st) => ({
          id: st.id,
          name: st.name,
          sourceLabel: st.sourceLabel,
          nowPlaying: app.hub.latest(st.id) ?? nps.get(st.id) ?? null,
        }));
      });
      api.post('/radio', async (req) => {
        const { stationId } = radioBody.parse(req.body);
        const s = sess(req);
        const station = await app.catalog.find(stationId);
        if (!station) throw new UserError('Unknown station.');
        const p = app.music.getPlayer(s.guildId);
        await app.music.playRadio(s.guildId, webActor(s), station, {
          voiceChannelId: p?.voiceChannelId ?? s.voiceChannelId,
          textChannelId: p?.textChannelId ?? null,
        });
        return ok(`Playing radio ${station.name}`);
      });

      api.get('/history', async (req): Promise<Paginated<HistoryEntryDTO>> => {
        const { page } = historyQuery.parse(req.query);
        const g = sess(req).guildId;
        const [rows, totalRows] = await Promise.all([
          app.db
            .select()
            .from(playHistory)
            .where(eq(playHistory.guildId, g))
            .orderBy(desc(playHistory.startedAt))
            .limit(HISTORY_PAGE_SIZE)
            .offset((page - 1) * HISTORY_PAGE_SIZE),
          app.db.select({ n: count() }).from(playHistory).where(eq(playHistory.guildId, g)),
        ]);
        return {
          items: rows.map((r) => ({
            id: String(r.id),
            track: r.track as TrackInfo,
            requesterId: r.requesterId,
            requesterName: r.requesterName,
            startedAt: r.startedAt.toISOString(),
          })),
          page,
          pageSize: HISTORY_PAGE_SIZE,
          total: totalRows[0]?.n ?? 0,
        };
      });

      api.get('/events', async (req, reply) => {
        const s = sess(req);
        const n = sseCounts.get(s.id) ?? 0;
        if (n >= MAX_SSE_PER_SESSION)
          return reply
            .code(429)
            .send({ error: 'rate_limited', message: 'Too many event streams.' });
        sseCounts.set(s.id, n + 1);
        reply.hijack();
        const res = reply.raw;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          'X-Content-Type-Options': 'nosniff',
        });
        res.write('retry: 3000\n\n');
        let closed = false;
        const send = <T extends SseEventType>(type: T, data: SseEventMap[T]) => {
          if (!closed) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        const sendPlayer = () => send('player', app.music.snapshot(s.guildId));
        const sendQueue = () => send('queue', app.music.queueDto(s.guildId));
        let pending: NodeJS.Timeout | null = null;
        let lastPlayer = 0;
        const onPlayer = (g: string) => {
          if (g !== s.guildId || pending) return;
          const wait = Math.max(0, 250 - (Date.now() - lastPlayer));
          pending = setTimeout(() => {
            pending = null;
            lastPlayer = Date.now();
            sendPlayer();
          }, wait);
        };
        const onQueue = (g: string) => {
          if (g === s.guildId) sendQueue();
        };
        const onRadio = (g: string, np: SseEventMap['radio']) => {
          if (g === s.guildId) send('radio', np);
        };
        const onEnded = (ended: ActiveSession, reason: string) => {
          if (ended.id !== s.id) return;
          send('session-ended', { reason });
          close();
        };
        const heartbeat = setInterval(() => {
          if (!app.sessions.byIdActive(s.id) || !app.access.isGuildAllowed(s.guildId)) {
            send('session-ended', { reason: 'ended' });
            close();
            return;
          }
          res.write(': ping\n\n');
        }, 20_000);
        function close() {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          if (pending) clearTimeout(pending);
          app.music.off('player', onPlayer);
          app.music.off('queue', onQueue);
          app.music.off('radio', onRadio);
          app.sessions.off('ended', onEnded);
          sseCounts.set(s.id, Math.max(0, (sseCounts.get(s.id) ?? 1) - 1));
          res.end();
        }
        app.music.on('player', onPlayer);
        app.music.on('queue', onQueue);
        app.music.on('radio', onRadio);
        app.sessions.on('ended', onEnded);
        req.raw.on('close', close);
        sendPlayer();
        sendQueue();
      });
    },
    { prefix: '/api' },
  );

  // ---- static SPA ----
  const staticDir = path.resolve(app.env.WEB_STATIC_DIR ?? defaultStaticDir());
  const indexPath = path.join(staticDir, 'index.html');
  if (existsSync(indexPath)) {
    await fastify.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
      index: false,
      cacheControl: true,
      maxAge: '1h',
    });
    const sendIndex = async (_req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      return reply.sendFile('index.html');
    };
    for (const r of SPA_ROUTES) fastify.get(r, sendIndex);
    fastify.get('/', async (_req, reply) => reply.redirect('/player', 302));
    fastify.get('/*', async (req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/s/'))
        return reply.code(404).send({ error: 'not_found', message: 'Not found' });
      return reply.sendFile(req.url.split('?')[0]!.replace(/^\/+/, ''));
    });
  } else {
    app.log.warn({ staticDir }, 'web SPA directory not found; serving API only');
  }
  fastify.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: 'not_found', message: 'Not found' }),
  );

  return fastify as unknown as FastifyInstance;
}
