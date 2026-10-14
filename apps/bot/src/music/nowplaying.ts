import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type BaseMessageOptions,
  type SendableChannels,
} from 'discord.js';
import { FILTER_DEFINITIONS, type FilterPreset } from '@celeste/shared';
import type { MusicService } from './service.js';
import { itemId, requesterOf, toTrackInfo } from './track.js';
import { formatDuration, progressBar } from '../util/time.js';

export const NP_BUTTONS = {
  playPause: 'np:playpause',
  skip: 'np:skip',
  stop: 'np:stop',
  loop: 'np:loop',
  shuffle: 'np:shuffle',
} as const;

const LOOP_LABEL = { off: 'Off', track: 'Track', queue: 'Queue' } as const;

export function panelUrl(base: string | undefined, token: string | undefined): string | null {
  if (!base || !token) return null;
  return `${base.replace(/\/+$/, '')}/s/${token}`;
}

export class NowPlayingManager {
  constructor(private readonly music: MusicService) {}

  /** Build embed + components for the guild's current track; null if nothing is playing. */
  async build(
    guildId: string,
    opts: { withProgress?: boolean } = {},
  ): Promise<BaseMessageOptions | null> {
    const p = this.music.getPlayer(guildId);
    const cur = p?.queue.current;
    if (!p || !cur) return null;
    const rt = this.music.runtime(guildId);
    const info = toTrackInfo(cur);
    const radio = rt.radio;
    const title = radio?.title ? `${radio.title}` : info.title;
    const artist = radio ? radio.artist : info.author;
    const art = radio?.artUrl ?? info.artworkUrl;
    const embed = new EmbedBuilder()
      .setColor(0x8e6bff)
      .setAuthor({ name: p.paused ? 'Paused' : 'Now playing' });
    embed.setTitle(title.slice(0, 256));
    if (info.uri && !radio) embed.setURL(info.uri);
    if (art) embed.setThumbnail(art);
    const req = requesterOf(cur);
    const requesterText = req.id.startsWith('web:')
      ? 'Web panel'
      : req.id === 'unknown'
        ? 'Unknown'
        : `<@${req.id}>`;
    const fields = [
      { name: 'Artist', value: artist || 'Unknown', inline: true },
      { name: 'Source', value: radio ? `Radio - ${radio.stationName}` : info.source, inline: true },
      {
        name: 'Duration',
        value: info.isStream ? 'LIVE' : formatDuration(info.durationMs),
        inline: true,
      },
      { name: 'Requested by', value: requesterText, inline: true },
      { name: 'Queue', value: `${p.queue.tracks.length} track(s)`, inline: true },
      { name: 'Volume', value: `${p.volume}%`, inline: true },
    ];
    const filter = (p.getData('filter') as FilterPreset | undefined) ?? 'off';
    fields.push({
      name: 'Filter',
      value: FILTER_DEFINITIONS[filter]?.label ?? filter,
      inline: true,
    });
    fields.push({ name: 'Loop', value: LOOP_LABEL[p.repeatMode], inline: true });
    if (radio?.listeners != null)
      fields.push({ name: 'Listeners', value: String(radio.listeners), inline: true });
    embed.addFields(fields);
    if (opts.withProgress && !info.isStream) {
      const pos = this.music.positionOf(p);
      embed.setDescription(
        `${progressBar(pos, info.durationMs)}\n${formatDuration(pos)} / ${formatDuration(info.durationMs)}`,
      );
    }
    embed.setFooter({ text: `id ${itemId(cur).slice(0, 8)}` });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(NP_BUTTONS.playPause)
        .setEmoji('⏯️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(NP_BUTTONS.skip)
        .setEmoji('⏭️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(NP_BUTTONS.stop).setEmoji('⏹️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(NP_BUTTONS.loop)
        .setEmoji('🔁')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(NP_BUTTONS.shuffle)
        .setEmoji('🔀')
        .setStyle(ButtonStyle.Secondary),
    );
    const rows = [row];
    const settings = this.music.deps.settings.get();
    if (settings.panel_base_url) {
      let session = this.music.deps.sessions.forGuild(guildId);
      if (!session && p.voiceChannelId) {
        session = await this.music.deps.sessions.start(guildId, p.voiceChannelId, rt.startedBy);
      }
      const url = panelUrl(settings.panel_base_url, session?.token);
      if (url) {
        rows.push(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setLabel('Open web panel').setStyle(ButtonStyle.Link).setURL(url),
          ),
        );
      }
    }
    return { embeds: [embed], components: rows };
  }

  private async channelFor(
    guildId: string,
    channelId: string | null | undefined,
  ): Promise<SendableChannels | null> {
    if (!channelId) return null;
    const ch = await this.music.deps.client.channels.fetch(channelId).catch(() => null);
    return ch && ch.isSendable() ? ch : null;
  }

  /** Post a fresh NP embed for a new track (deleting the previous one if configured). */
  async post(guildId: string): Promise<void> {
    const p = this.music.getPlayer(guildId);
    if (!p) return;
    const rt = this.music.runtime(guildId);
    const gs = await this.music.getGuildSettings(guildId);
    const channel = await this.channelFor(guildId, p.textChannelId ?? gs?.lastTextChannelId);
    if (!channel) return;
    const payload = await this.build(guildId);
    if (!payload) return;
    const old = rt.np;
    try {
      const msg = await channel.send(payload);
      rt.np = { channelId: channel.id, messageId: msg.id };
      if (old && (gs?.deleteOldNp ?? true)) {
        const oldCh = await this.channelFor(guildId, old.channelId);
        await oldCh?.messages.delete(old.messageId).catch(() => undefined);
      }
    } catch (e) {
      this.music.deps.log.warn({ err: e, guildId }, 'failed to post now-playing embed');
    }
  }

  /** Edit the current NP message in place (radio song change, button state, link rotation). */
  async refresh(guildId: string): Promise<void> {
    const rt = this.music.runtimes.get(guildId);
    if (!rt?.np) return;
    const payload = await this.build(guildId);
    if (!payload) return;
    const ch = await this.channelFor(guildId, rt.np.channelId);
    await ch?.messages.edit(rt.np.messageId, payload).catch(() => undefined);
  }

  /** Remove the buttons from the NP message when the session is over. */
  async detach(guildId: string): Promise<void> {
    const rt = this.music.runtimes.get(guildId);
    if (!rt?.np) return;
    const ch = await this.channelFor(guildId, rt.np.channelId);
    await ch?.messages.edit(rt.np.messageId, { components: [] }).catch(() => undefined);
  }
}
