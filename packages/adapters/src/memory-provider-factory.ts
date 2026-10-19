import type { DurableMemoryScope, SecretStore, SemanticMemoryProvider } from "@anviq/adapter-kit";
import type { PrismaClient } from "@anviq/db";
import {
  createMemoryEngine,
  type MemoryEngine,
  type MirrorMode,
  type MirrorResult,
} from "@anviq/memory-engine";
import { ANVIQ_MEMORY_PROVIDER_ID, AnviqMemoryProvider } from "./anviq-memory-provider.js";
import {
  classifySerenityConnectionSettings,
  createSerenityProvider,
  prepareSerenityConnection,
  SERENITY_PROVIDER_ID,
  serenityRequiresDeploymentOwner,
} from "./serenity-memory-provider.js";

export { MemoryProviderDeploymentOwnerRequiredError } from "./serenity-memory-provider.js";

import {
  assertSupermemoryLocalBaseUrl,
  createSupermemoryProvider,
  decodeLegacySupermemoryCredentials,
  prepareSupermemoryConnection,
  SUPERMEMORY_PROVIDER_ID,
  supermemoryRequiresDeploymentOwner,
} from "./supermemory-memory-provider.js";

export interface MemoryProviderConnectionInput {
  provider: string;
  settings: Record<string, string>;
  credentials: Record<string, string>;
  /** When false, Serenity must not probe endpoints that classify as private. */
  allowPrivateEndpoint?: boolean;
}

export interface PreparedMemoryProviderConnection {
  provider: string;
  settings: Record<string, string>;
  credentials: Record<string, string>;
}

export interface ConfiguredMemoryProvider {
  provider: SemanticMemoryProvider;
  defaultScope: DurableMemoryScope;
}

export interface MemoryProviderResolver {
  resolve(spaceId: string): Promise<ConfiguredMemoryProvider | null>;
  /** Remove built-in memories when their owner is deleted. */
  purgeBot?(botId: string): Promise<void>;
  purgeSpace?(spaceId: string): Promise<void>;
}

interface MemoryProviderAdapter {
  requiresDeploymentOwner(settings: Record<string, string>): boolean;
  /** Async trust classification (e.g. DNS) without probing credentials. */
  classifySettings?(settings: Record<string, string>): Promise<Record<string, string>>;
  prepare(
    settings: Record<string, string>,
    credentials: Record<string, string>,
    options?: { allowPrivateEndpoint?: boolean },
  ): Promise<{ settings: Record<string, string>; credentials: Record<string, string> }>;
  create(
    settings: Record<string, string>,
    credentials: Record<string, string>,
    engine: MemoryEngine,
  ): SemanticMemoryProvider;
  decodeLegacyCredentials?(plaintext: string): Record<string, string> | null;
}

const MEMORY_PROVIDER_ADAPTERS: ReadonlyMap<string, MemoryProviderAdapter> = new Map<
  string,
  MemoryProviderAdapter
>([
  [
    ANVIQ_MEMORY_PROVIDER_ID,
    {
      requiresDeploymentOwner: () => false,
      prepare: async () => ({ settings: {}, credentials: {} }),
      create: (_settings, _credentials, engine) => new AnviqMemoryProvider(engine),
    },
  ],
  [
    SUPERMEMORY_PROVIDER_ID,
    {
      requiresDeploymentOwner: supermemoryRequiresDeploymentOwner,
      prepare: prepareSupermemoryConnection,
      create: createSupermemoryProvider,
      decodeLegacyCredentials: decodeLegacySupermemoryCredentials,
    },
  ],
  [
    SERENITY_PROVIDER_ID,
    {
      requiresDeploymentOwner: serenityRequiresDeploymentOwner,
      classifySettings: classifySerenityConnectionSettings,
      prepare: (
        settings: Record<string, string>,
        credentials: Record<string, string>,
        options?: { allowPrivateEndpoint?: boolean },
      ) => prepareSerenityConnection(settings, credentials, undefined, options),
      create: createSerenityProvider,
    },
  ],
]);

function memoryProviderAdapter(provider: string): MemoryProviderAdapter {
  const adapter = MEMORY_PROVIDER_ADAPTERS.get(provider);
  if (!adapter) throw new Error(`Unknown memory provider "${provider}".`);
  return adapter;
}

/** Adapters classify their settings; callers enforce the deployment trust boundary. */
export function memoryProviderRequiresDeploymentOwner(
  provider: string,
  settings: Record<string, string>,
): boolean {
  return memoryProviderAdapter(provider).requiresDeploymentOwner(settings);
}

/**
 * Run provider-specific trust classification (DNS, etc.) without credentialed probes.
 * Callers must authorize deployment-owner endpoints before prepare/probe.
 */
export async function classifyMemoryProviderSettings(
  provider: string,
  settings: Record<string, string>,
): Promise<Record<string, string>> {
  const adapter = memoryProviderAdapter(provider);
  return adapter.classifySettings ? adapter.classifySettings(settings) : settings;
}

export async function prepareMemoryProviderConnection(
  input: MemoryProviderConnectionInput,
): Promise<PreparedMemoryProviderConnection> {
  const prepared = await memoryProviderAdapter(input.provider).prepare(
    input.settings,
    input.credentials,
    { allowPrivateEndpoint: input.allowPrivateEndpoint },
  );
  return { provider: input.provider, ...prepared };
}

export function createMemoryProvider(
  provider: string,
  settings: Record<string, string>,
  credentials: Record<string, string>,
  engine: MemoryEngine,
): SemanticMemoryProvider {
  return memoryProviderAdapter(provider).create(settings, credentials, engine);
}

export function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function decodeCredentials(provider: string, plaintext: string): Record<string, string> {
  try {
    const credentials = toStringRecord(JSON.parse(plaintext));
    if (Object.keys(credentials).length > 0) return credentials;
  } catch {
    // Configurations created before the generic provider boundary stored the API key directly.
  }
  const legacyCredentials = memoryProviderAdapter(provider).decodeLegacyCredentials?.(plaintext);
  if (legacyCredentials) return legacyCredentials;
  throw new Error(`Stored credentials for memory provider "${provider}" are invalid.`);
}

export class SpaceMemoryProviderResolver implements MemoryProviderResolver {
  private readonly engine: MemoryEngine;

  constructor(
    private readonly prisma: Pick<
      PrismaClient,
      "spaceMemoryConfig" | "deploymentSettings" | "bot" | "$queryRawUnsafe"
    >,
    private readonly secrets: SecretStore,
  ) {
    this.engine = createMemoryEngine(async (sql, params = []) => ({
      rows: await prisma.$queryRawUnsafe(sql, ...params),
    }));
  }

  async purgeBot(botId: string): Promise<void> {
    await this.engine.purgeBot(botId);
  }

  async purgeSpace(spaceId: string): Promise<void> {
    await this.engine.purgeSpace(spaceId);
  }

  syncMirror(options: { dir: string; mode: MirrorMode }): Promise<MirrorResult> {
    return this.engine.syncFolder({
      ...options,
      resolveSpaceId: async (botId) =>
        (await this.prisma.bot.findUnique({ where: { id: botId }, select: { spaceId: true } }))
          ?.spaceId,
    });
  }

  async resolve(spaceId: string): Promise<ConfiguredMemoryProvider | null> {
    const config = await this.prisma.spaceMemoryConfig.findUnique({
      where: { spaceId },
      include: { secret: true },
    });
    if (!config) {
      return {
        provider: createMemoryProvider(ANVIQ_MEMORY_PROVIDER_ID, {}, {}, this.engine),
        defaultScope: "isolated",
      };
    }
    if (config.provider === ANVIQ_MEMORY_PROVIDER_ID) {
      return {
        provider: createMemoryProvider(config.provider, {}, {}, this.engine),
        defaultScope: config.defaultMemoryScope === "shared" ? "shared" : "isolated",
      };
    }
    const settings = toStringRecord(config.settings);
    if (memoryProviderRequiresDeploymentOwner(config.provider, settings)) {
      const deployment = await this.prisma.deploymentSettings.findUnique({
        where: { id: "default" },
        select: { ownerUserId: true },
      });
      // Also disable pre-existing local configurations authored outside the deployment boundary.
      if (!deployment?.ownerUserId || deployment.ownerUserId !== config.userId) return null;
    }
    if (
      config.provider === SUPERMEMORY_PROVIDER_ID &&
      settings.mode === "local" &&
      settings.baseUrl
    ) {
      await assertSupermemoryLocalBaseUrl(settings.baseUrl, { allowPrivateEndpoint: true });
    }
    const credentials = decodeCredentials(
      config.provider,
      await this.secrets.load(config.secret.ciphertext, config.secret.id),
    );
    return {
      provider: createMemoryProvider(config.provider, settings, credentials, this.engine),
      defaultScope: config.defaultMemoryScope === "shared" ? "shared" : "isolated",
    };
  }
}
