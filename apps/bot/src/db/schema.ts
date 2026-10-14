import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const admins = pgTable('admins', {
  userId: text('user_id').primaryKey(),
  addedBy: text('added_by').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
});

export const radioSources = pgTable(
  'radio_sources',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    baseUrl: text('base_url').notNull(),
    label: text('label').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    addedBy: text('added_by').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('radio_sources_base_url_uq').on(t.baseUrl)],
);

export const guilds = pgTable('guilds', {
  id: text('id').primaryKey(),
  allowed: boolean('allowed').notNull().default(false),
  addedBy: text('added_by').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
});

export const guildSettings = pgTable('guild_settings', {
  guildId: text('guild_id').primaryKey(),
  volume: integer('volume'),
  djRoleId: text('dj_role_id'),
  deleteOldNp: boolean('delete_old_np').notNull().default(true),
  lastTextChannelId: text('last_text_channel_id'),
  lastVoiceChannelId: text('last_voice_channel_id'),
  defaultFilter: text('default_filter').notNull().default('off'),
});

/**
 * lavalink-client's QueueStoreManager is a key/value interface that reads and writes a whole
 * serialized queue per guild, so the queue is stored as one JSONB document per guild
 * (spec section 7 fallback) instead of normalized queue_items rows.
 */
export const queueStore = pgTable('queue_store', {
  guildId: text('guild_id').primaryKey(),
  data: jsonb('data').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const playerState = pgTable('player_state', {
  guildId: text('guild_id').primaryKey(),
  currentItemId: text('current_item_id'),
  positionMs: integer('position_ms').notNull().default(0),
  paused: boolean('paused').notNull().default(false),
  loopMode: text('loop_mode').notNull().default('off'),
  filter: text('filter').notNull().default('off'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const lavalinkSession = pgTable('lavalink_session', {
  id: integer('id').primaryKey().default(1),
  sessionId: text('session_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const playHistory = pgTable(
  'play_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: text('guild_id').notNull(),
    track: jsonb('track').notNull(),
    requesterId: text('requester_id').notNull(),
    requesterName: text('requester_name'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('play_history_guild_started_idx').on(t.guildId, t.startedAt)],
);

export const playlists = pgTable(
  'playlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('playlists_owner_idx').on(t.ownerId)],
);

export const playlistItems = pgTable(
  'playlist_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    playlistId: uuid('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    encodedTrack: text('encoded_track').notNull(),
    info: jsonb('info').notNull(),
  },
  (t) => [index('playlist_items_idx').on(t.playlistId, t.position)],
);

export const webSessions = pgTable(
  'web_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    guildId: text('guild_id').notNull(),
    voiceChannelId: text('voice_channel_id').notNull(),
    startedBy: text('started_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('web_sessions_token_hash_uq').on(t.tokenHash),
    index('web_sessions_guild_idx').on(t.guildId),
  ],
);
