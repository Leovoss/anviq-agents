import type { KeyProvider } from "@anviq/adapter-kit";
import type { DbClientOptions } from "@anviq/db";
import {
  LocalKeyProvider,
  lazyKeyProvider,
  masterKeysFromEnv,
  PgOrgKeyLookup,
  withLocalMasterKeys,
} from "@anviq/db";
import { AwsKmsKeyProvider, awsKmsConfigFromEnv } from "./aws-kms-key-provider.js";
import { OrgKeyProvider } from "./org-key-provider.js";

type KeyProviderOption = NonNullable<DbClientOptions["keyProvider"]>;

/**
 * `MASTER_KEY_PROVIDER` picks who wraps space keys. Undefined keeps createDb's default,
 * the local master keys. A key manager wraps new keys while local ones keep unwrapping.
 *
 * With AWS credentials set, an organization can also bring its own KMS key (see
 * `content-encryption org-key`): its space keys are wrapped by that key, and every other
 * space by the provider above.
 */
export function contentKeyProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): KeyProviderOption | undefined {
  const provider = env.MASTER_KEY_PROVIDER?.trim() || "local";
  if (provider !== "local" && provider !== "aws-kms")
    throw new Error("Unsupported MASTER_KEY_PROVIDER");
  const local = () => new LocalKeyProvider(masterKeysFromEnv(env));
  // Configuration errors surface at startup; local master keys are read on first use.
  const external =
    provider === "aws-kms" ? new AwsKmsKeyProvider(awsKmsConfigFromEnv(env)) : undefined;
  const base: KeyProvider | undefined =
    external && lazyKeyProvider(() => withLocalMasterKeys(external, local()));
  const accessKeyId = env.AWS_KMS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_KMS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return base;
  return (keyPool) =>
    new OrgKeyProvider(
      base ?? lazyKeyProvider(local),
      new PgOrgKeyLookup(keyPool),
      (keyArn) => new AwsKmsKeyProvider({ keyArn, accessKeyId, secretAccessKey }),
    );
}
