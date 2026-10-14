import { MessageFlags, type Interaction } from 'discord.js';
import type { App } from '../app.js';
import { commandsTotal } from '../metrics.js';
import { UserError } from '../music/service.js';
import { handleAdmin, handleAdminAutocomplete } from './admin.js';
import { buildCommandDefinitions } from './definitions.js';
import { handleButton, handleGuildAutocomplete, handleGuildCommand } from './guild.js';

export async function registerCommands(app: App): Promise<void> {
  const defs = buildCommandDefinitions();
  await app.client.application.commands.set(defs);
  app.log.info({ count: defs.length }, 'registered global application commands');
}

async function respondError(i: Interaction, message: string): Promise<void> {
  if (!i.isRepliable()) return;
  const payload = { content: message, flags: MessageFlags.Ephemeral } as const;
  if (i.deferred || i.replied) await i.followUp(payload).catch(() => undefined);
  else await i.reply(payload).catch(() => undefined);
}

export function wireInteractions(app: App, shuttingDown: () => boolean): void {
  app.client.on('interactionCreate', (i) => {
    void (async () => {
      if (shuttingDown()) return;
      const name = i.isChatInputCommand()
        ? i.commandName
        : i.isButton()
          ? 'button'
          : i.isAutocomplete()
            ? 'autocomplete'
            : 'other';
      try {
        if (i.isAutocomplete()) {
          if (i.commandName === 'admin') await handleAdminAutocomplete(app, i);
          else await handleGuildAutocomplete(app, i);
          return;
        }
        if (i.isChatInputCommand()) {
          if (i.commandName === 'admin') await handleAdmin(app, i);
          else await handleGuildCommand(app, i);
          commandsTotal.inc({ command: name, outcome: 'ok' });
        } else if (i.isButton()) {
          await handleButton(app, i);
          commandsTotal.inc({ command: name, outcome: 'ok' });
        }
      } catch (e) {
        if (i.isAutocomplete()) return void i.respond([]).catch(() => undefined);
        const outcome = e instanceof UserError ? 'denied' : 'error';
        commandsTotal.inc({ command: name, outcome });
        if (e instanceof UserError) await respondError(i, e.message);
        else {
          app.log.error({ err: e, command: name }, 'command failed');
          await respondError(i, 'Something went wrong.');
        }
      }
    })();
  });
}
