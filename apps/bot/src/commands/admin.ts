import {
  MessageFlags,
  OAuth2Scopes,
  PermissionFlagsBits,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { App } from '../app.js';
import { AzuraCastError } from '../azuracast/service.js';
import { UserError } from '../music/service.js';
import { trackFailures } from '../metrics.js';
import { isSettingKey, SETTING_KEYS } from '../settings.js';

const SNOWFLAKE = /^\d{15,25}$/;

function snowflake(v: string): string {
  const s = v.trim();
  if (!SNOWFLAKE.test(s)) throw new UserError('That does not look like a valid ID.');
  return s;
}

export async function handleAdmin(app: App, i: ChatInputCommandInteraction): Promise<void> {
  // Every handler re-checks the caller is an admin.
  if (i.inGuild() || !app.access.isAdmin(i.user.id)) throw new UserError('Not authorized.');
  const group = i.options.getSubcommandGroup(false);
  const sub = i.options.getSubcommand();
  const reply = (content: string) =>
    i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  const requireOwner = () => {
    if (!app.access.isOwner(i.user.id)) throw new UserError('Only application owners can do that.');
  };

  if (group === 'config') {
    const settings = app.settings;
    if (sub === 'list') {
      const cur = settings.get() as unknown as Record<string, unknown>;
      return void (await reply(
        SETTING_KEYS.map(
          (k) => `\`${k}\` = ${cur[k] === undefined ? '*(unset)*' : `\`${String(cur[k])}\``}`,
        ).join('\n'),
      ));
    }
    const key = i.options.getString('key', true);
    if (!isSettingKey(key)) throw new UserError(`Unknown key. Valid: ${SETTING_KEYS.join(', ')}`);
    if (sub === 'get') {
      const v = (settings.get() as unknown as Record<string, unknown>)[key];
      return void (await reply(
        `\`${key}\` = ${v === undefined ? '*(unset)*' : `\`${String(v)}\``}`,
      ));
    }
    if (sub === 'set') {
      try {
        const v = await settings.set(key, i.options.getString('value', true), i.user.id);
        return void (await reply(`\`${key}\` set to \`${String(v)}\`.`));
      } catch (e) {
        throw new UserError(e instanceof Error ? e.message : 'Invalid value');
      }
    }
    await settings.reset(key);
    return void (await reply(`\`${key}\` reset to default.`));
  }

  if (group === 'radio') {
    if (sub === 'add') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const { row, stationCount } = await app.catalog.add(
          i.options.getString('base_url', true),
          i.options.getString('label') ?? undefined,
          i.user.id,
        );
        await i.editReply(`Added **${row.label}** (${stationCount} public station(s)).`);
      } catch (e) {
        if (e instanceof AzuraCastError)
          throw new UserError(`Could not add that instance: ${e.message}`);
        throw e;
      }
      return;
    }
    if (sub === 'remove') {
      const ok = await app.catalog.remove(i.options.getString('source', true));
      return void (await reply(ok ? 'Removed.' : 'No such source.'));
    }
    if (sub === 'list') {
      const rows = await app.catalog.sources();
      return void (await reply(
        rows.length
          ? rows
              .map((r) => `#${r.id} **${r.label}** — ${r.baseUrl}${r.enabled ? '' : ' (disabled)'}`)
              .join('\n')
          : 'No radio sources.',
      ));
    }
    app.catalog.refresh();
    return void (await reply('Station cache cleared.'));
  }

  switch (sub) {
    case 'guild-allow': {
      const id = snowflake(i.options.getString('guild_id', true));
      await app.access.allowGuild(id, i.user.id);
      return void (await reply(`Guild \`${id}\` allowed.`));
    }
    case 'guild-deny': {
      const id = snowflake(i.options.getString('guild_id', true));
      await app.access.denyGuild(id, i.user.id);
      const g = app.client.guilds.cache.get(id);
      await g?.leave().catch(() => undefined);
      return void (await reply(`Guild \`${id}\` denied${g ? ' and left' : ''}.`));
    }
    case 'guild-list': {
      const rows = await app.access.listGuilds();
      const lines = rows.map(
        (r) =>
          `\`${r.id}\` ${r.allowed ? 'allowed' : 'denied'}${app.client.guilds.cache.get(r.id) ? ` — ${app.client.guilds.cache.get(r.id)!.name}` : ''}`,
      );
      return void (await reply(lines.length ? lines.join('\n') : 'No guilds recorded.'));
    }
    case 'invite-link': {
      const id = snowflake(i.options.getString('guild_id', true));
      await app.access.allowGuild(id, i.user.id);
      const url = app.client.generateInvite({
        scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
        permissions: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.UseVAD,
        ],
        guild: id,
        disableGuildSelect: true,
      });
      return void (await reply(`Guild \`${id}\` allowed. Invite link (this guild only):\n${url}`));
    }
    case 'admin-add': {
      requireOwner();
      const u = i.options.getUser('user', true);
      const added = await app.access.addAdmin(u.id, i.user.id);
      return void (await reply(
        added ? `Added <@${u.id}> as admin.` : 'Already an admin or owner.',
      ));
    }
    case 'admin-remove': {
      requireOwner();
      const u = i.options.getUser('user', true);
      const ok = await app.access.removeAdmin(u.id);
      return void (await reply(
        ok ? `Removed <@${u.id}>.` : 'Not a stored admin (owners cannot be removed).',
      ));
    }
    case 'admin-list': {
      const owners = app.access.ownerIds().map((id) => `<@${id}> (owner)`);
      const admins = app.access.adminList().map((id) => `<@${id}>`);
      return void (await reply([...owners, ...admins].join('\n') || 'None.'));
    }
    case 'web-revoke-all': {
      const n = await app.sessions.endAll('revoked');
      return void (await reply(
        `Ended ${n} web session(s). New links are issued on the next now-playing embed.`,
      ));
    }
    case 'status': {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const node = app.music.deps.manager.nodeManager.nodes.values().next().value;
      const info = node?.info;
      let resolver = 'n/a';
      if (app.env.RESOLVER_URL) {
        resolver = await fetch(`${app.env.RESOLVER_URL.replace(/\/+$/, '')}/v1/version`, {
          signal: AbortSignal.timeout(3000),
        })
          .then((r) => r.text())
          .then((t) => t.slice(0, 200))
          .catch((err: unknown) => `unreachable (${err instanceof Error ? err.name : 'error'})`);
      }
      const failures = (await trackFailures.get()).values.map(
        (v) => `${v.labels.source}/${v.labels.kind}: ${v.value}`,
      );
      const lines = [
        `Bot: ${app.version}`,
        `Lavalink: ${info ? `${info.version.semver} (${node?.connected ? 'connected' : 'disconnected'})` : 'unknown'}`,
        `Plugins: ${info?.plugins.map((p) => `${p.name} ${p.version}`).join(', ') || 'none'}`,
        `YouTube backend: ${app.env.YOUTUBE_BACKEND}`,
        `Resolver: ${resolver}`,
        `Active players: ${app.music.deps.manager.players.size}`,
        `Web sessions: ${app.sessions.all().length}`,
        `Source failures (since start): ${failures.join(', ') || 'none'}`,
      ];
      await i.editReply(lines.join('\n'));
      return;
    }
    default:
      throw new UserError('Unknown subcommand.');
  }
}

export async function handleAdminAutocomplete(app: App, i: AutocompleteInteraction): Promise<void> {
  if (i.inGuild() || !app.access.isAdmin(i.user.id)) return i.respond([]);
  const focused = i.options.getFocused(true);
  const q = String(focused.value).toLowerCase();
  if (focused.name === 'key') {
    return i.respond(SETTING_KEYS.filter((k) => k.includes(q)).map((k) => ({ name: k, value: k })));
  }
  if (focused.name === 'source') {
    const rows = await app.catalog.sources();
    return i.respond(
      rows
        .filter((r) => r.label.toLowerCase().includes(q))
        .slice(0, 25)
        .map((r) => ({ name: `${r.label} (${r.baseUrl})`.slice(0, 100), value: String(r.id) })),
    );
  }
  return i.respond([]);
}
