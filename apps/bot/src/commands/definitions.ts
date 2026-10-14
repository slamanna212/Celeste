import {
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';
import { FILTER_PRESETS, LOOP_MODES, VOLUME_MAX, VOLUME_MIN } from '@celeste/shared';

const guildCmd = (name: string, description: string) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);

export function buildCommandDefinitions(): RESTPostAPIApplicationCommandsJSONBody[] {
  const defs = [
    guildCmd(
      'play',
      'Play a URL or search (prefix sc: sp: am: for SoundCloud/Spotify/Apple Music)',
    ).addStringOption((o) =>
      o
        .setName('query')
        .setDescription('URL or search terms')
        .setRequired(true)
        .setAutocomplete(true),
    ),
    guildCmd('playnext', 'Insert a track at the front of the queue').addStringOption((o) =>
      o
        .setName('query')
        .setDescription('URL or search terms')
        .setRequired(true)
        .setAutocomplete(true),
    ),
    guildCmd('radio', 'Play an AzuraCast radio station').addStringOption((o) =>
      o.setName('station').setDescription('Station').setRequired(true).setAutocomplete(true),
    ),
    guildCmd('pause', 'Pause playback'),
    guildCmd('resume', 'Resume playback'),
    guildCmd('skip', 'Skip the current track (votes if you are not the requester/DJ)'),
    guildCmd('voteskip', 'Vote to skip the current track'),
    guildCmd('stop', 'Clear the queue, stop and disconnect'),
    guildCmd('queue', 'Show the queue').addIntegerOption((o) =>
      o.setName('page').setDescription('Page').setMinValue(1),
    ),
    guildCmd('nowplaying', 'Show the current track'),
    guildCmd('seek', 'Seek in the current track').addStringOption((o) =>
      o.setName('time').setDescription('mm:ss or seconds').setRequired(true),
    ),
    guildCmd('volume', 'Set the volume').addIntegerOption((o) =>
      o
        .setName('level')
        .setDescription(`${VOLUME_MIN}-${VOLUME_MAX}`)
        .setRequired(true)
        .setMinValue(VOLUME_MIN)
        .setMaxValue(VOLUME_MAX),
    ),
    guildCmd('filter', 'Apply an audio filter preset').addStringOption((o) =>
      o
        .setName('preset')
        .setDescription('Preset')
        .setRequired(true)
        .addChoices(...FILTER_PRESETS.map((p) => ({ name: p, value: p }))),
    ),
    guildCmd('loop', 'Set loop mode').addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('Loop mode')
        .setRequired(true)
        .addChoices(...LOOP_MODES.map((p) => ({ name: p, value: p }))),
    ),
    guildCmd('shuffle', 'Shuffle the queue'),
    guildCmd('remove', 'Remove a track from the queue').addIntegerOption((o) =>
      o.setName('position').setDescription('Queue position').setRequired(true).setMinValue(1),
    ),
    guildCmd('move', 'Move a track in the queue')
      .addIntegerOption((o) =>
        o.setName('from').setDescription('From position').setRequired(true).setMinValue(1),
      )
      .addIntegerOption((o) =>
        o.setName('to').setDescription('To position').setRequired(true).setMinValue(1),
      ),
    guildCmd('clear', 'Clear the queue'),
    guildCmd('disconnect', 'Disconnect from voice (keeps nothing)'),
    guildCmd('web', 'Rotate the web panel link for this session'),
    guildCmd('settings', 'Server settings')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((s) =>
        s
          .setName('dj-role')
          .setDescription('Set (or clear) the DJ role')
          .addRoleOption((o) => o.setName('role').setDescription('DJ role; omit to clear')),
      )
      .addSubcommand((s) =>
        s
          .setName('delete-old-np')
          .setDescription('Delete the previous now-playing message when a new track starts')
          .addBooleanOption((o) =>
            o.setName('enabled').setDescription('Enabled').setRequired(true),
          ),
      ),
  ];

  const admin = new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Bot administration (DM only)')
    .setContexts(InteractionContextType.BotDM)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addSubcommand((s) =>
      s
        .setName('guild-allow')
        .setDescription('Allow a guild')
        .addStringOption((o) => o.setName('guild_id').setDescription('Guild ID').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('guild-deny')
        .setDescription('Deny a guild and leave it')
        .addStringOption((o) => o.setName('guild_id').setDescription('Guild ID').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('guild-list').setDescription('List guilds'))
    .addSubcommand((s) =>
      s
        .setName('invite-link')
        .setDescription('Allow a guild and create a single-guild invite link')
        .addStringOption((o) => o.setName('guild_id').setDescription('Guild ID').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('admin-add')
        .setDescription('Add an admin (owners only)')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('admin-remove')
        .setDescription('Remove an admin (owners only)')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('admin-list').setDescription('List admins'))
    .addSubcommandGroup((g) =>
      g
        .setName('config')
        .setDescription('Runtime settings')
        .addSubcommand((s) => s.setName('list').setDescription('List settings'))
        .addSubcommand((s) =>
          s
            .setName('get')
            .setDescription('Get a setting')
            .addStringOption((o) =>
              o.setName('key').setDescription('Key').setRequired(true).setAutocomplete(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('set')
            .setDescription('Set a setting')
            .addStringOption((o) =>
              o.setName('key').setDescription('Key').setRequired(true).setAutocomplete(true),
            )
            .addStringOption((o) => o.setName('value').setDescription('Value').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('reset')
            .setDescription('Reset a setting')
            .addStringOption((o) =>
              o.setName('key').setDescription('Key').setRequired(true).setAutocomplete(true),
            ),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('radio')
        .setDescription('AzuraCast sources')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add an AzuraCast instance')
            .addStringOption((o) =>
              o.setName('base_url').setDescription('https://radio.example.com').setRequired(true),
            )
            .addStringOption((o) => o.setName('label').setDescription('Label')),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove an instance')
            .addStringOption((o) =>
              o.setName('source').setDescription('Source').setRequired(true).setAutocomplete(true),
            ),
        )
        .addSubcommand((s) => s.setName('list').setDescription('List instances'))
        .addSubcommand((s) => s.setName('refresh').setDescription('Clear the station cache')),
    )
    .addSubcommand((s) =>
      s.setName('web-revoke-all').setDescription('End all web panel sessions/links'),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show bot status'));

  return [...defs, admin].map((d) => d.toJSON());
}
