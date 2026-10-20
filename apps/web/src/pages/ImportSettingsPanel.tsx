import type { BotImportResult } from "@anviq/contracts";
import { Button } from "@anviq/ui-web";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";
import { readZipTextFiles } from "../lib/zip-read";

function counts(result: BotImportResult): string {
  return [
    plural(result.bots, { one: "# bot", other: "# bots" }),
    plural(result.routines, { one: "# routine", other: "# routines" }),
    plural(result.skills, { one: "# skill", other: "# skills" }),
    plural(result.memory, { one: "# note", other: "# notes" }),
  ].join(" · ");
}

/** Brings the bots of a Grok Bot export into this space. */
export function ImportSettingsPanel() {
  const rpc = useSpaceRpc();
  const { t } = useLingui();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [result, setResult] = useState<BotImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setFiles(null);
    try {
      const text = await readZipTextFiles(new Uint8Array(await file.arrayBuffer()));
      setResult(await rpc.botImport.run({ source: "grokbot", files: text, dryRun: true }));
      setFiles(text);
    } catch (err) {
      setError(errorText(err, t`Could not read the export`));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!files) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await rpc.botImport.run({ source: "grokbot", files, dryRun: false }));
      setFiles(null);
    } catch (err) {
      setError(errorText(err, t`Could not import`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-4" data-testid="import-settings">
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        hidden
        data-testid="import-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void choose(file);
        }}
      />
      <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {t`Choose Grok Bot export`}
      </Button>
      {result ? (
        <div className="flex flex-col items-start gap-3" data-testid="import-summary">
          <p className="text-sm text-foreground">{counts(result)}</p>
          {files ? (
            <Button disabled={busy} onClick={() => void apply()}>
              {t`Import`}
            </Button>
          ) : null}
          {result.skipped.length > 0 ? (
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer">
                {plural(result.skipped.length, { one: "# skipped", other: "# skipped" })}
              </summary>
              <ul className="mt-2 flex flex-col gap-1">
                {result.skipped.map((entry) => (
                  <li key={`${entry.item}:${entry.reason}`}>
                    {entry.item}: {entry.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
