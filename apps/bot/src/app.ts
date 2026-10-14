import type { Client } from 'discord.js';
import type { AccessService } from './access.js';
import type { RadioCatalog, RadioNowPlayingHub } from './azuracast/service.js';
import type { Db } from './db/client.js';
import type { Env } from './env.js';
import type { Logger } from './logger.js';
import type { Lifecycle } from './music/events.js';
import type { NowPlayingManager } from './music/nowplaying.js';
import type { MusicService } from './music/service.js';
import type { SettingsService } from './settings.js';
import type { SessionManager } from './web/sessions.js';

export interface App {
  env: Env;
  log: Logger;
  client: Client<true>;
  db: Db;
  settings: SettingsService;
  access: AccessService;
  music: MusicService;
  np: NowPlayingManager;
  lifecycle: Lifecycle;
  sessions: SessionManager;
  catalog: RadioCatalog;
  hub: RadioNowPlayingHub;
  version: string;
}
