# Importing bots from another service

Settings → Import brings bots over from another service's export. Choose the export file, check the
counts, then import. Nothing is written until you confirm, and importing the same export again adds
nothing.

## Grok Bot

Ask a Grok Bot to export its fleet as a zip with this layout:

```
manifest.json
memory/<bot name>/profile.md
memory/<bot name>/log/2026-09.md
memory/<bot name>/shared/...
skills/<skill>.md
```

`manifest.json` has `version: 1` and a `bots` list. Each bot has `name`, `title`, `description`,
`instructions`, `routines` (`name`, `prompt`, `crons`, `timezone`) and `memory_files`.

| Export | Becomes |
| --- | --- |
| Bot name, title, instructions | A bot |
| Scheduled routine | A routine, paused until you turn it on |
| `memory/<bot>/...` | The bot's memory |
| `memory/<bot>/shared/...` | Shared memory, under `grokbot/<bot>/` |
| `skills/*.md` | A skill, unless one with that name exists |

Connections, logins, managed skills and routines without a schedule are not imported; the result
lists what was skipped.

## Adding another service

Write a translator from that service's files into `BotBundle` (`packages/contracts/src/bot-import.ts`),
next to `packages/adapters/src/grokbot-import.ts`, add its id to `BotImportSourceSchema`, and add a
case to `translate` in `apps/api/src/bot-import.ts`.
