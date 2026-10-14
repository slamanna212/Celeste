import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type InteractionReplyOptions,
} from 'discord.js';
import type { FilterPreset, LoopMode } from '@celeste/shared';
import type { App } from '../app.js';
import { NP_BUTTONS } from '../music/nowplaying.js';
import { parseQueryPrefix, UserError, type Actor } from '../music/service.js';
import { canRotateLink } from '../permissions.js';
import { formatDuration, parseTimeToMs } from '../util/time.js';

export const QUEUE_PAGE_SIZE = 10;

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));
}

const eph = (content: string): InteractionReplyOptions => ({
  content,
  flags: MessageFlags.Ephemeral,
});

async function actorFor(app: App, guildId: string, member: GuildMember): Promise<Actor> {
  const gs = await app.music.getGuildSettings(guildId);
  return {
    id: member.id,
    name: member.displayName,
    web: false,
    hasDjRole: !!gs?.djRoleId && member.roles.cache.has(gs.djRoleId),
    hasManageGuild: member.permissions.has(PermissionFlagsBits.ManageGuild),
  };
}

/** Caller must be in a voice channel; if the bot is playing, it must be the same one. */
function requireVoice(
  app: App,
  guildId: string,
  member: GuildMember,
  needBotPlaying: boolean,
): string {
  const vc = member.voice.channelId;
  if (!vc) throw new UserError('Join a voice channel first.');
  const p = app.music.getPlayer(guildId);
  if (needBotPlaying && !p) throw new UserError('Nothing is playing right now.');
  if (p?.voiceChannelId && p.voiceChannelId !== vc)
    throw new UserError(`Join <#${p.voiceChannelId}> to control playback.`);
  return vc;
}

export function buildQueueEmbed(app: App, guildId: string, page: number) {
  const p = app.music.getPlayer(guildId);
  const tracks = p?.queue.tracks ?? [];
  const pages = pageCount(tracks.length);
  const pg = Math.min(Math.max(1, page), pages);
  const slice = tracks.slice((pg - 1) * QUEUE_PAGE_SIZE, pg * QUEUE_PAGE_SIZE);
  const cur = p?.queue.current;
  const lines = slice.map((t, i) => {
    const n = (pg - 1) * QUEUE_PAGE_SIZE + i + 1;
    const dur = t.info.isStream ? 'LIVE' : formatDuration(t.info.duration ?? 0);
    return `**${n}.** ${(t.info.title ?? '').slice(0, 70)} - ${(t.info.author ?? '').slice(0, 30)} \`${dur}\``;
  });
  const embed = new EmbedBuilder()
    .setColor(0x8e6bff)
    .setTitle('Queue')
    .setDescription(
      (cur ? `**Now:** ${cur.info.title.slice(0, 80)}\n\n` : '') +
        (lines.length ? lines.join('\n') : 'The queue is empty.'),
    )
    .setFooter({ text: `Page ${pg}/${pages} - ${tracks.length} track(s)` });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`q:${pg - 1}`)
      .setLabel('Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pg <= 1),
    new ButtonBuilder()
      .setCustomId(`q:${pg + 1}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pg >= pages),
  );
  return { embeds: [embed], components: [row] };
}

export async function handleGuildCommand(app: App, i: ChatInputCommandInteraction): Promise<void> {
  const guildId = i.guildId;
  const member = i.member as GuildMember | null;
  if (!guildId || !member) throw new UserError('This command can only be used in a server.');
  if (!app.access.isGuildAllowed(guildId)) throw new UserError('This server is not authorized.');
  const music = app.music;
  const textChannelId = i.channelId;

  switch (i.commandName) {
    case 'play':
    case 'playnext': {
      const vc = requireVoice(app, guildId, member, false);
      await i.deferReply();
      const actor = await actorFor(app, guildId, member);
      const res = await music.play(guildId, actor, i.options.getString('query', true), {
        next: i.commandName === 'playnext',
        voiceChannelId: vc,
        textChannelId,
      });
      if ('radio' in res) {
        await i.editReply(`Playing radio **${res.radio.name}**.`);
        return;
      }
      const msg = res.playlistName
        ? `Queued **${res.added}** tracks from **${res.playlistName}**${res.truncated ? ' (queue limit reached)' : ''}.`
        : res.position === 0
          ? `Playing **${res.first.info.title}**.`
          : `Queued **${res.first.info.title}** at position ${res.position}.`;
      await i.editReply(msg);
      return;
    }
    case 'radio': {
      const vc = requireVoice(app, guildId, member, false);
      await i.deferReply();
      const station = await app.catalog.find(i.options.getString('station', true));
      if (!station) throw new UserError('Unknown station.');
      await music.playRadio(guildId, await actorFor(app, guildId, member), station, {
        voiceChannelId: vc,
        textChannelId,
      });
      await i.editReply(`Playing radio **${station.name}** (${station.sourceLabel}).`);
      return;
    }
    case 'pause':
      requireVoice(app, guildId, member, true);
      await music.pause(guildId);
      await i.reply('Paused.');
      return;
    case 'resume':
      requireVoice(app, guildId, member, true);
      await music.resume(guildId);
      await i.reply('Resumed.');
      return;
    case 'skip': {
      requireVoice(app, guildId, member, true);
      const r = await music.skip(guildId, await actorFor(app, guildId, member));
      await i.reply(
        r.skipped ? `Skipped **${r.title}**.` : `Vote registered: ${r.votes}/${r.needed} to skip.`,
      );
      return;
    }
    case 'voteskip': {
      requireVoice(app, guildId, member, true);
      const r = await music.voteSkip(guildId, await actorFor(app, guildId, member));
      await i.reply(
        r.skipped
          ? `Vote passed (${r.votes}/${r.needed}). Skipped **${r.title}**.`
          : `Vote registered: ${r.votes}/${r.needed}.`,
      );
      return;
    }
    case 'stop':
      requireVoice(app, guildId, member, true);
      await music.stop(guildId, await actorFor(app, guildId, member));
      await i.reply('Stopped and disconnected.');
      return;
    case 'disconnect':
      requireVoice(app, guildId, member, true);
      await music.stop(guildId, await actorFor(app, guildId, member));
      await i.reply('Disconnected.');
      return;
    case 'queue': {
      music.requirePlayer(guildId);
      await i.reply(buildQueueEmbed(app, guildId, i.options.getInteger('page') ?? 1));
      return;
    }
    case 'nowplaying': {
      const payload = await app.np.build(guildId, { withProgress: true });
      if (!payload) throw new UserError('Nothing is playing right now.');
      await i.reply(payload);
      return;
    }
    case 'seek': {
      requireVoice(app, guildId, member, true);
      const ms = parseTimeToMs(i.options.getString('time', true));
      if (ms === null)
        throw new UserError('Use mm:ss or a number of seconds, e.g. `1:30` or `90`.');
      await music.seek(guildId, ms);
      await i.reply(`Seeked to ${formatDuration(ms)}.`);
      return;
    }
    case 'volume': {
      requireVoice(app, guildId, member, true);
      const v = i.options.getInteger('level', true);
      await music.setVolume(guildId, await actorFor(app, guildId, member), v);
      await i.reply(`Volume set to ${v}%.`);
      return;
    }
    case 'filter': {
      requireVoice(app, guildId, member, true);
      const preset = i.options.getString('preset', true) as FilterPreset;
      await i.deferReply();
      await music.setFilter(guildId, await actorFor(app, guildId, member), preset);
      await i.editReply(`Filter: **${preset}**.`);
      return;
    }
    case 'loop': {
      requireVoice(app, guildId, member, true);
      const mode = i.options.getString('mode', true) as LoopMode;
      await music.setLoop(guildId, mode);
      await i.reply(`Loop: **${mode}**.`);
      return;
    }
    case 'shuffle':
      requireVoice(app, guildId, member, true);
      await music.shuffle(guildId);
      await i.reply('Queue shuffled.');
      return;
    case 'remove': {
      requireVoice(app, guildId, member, true);
      const t = await music.remove(
        guildId,
        await actorFor(app, guildId, member),
        i.options.getInteger('position', true),
      );
      await i.reply(`Removed **${t.info.title}**.`);
      return;
    }
    case 'move': {
      requireVoice(app, guildId, member, true);
      const t = await music.move(
        guildId,
        await actorFor(app, guildId, member),
        i.options.getInteger('from', true),
        i.options.getInteger('to', true),
      );
      await i.reply(`Moved **${t.info.title}** to position ${i.options.getInteger('to', true)}.`);
      return;
    }
    case 'clear': {
      requireVoice(app, guildId, member, true);
      const n = await music.clear(guildId, await actorFor(app, guildId, member));
      await i.reply(`Cleared ${n} track(s).`);
      return;
    }
    case 'web': {
      requireVoice(app, guildId, member, true);
      if (!app.settings.get().panel_base_url)
        throw new UserError('The web panel is not configured.');
      const actor = await actorFor(app, guildId, member);
      const rt = music.runtime(guildId);
      if (
        !canRotateLink({
          hasDjRole: actor.hasDjRole,
          hasManageGuild: actor.hasManageGuild,
          isSessionStarter: rt.startedBy === actor.id,
        })
      ) {
        throw new UserError(
          'Only a DJ, someone with Manage Server, or the person who started the session can rotate the link.',
        );
      }
      const s = await app.sessions.rotate(guildId);
      if (!s) throw new UserError('No active session.');
      await app.np.refresh(guildId);
      await i.reply(
        eph(
          'The web panel link was rotated. The previous link no longer works; use the button on the now-playing message.',
        ),
      );
      return;
    }
    case 'settings': {
      const sub = i.options.getSubcommand();
      if (!member.permissions.has(PermissionFlagsBits.ManageGuild))
        throw new UserError('You need the Manage Server permission.');
      if (sub === 'dj-role') {
        const role = i.options.getRole('role');
        await music.patchGuildSettings(guildId, { djRoleId: role?.id ?? null });
        await i.reply(role ? `DJ role set to <@&${role.id}>.` : 'DJ role cleared.');
      } else {
        const enabled = i.options.getBoolean('enabled', true);
        await music.patchGuildSettings(guildId, { deleteOldNp: enabled });
        await i.reply(`Delete old now-playing messages: **${enabled ? 'on' : 'off'}**.`);
      }
      return;
    }
    default:
      throw new UserError('Unknown command.');
  }
}

export async function handleButton(app: App, i: ButtonInteraction): Promise<void> {
  const guildId = i.guildId;
  const member = i.member as GuildMember | null;
  if (!guildId || !member) return;
  if (!app.access.isGuildAllowed(guildId)) throw new UserError('This server is not authorized.');

  if (i.customId.startsWith('q:')) {
    const page = Number(i.customId.slice(2));
    await i.update(buildQueueEmbed(app, guildId, Number.isFinite(page) ? page : 1));
    return;
  }
  if (!i.customId.startsWith('np:')) return;
  requireVoice(app, guildId, member, true);
  const actor = await actorFor(app, guildId, member);
  const music = app.music;
  switch (i.customId) {
    case NP_BUTTONS.playPause: {
      const p = music.requirePlayer(guildId);
      if (p.paused) await music.resume(guildId);
      else await music.pause(guildId);
      await i.deferUpdate();
      await app.np.refresh(guildId);
      return;
    }
    case NP_BUTTONS.skip: {
      const r = await music.skip(guildId, actor);
      if (r.skipped) await i.reply(`${member.displayName} skipped **${r.title}**.`);
      else await i.reply(eph(`Vote registered: ${r.votes}/${r.needed} to skip.`));
      return;
    }
    case NP_BUTTONS.stop:
      await music.stop(guildId, actor);
      await i.reply(`${member.displayName} stopped playback.`);
      return;
    case NP_BUTTONS.loop:
      await music.cycleLoop(guildId);
      await i.deferUpdate();
      await app.np.refresh(guildId);
      return;
    case NP_BUTTONS.shuffle:
      await music.shuffle(guildId);
      await i.deferUpdate();
      await app.np.refresh(guildId);
      return;
  }
}

const acCache = new Map<string, { at: number; choices: { name: string; value: string }[] }>();

export async function handleGuildAutocomplete(app: App, i: AutocompleteInteraction): Promise<void> {
  const focused = i.options.getFocused(true);
  const guildId = i.guildId;
  if (!guildId || !app.access.isGuildAllowed(guildId)) return i.respond([]);

  if (i.commandName === 'radio') {
    const q = String(focused.value).toLowerCase();
    const stations = await app.catalog.stations();
    const hits = stations
      .filter((s) => `${s.name} ${s.sourceLabel}`.toLowerCase().includes(q))
      .slice(0, 25);
    return i.respond(
      hits.map((s) => ({ name: `${s.name} — ${s.sourceLabel}`.slice(0, 100), value: s.id })),
    );
  }
  if (i.commandName !== 'play' && i.commandName !== 'playnext') return i.respond([]);

  const raw = String(focused.value).trim();
  if (raw.length < 2) return i.respond([]);
  if (/^https?:\/\//i.test(raw))
    return i.respond([{ name: raw.slice(0, 100), value: raw.slice(0, 100) }]);
  const parsed = parseQueryPrefix(raw);
  if (parsed.query.length < 2) return i.respond([]);
  const key = `${parsed.source}:${parsed.query.toLowerCase()}`;
  const hit = acCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return i.respond(hit.choices);
  const results = await Promise.race([
    app.music.search(guildId, parsed.query, parsed.source, {
      id: i.user.id,
      name: i.user.username,
    }),
    new Promise<null>((r) => setTimeout(() => r(null), 2500)),
  ]).catch(() => null);
  if (!results) return i.respond([]);
  const prefix =
    parsed.source === 'soundcloud'
      ? 'sc:'
      : parsed.source === 'spotify'
        ? 'sp:'
        : parsed.source === 'applemusic'
          ? 'am:'
          : '';
  const choices = results.slice(0, 10).map((t) => {
    const label =
      `${t.title} - ${t.author}${t.isStream ? ' (LIVE)' : ` (${formatDuration(t.durationMs)})`}`.slice(
        0,
        100,
      );
    // Choice value max is 100 chars: use the URL if it fits, else fall back to a text query that re-searches.
    const value =
      t.uri && t.uri.length <= 100 ? t.uri : `${prefix}${t.title} ${t.author}`.slice(0, 100);
    return { name: label, value };
  });
  acCache.set(key, { at: Date.now(), choices });
  if (acCache.size > 500) acCache.clear();
  await i.respond(choices);
}
