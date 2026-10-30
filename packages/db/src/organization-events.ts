// Copyright 2026 Anviq LLC. All rights reserved.
import { getLogger } from "@anviq/logging";
import type { PrismaClient } from "./client.js";
import { managerOf } from "./organizations.js";

export const ORGANIZATION_EVENT_TYPES = [
  "team.created",
  "member.invited",
  "member.joined",
  "member.removed",
  "member.left",
  "member.role_changed",
  "ownership.transferred",
  "memory.updated",
  "memory.proposed",
  "memory.approved",
  "memory.rejected",
  "chat.shared",
  "chat.unshared",
] as const;
export type OrganizationEventType = (typeof ORGANIZATION_EVENT_TYPES)[number];

/** Notes what happened for the team's admins. Never throws: a failed note must not undo the action. */
export async function recordOrganizationEvent(
  prisma: Pick<PrismaClient, "organizationEvent">,
  input: {
    organizationId: string;
    actorUserId: string;
    type: OrganizationEventType;
    subject?: string;
  },
): Promise<void> {
  try {
    await prisma.organizationEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        type: input.type,
        subject: input.subject?.slice(0, 254),
      },
    });
  } catch (error) {
    getLogger().error("organization event", error);
  }
}

export interface OrganizationEventView {
  id: string;
  type: OrganizationEventType;
  actorName: string;
  subject: string | null;
  createdAt: Date;
}

/** The newest events first, for an owner or admin. */
export async function listOrganizationEvents(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  limit = 50,
): Promise<OrganizationEventView[]> {
  await managerOf(prisma, userId, organizationId);
  const rows = await prisma.organizationEvent.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });
  const actors = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.actorUserId))] } },
    select: { id: true, name: true },
  });
  const names = new Map(actors.map((actor) => [actor.id, actor.name]));
  return rows.map((row) => ({
    id: row.id,
    type: row.type as OrganizationEventType,
    actorName: names.get(row.actorUserId) ?? "Someone",
    subject: row.subject,
    createdAt: row.createdAt,
  }));
}
