// Copyright 2026 Anviq LLC. All rights reserved.
import type { Actor } from "@anviq/contracts";
import type { PrismaClient } from "./client.js";
import { lockOwnedGroup } from "./groups.js";
import { OrganizationError } from "./organizations.js";
import { withTransactionRetry } from "./transaction-retry.js";

export const SHARED_CHAT_MAX_PEOPLE = 50;

/**
 * Chooses who else takes part in a group the host owns. Everyone must belong to the group's
 * space, and the space must be a team's. Adding people to a chat that already has messages is
 * refused until it is cleared, so a conversation held in private is never handed to someone
 * who joins later. An empty list makes the group private again.
 */
export async function setGroupParticipants(
  prisma: PrismaClient,
  actor: Pick<Actor, "spaceId" | "userId">,
  input: { groupId: string; userIds: string[] },
): Promise<void> {
  const guests = [...new Set(input.userIds)].filter((userId) => userId !== actor.userId);
  if (guests.length + 1 > SHARED_CHAT_MAX_PEOPLE)
    throw new OrganizationError("LIMIT", "Too many people in one chat");
  await withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockOwnedGroup(tx, actor, input.groupId);
      const group = await tx.chatGroup.findFirst({
        where: { id: input.groupId, spaceId: actor.spaceId, userId: actor.userId },
        select: {
          space: { select: { organization: { select: { metadata: true } } } },
          participants: { select: { userId: true } },
          thread: { select: { id: true, nextMessageSeq: true } },
        },
      });
      if (!group?.thread) throw new OrganizationError("NOT_FOUND", "Chat not found");
      const current = new Set(group.participants.map((row) => row.userId));
      const wanted = new Set(guests);
      if (guests.length === 0) {
        await tx.chatGroupParticipant.deleteMany({ where: { groupId: input.groupId } });
        return;
      }
      if (!group.space.organization.metadata?.includes('"kind":"team"'))
        throw new OrganizationError("INVALID", "Chats are shared inside a team");
      const members = await tx.spaceMember.findMany({
        where: { spaceId: actor.spaceId, userId: { in: guests } },
        select: { userId: true },
      });
      if (members.length !== guests.length)
        throw new OrganizationError("INVALID", "Only people in this space can join");
      const adding = guests.some((userId) => !current.has(userId));
      if (
        adding &&
        current.size < 2 &&
        (await tx.message.count({ where: { threadId: group.thread.id } })) > 0
      )
        throw new OrganizationError("INVALID", "Clear this chat before sharing it");
      const stale = [...current].filter((userId) => userId !== actor.userId && !wanted.has(userId));
      if (stale.length)
        await tx.chatGroupParticipant.deleteMany({
          where: { groupId: input.groupId, userId: { in: stale } },
        });
      const toAdd = [actor.userId, ...guests].filter((userId) => !current.has(userId));
      if (toAdd.length) {
        const seen = group.thread.nextMessageSeq - 1;
        await tx.chatGroupParticipant.createMany({
          data: toAdd.map((userId) => ({ groupId: input.groupId, userId, lastReadSeq: seen })),
        });
      }
    }),
  );
}

/** A guest leaves a chat shared with them. The host keeps it and cannot leave their own. */
export async function leaveSharedGroup(
  prisma: PrismaClient,
  actor: Pick<Actor, "spaceId" | "userId">,
  groupId: string,
): Promise<void> {
  await withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      const group = await tx.chatGroup.findFirst({
        where: {
          id: groupId,
          spaceId: actor.spaceId,
          participants: { some: { userId: actor.userId } },
        },
        select: { userId: true, participants: { select: { userId: true } } },
      });
      if (!group) throw new OrganizationError("NOT_FOUND", "Chat not found");
      if (group.userId === actor.userId)
        throw new OrganizationError("FORBIDDEN", "The host cannot leave their own chat");
      await tx.chatGroupParticipant.deleteMany({ where: { groupId, userId: actor.userId } });
      // A chat left with only its host is private again.
      if (group.participants.length <= 2)
        await tx.chatGroupParticipant.deleteMany({ where: { groupId } });
    }),
  );
}

/** Records that a person has read a shared chat up to a message. */
export async function markParticipantRead(
  prisma: Pick<PrismaClient, "chatGroupParticipant">,
  input: { groupId: string; userId: string; seq: number },
): Promise<void> {
  await prisma.chatGroupParticipant.updateMany({
    where: { groupId: input.groupId, userId: input.userId, lastReadSeq: { lt: input.seq } },
    data: { lastReadSeq: input.seq },
  });
}
