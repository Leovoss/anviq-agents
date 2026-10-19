# Memory mirror

The built-in memory can be mirrored to a folder of Markdown notes. Syncthing copies that folder
to other machines, where Obsidian opens it as a vault.

## Folder layout

```
memory-mirror/
  org/<organization id>/
  space/<space id>/
  bot/<bot id>/
    <first words of the note>-<id>.md
```

Each note starts with a small header holding its id. Conversation history is not mirrored.

## Modes

Set in `.env` and recreate the worker:

```env
MEMORY_MIRROR_MODE=two-way
```

- unset or `off`: no mirror.
- `export`: the database is the source. Notes are written and refreshed, edits made in the
  folder are overwritten, and new files are left alone.
- `two-way`: edits to a note are imported, a new `.md` file inside a `bot/<id>/`, `space/<id>/` or
  `org/<id>/` folder becomes a memory, and deleting a note deletes the memory. If both sides
  changed the same note, the later change wins.

Optional: `MEMORY_MIRROR_DIR` (default `<data dir>/memory-mirror`) and
`MEMORY_MIRROR_INTERVAL_MS` (default 10000).

Safeguards: nothing is deleted when the folder is empty or most notes vanish in one pass, hidden
files and `.sync-conflict` copies are ignored, and a note whose memory was forgotten is removed.

## Syncthing on the server

```bash
docker compose --env-file .env -f docker-compose.images.yml -f docker-compose.syncthing.yml up -d
```

The web UI is on `127.0.0.1:8384` only. Open it through a tunnel, for example
`ssh -L 8384:127.0.0.1:8384 user@server`, then set a GUI password. Open TCP and UDP 22000 on the
server firewall.

## On a laptop

1. Install Syncthing and Obsidian.
2. In both Syncthing interfaces, add the other device by its device id and accept the request.
3. Share the server's memory folder with the laptop and choose a local folder for it.
4. In Obsidian, open that local folder as a vault.
