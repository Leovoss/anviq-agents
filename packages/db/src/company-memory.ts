// Copyright 2026 Anviq LLC. All rights reserved.
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { managerOf, membership, OrganizationError } from "./organizations.js";
import { runAsSystem } from "./row-security.js";
import { withTransactionRetry } from "./transaction-retry.js";

export const COMPANY_MEMORY_PATH = "company.md";
export const COMPANY_MEMORY_MAX_CHARS = 20_000;
const SCOPE = "org";

/**
 * Company memory is one markdown document kept in the team's general space, so it is sealed with
 * that space's key and keeps a revision history like any other memory. Its owner is the team itself,
 * never a person, so no person's own memory listing, export or search ever returns it.
 */
const companyOwner = (organizationId: string) => `org:${organizationId}`;

async function generalSpaceOf(prisma: Pick<PrismaClient, "space">, organizationId: string) {
  const space = await prisma.space.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });
  if (!space) throw new OrganizationError("NOT_FOUND", "Team not found");
  return space.id;
}

export interface CompanyMemoryView {
  content: string;
  revision: number;
  updatedAt: Date | null;
  canEdit: boolean;
}

/** What the team's bots all know. Any member may read it; only an owner or admin may change it. */
export async function readCompanyMemory(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<CompanyMemoryView> {
  const role = await membership(prisma, userId, organizationId);
  const spaceId = await generalSpaceOf(prisma, organizationId);
  const doc = await runAsSystem("read company memory", () =>
    prisma.memoryDocument.findFirst({
      where: {
        spaceId,
        userId: companyOwner(organizationId),
        scope: SCOPE,
        botId: null,
        path: COMPANY_MEMORY_PATH,
      },
    }),
  );
  return {
    content: doc?.content ?? "",
    revision: doc?.revision ?? 0,
    updatedAt: doc?.updatedAt ?? null,
    canEdit: role === "owner" || role === "admin",
  };
}

export async function writeCompanyMemory(
  prisma: PrismaClient,
  input: { userId: string; organizationId: string; content: string; expectedRevision?: number },
): Promise<{ revision: number }> {
  await managerOf(prisma, input.userId, input.organizationId);
  if (input.content.length > COMPANY_MEMORY_MAX_CHARS)
    throw new OrganizationError("INVALID", "Company memory is too long");
  const spaceId = await generalSpaceOf(prisma, input.organizationId);
  const userId = companyOwner(input.organizationId);
  return runAsSystem("write company memory", () =>
    withTransactionRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const existing = await tx.memoryDocument.findFirst({
            where: { spaceId, userId, scope: SCOPE, botId: null, path: COMPANY_MEMORY_PATH },
          });
          if (
            input.expectedRevision !== undefined &&
            (existing?.revision ?? 0) !== input.expectedRevision
          )
            throw new OrganizationError("CONFLICT", "Someone else changed company memory first");
          const doc = existing
            ? await tx.memoryDocument.update({
                where: { id: existing.id },
                data: { content: input.content, revision: existing.revision + 1 },
              })
            : await tx.memoryDocument.create({
                data: {
                  spaceId,
                  userId,
                  scope: SCOPE,
                  path: COMPANY_MEMORY_PATH,
                  content: input.content,
                },
              });
          await tx.memoryRevision.create({
            data: { documentId: doc.id, revision: doc.revision, content: input.content },
          });
          return { revision: doc.revision };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    ),
  );
}

/**
 * The company memory that applies to a run in this space, or nothing for a personal workspace.
 * A run carries no person's authority over a team, so this reads as the system and returns only
 * the team's own document.
 */
export async function companyMemoryForSpace(
  prisma: PrismaClient,
  spaceId: string,
): Promise<string | undefined> {
  return runAsSystem("read company memory for a run", async () => {
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      select: { organizationId: true, organization: { select: { metadata: true } } },
    });
    if (!space?.organization.metadata?.includes('"kind":"team"')) return undefined;
    const general = await prisma.space.findFirst({
      where: { organizationId: space.organizationId, isDefault: true },
      select: { id: true },
    });
    if (!general) return undefined;
    const doc = await prisma.memoryDocument.findFirst({
      where: {
        spaceId: general.id,
        userId: companyOwner(space.organizationId),
        scope: SCOPE,
        botId: null,
        path: COMPANY_MEMORY_PATH,
      },
      select: { content: true },
    });
    return doc?.content.trim() ? doc.content : undefined;
  });
}
