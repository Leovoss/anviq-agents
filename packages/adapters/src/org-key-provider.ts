// Copyright 2026 Anviq LLC. All rights reserved.
import type { KeyProvider, KeyWrapContext, WrappedDataKey } from "@anviq/adapter-kit";
import type { OrgKeyConfig } from "@anviq/db";

export interface OrgKeyLookup {
  forSpace(spaceId: string): Promise<OrgKeyConfig | undefined>;
}

interface Cached {
  config: OrgKeyConfig | undefined;
  expiresAt: number;
}

/**
 * Wraps the space keys of an organization with that organization's own KMS key, and everything else
 * with the deployment's provider. The customer owns the key: every wrap and unwrap is theirs to audit,
 * and revoking it makes their space keys, and so their content, unreadable.
 */
export class OrgKeyProvider implements KeyProvider {
  private readonly cache = new Map<string, Cached>();
  private readonly kms = new Map<string, KeyProvider>();

  constructor(
    private readonly base: KeyProvider,
    private readonly lookup: OrgKeyLookup,
    private readonly kmsFor: (keyArn: string) => KeyProvider,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  describe() {
    return this.base.describe();
  }

  activeKeyId(): string {
    return this.base.activeKeyId();
  }

  async activeKeyIdFor(spaceId: string): Promise<string> {
    const arn = (await this.config(spaceId))?.keyArn;
    return arn ? this.provider(arn).activeKeyId() : this.base.activeKeyId();
  }

  async wrap(dataKey: Uint8Array, context: KeyWrapContext): Promise<WrappedDataKey> {
    const arn = (await this.config(context.spaceId))?.keyArn;
    return (arn ? this.provider(arn) : this.base).wrap(dataKey, context);
  }

  async unwrap(wrapped: WrappedDataKey, context: KeyWrapContext): Promise<Uint8Array> {
    const config = await this.config(context.spaceId);
    for (const arn of [config?.keyArn, ...(config?.previousKeyArns ?? [])]) {
      if (arn && this.provider(arn).activeKeyId() === wrapped.masterKeyId)
        return this.provider(arn).unwrap(wrapped, context);
    }
    return this.base.unwrap(wrapped, context);
  }

  private provider(keyArn: string): KeyProvider {
    let provider = this.kms.get(keyArn);
    if (!provider) {
      provider = this.kmsFor(keyArn);
      this.kms.set(keyArn, provider);
    }
    return provider;
  }

  /** Settings change rarely, so they are read at most once a minute per space. */
  private async config(spaceId: string): Promise<OrgKeyConfig | undefined> {
    const cached = this.cache.get(spaceId);
    if (cached && cached.expiresAt > this.now()) return cached.config;
    const config = await this.lookup.forSpace(spaceId);
    this.cache.set(spaceId, { config, expiresAt: this.now() + this.ttlMs });
    return config;
  }
}
