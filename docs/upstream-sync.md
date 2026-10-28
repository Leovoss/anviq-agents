# Syncing upstream

Anviq Agents follows [rakazo](https://github.com/elie222/rakazo). The `upstream` remote points at it and
`anviq-upstream` is a branch holding upstream with the Anviq rename already applied, so merges only
conflict where Anviq really diverges.

```bash
git remote add upstream https://github.com/elie222/rakazo.git   # once
scripts/upstream/sync.sh v0.3.0                                  # or upstream/main
git switch -c sync-upstream main
git merge anviq-upstream
```

If `pnpm-lock.yaml` conflicts, take the incoming side and run `pnpm install --lockfile-only`. Run
`pnpm check` and `pnpm test` before merging into `main`.

Never merge `upstream/*` directly, and do not use GitHub's "Sync fork" button: both bring the
unrenamed code straight into `main`.

## Rename rules

`scripts/upstream/rebrand.mjs` holds the rename rules and the list of upstream paths that are
dropped. It fails when it finds an upstream name it does not know, so add a rule there and run the
sync again. Files listed in `DROP` do not exist in `anviq-upstream`, so upstream edits to them never
conflict.
