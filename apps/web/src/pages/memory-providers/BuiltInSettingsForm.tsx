// Copyright 2026 Anviq LLC. All rights reserved.
import { Button } from "@anviq/ui-web";
import { Trans } from "@lingui/react/macro";
import type { MemoryProviderSettingsFormProps } from "./registry";

export function BuiltInSettingsForm({ busy, onConnect }: MemoryProviderSettingsFormProps) {
  return (
    <Button
      type="button"
      disabled={busy}
      onClick={() => void onConnect({ settings: {}, credentials: {} })}
    >
      <Trans>Use built-in memory</Trans>
    </Button>
  );
}
