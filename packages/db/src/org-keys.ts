// Copyright 2026 Anviq LLC. All rights reserved.
import type { PrismaClient } from "./generated/prisma/client.js";

export interface OrgKeyConfig {
  organizationId: string;
  /** The customer's KMS key ARN that wraps the space keys of the organization. */
  keyArn: string;
  /** Earlier keys, kept so space keys wrapped under them still unwrap until they are re-wrapped. */
  previousKeyArns: string[];
}

interface Queryable {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

/** Reads an organization's key setting by space, on the same small pool the space keys use. */
export class PgOrgKeyLookup {
  constructor(private readonly db: Queryable) {}

  async forSpace(spaceId: string): Promise<OrgKeyConfig | undefined> {
    const { rows } = await this.db.query<OrgKeyConfig>(
      `SELECT k."organizationId", k."keyArn", k."previousKeyArns"
       FROM organization_key_configs k JOIN spaces s ON s."organizationId" = k."organizationId"
       WHERE s.id = $1`,
      [spaceId],
    );
    return rows[0];
  }
}

export async function organizationKeys(prisma: PrismaClient): Promise<OrgKeyConfig[]> {
  return prisma.organizationKeyConfig.findMany({
    select: { organizationId: true, keyArn: true, previousKeyArns: true },
    orderBy: { organizationId: "asc" },
  });
}

/**
 * Points an organization at a customer KMS key. The key it replaces moves to `previousKeyArns`, so
 * keys wrapped under it keep unwrapping until `content-encryption rotate` has moved them.
 */
export async function setOrganizationKey(
  prisma: PrismaClient,
  organizationId: string,
  keyArn: string,
): Promise<OrgKeyConfig> {
  const existing = await prisma.organizationKeyConfig.findUnique({ where: { organizationId } });
  if (existing?.keyArn === keyArn) return existing;
  const previousKeyArns = existing
    ? [...new Set([existing.keyArn, ...existing.previousKeyArns])].filter((arn) => arn !== keyArn)
    : [];
  return prisma.organizationKeyConfig.upsert({
    where: { organizationId },
    create: { organizationId, keyArn, previousKeyArns },
    update: { keyArn, previousKeyArns },
  });
}

/** Back to the deployment key. The old key stays listed until the space keys are re-wrapped. */
export async function clearOrganizationKey(
  prisma: PrismaClient,
  organizationId: string,
): Promise<boolean> {
  const existing = await prisma.organizationKeyConfig.findUnique({ where: { organizationId } });
  if (!existing) return false;
  await prisma.organizationKeyConfig.update({
    where: { organizationId },
    data: {
      keyArn: "",
      previousKeyArns: [...new Set([existing.keyArn, ...existing.previousKeyArns])].filter(Boolean),
    },
  });
  return true;
}
