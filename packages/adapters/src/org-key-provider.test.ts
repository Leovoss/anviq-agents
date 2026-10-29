// Copyright 2026 Anviq LLC. All rights reserved.
import { randomBytes } from "node:crypto";
import type { KeyProvider, KeyWrapContext, WrappedDataKey } from "@anviq/adapter-kit";
import type { OrgKeyConfig } from "@anviq/db";
import { describe, expect, it, vi } from "vitest";
import { OrgKeyProvider } from "./org-key-provider.js";

/** Wraps by tagging, which is enough to see which provider handled a key. */
function fakeProvider(id: string, options: { revoked?: () => boolean } = {}): KeyProvider {
  const wrap = async (dataKey: Uint8Array, context: KeyWrapContext): Promise<WrappedDataKey> => ({
    masterKeyId: id,
    wrappedKey: `${context.spaceId}:${context.version}:${Buffer.from(dataKey).toString("base64url")}`,
  });
  return {
    describe: () => ({
      id,
      contractVersion: "1",
      adapterVersion: "0",
      capabilities: { rotate: true },
    }),
    activeKeyId: () => id,
    wrap,
    async unwrap(wrapped, context) {
      if (wrapped.masterKeyId !== id)
        throw new Error(`Master key ${wrapped.masterKeyId} is not configured`);
      if (options.revoked?.()) throw new Error("access to the key was revoked");
      const [space, version, body] = wrapped.wrappedKey.split(":");
      if (space !== context.spaceId || version !== String(context.version))
        throw new Error("wrong context");
      return Buffer.from(body!, "base64url");
    },
  };
}

const arn = (name: string) => `arn:aws:kms:eu-central-1:111111111111:key/${name}`;
const ctx = (spaceId: string): KeyWrapContext => ({ spaceId, version: 1 });

function setup(configs: Record<string, OrgKeyConfig | undefined>, ttlMs = 60_000) {
  const clock = { now: 0 };
  const lookup = { forSpace: vi.fn(async (spaceId: string) => configs[spaceId]) };
  const kms = new Map<string, KeyProvider>();
  const revoked = new Set<string>();
  const provider = new OrgKeyProvider(
    fakeProvider("deployment"),
    lookup,
    (keyArn) => {
      const made = fakeProvider(`kms:${keyArn}`, { revoked: () => revoked.has(keyArn) });
      kms.set(keyArn, made);
      return made;
    },
    ttlMs,
    () => clock.now,
  );
  return { provider, lookup, clock, revoked, configs };
}

const dataKey = randomBytes(32);

describe("OrgKeyProvider", () => {
  it("wraps a space with no organization key under the deployment provider", async () => {
    const { provider } = setup({ plain: undefined });
    const wrapped = await provider.wrap(dataKey, ctx("plain"));
    expect(wrapped.masterKeyId).toBe("deployment");
    expect(Buffer.from(await provider.unwrap(wrapped, ctx("plain")))).toEqual(dataKey);
    expect(await provider.activeKeyIdFor("plain")).toBe("deployment");
  });

  it("wraps and unwraps an organization's spaces under its own key", async () => {
    const config = { organizationId: "org-a", keyArn: arn("a"), previousKeyArns: [] };
    const { provider } = setup({ acme: config });
    const wrapped = await provider.wrap(dataKey, ctx("acme"));
    expect(wrapped.masterKeyId).toBe(`kms:${arn("a")}`);
    expect(Buffer.from(await provider.unwrap(wrapped, ctx("acme")))).toEqual(dataKey);
    expect(await provider.activeKeyIdFor("acme")).toBe(`kms:${arn("a")}`);
  });

  it("stops unwrapping when the company revokes its key", async () => {
    const config = { organizationId: "org-a", keyArn: arn("a"), previousKeyArns: [] };
    const { provider, revoked } = setup({ acme: config });
    const wrapped = await provider.wrap(dataKey, ctx("acme"));
    revoked.add(arn("a"));
    await expect(provider.unwrap(wrapped, ctx("acme"))).rejects.toThrow("revoked");
  });

  it("does not unwrap one organization's key for another organization's space", async () => {
    const { provider } = setup({
      acme: { organizationId: "org-a", keyArn: arn("a"), previousKeyArns: [] },
      globex: { organizationId: "org-b", keyArn: arn("b"), previousKeyArns: [] },
    });
    const wrapped = await provider.wrap(dataKey, ctx("acme"));
    await expect(provider.unwrap(wrapped, ctx("globex"))).rejects.toThrow("not configured");
  });

  it("keeps unwrapping under a previous key until the keys are re-wrapped", async () => {
    const setupResult = setup({
      acme: { organizationId: "org-a", keyArn: arn("old"), previousKeyArns: [] },
    });
    const { provider, configs, clock } = setupResult;
    const wrapped = await provider.wrap(dataKey, ctx("acme"));
    configs.acme = { organizationId: "org-a", keyArn: arn("new"), previousKeyArns: [arn("old")] };
    clock.now += 61_000;

    expect(Buffer.from(await provider.unwrap(wrapped, ctx("acme")))).toEqual(dataKey);
    expect((await provider.wrap(dataKey, ctx("acme"))).masterKeyId).toBe(`kms:${arn("new")}`);
  });

  it("goes back to the deployment key for new wraps after the setting is cleared", async () => {
    const { provider, configs, clock } = setup({
      acme: { organizationId: "org-a", keyArn: arn("a"), previousKeyArns: [] },
    });
    const wrapped = await provider.wrap(dataKey, ctx("acme"));
    configs.acme = { organizationId: "org-a", keyArn: "", previousKeyArns: [arn("a")] };
    clock.now += 61_000;

    expect((await provider.wrap(dataKey, ctx("acme"))).masterKeyId).toBe("deployment");
    expect(Buffer.from(await provider.unwrap(wrapped, ctx("acme")))).toEqual(dataKey);
  });

  it("reads a space's setting once per minute", async () => {
    const { provider, lookup, clock } = setup({ acme: undefined });
    await provider.wrap(dataKey, ctx("acme"));
    await provider.wrap(dataKey, ctx("acme"));
    expect(lookup.forSpace).toHaveBeenCalledTimes(1);
    clock.now += 61_000;
    await provider.wrap(dataKey, ctx("acme"));
    expect(lookup.forSpace).toHaveBeenCalledTimes(2);
  });
});
