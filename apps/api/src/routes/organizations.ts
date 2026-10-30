// Copyright 2026 Anviq LLC. All rights reserved.
import { teamInvitationEmail } from "@anviq/auth";
import {
  acceptInvitation,
  cancelInvitation,
  createOrganization,
  inviteToOrganization,
  leaveOrganization,
  listInvitations,
  listMyInvitations,
  listOrganizationMembers,
  listTeams,
  OrganizationError,
  removeMember,
  runAsSystem,
  setMemberRole,
  transferOwnership,
} from "@anviq/db";
import { getLogger } from "@anviq/logging";
import { ORPCError } from "@orpc/server";
import type { RouterContext } from "./context.js";

const CODES = {
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  INVALID: "BAD_REQUEST",
  CONFLICT: "CONFLICT",
  LIMIT: "BAD_REQUEST",
} as const;

/** Reports a broken membership rule as the matching API error; anything else is not ours to describe. */
async function reportRules<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof OrganizationError)
      throw new ORPCError(CODES[error.code], { message: error.message });
    throw error;
  }
}

const iso = (date: Date) => date.toISOString();
const done = { ok: true as const };

/**
 * Team membership. These calls act across spaces on behalf of the signed-in person, so they run as
 * the system and every function checks the caller's own membership and role before it reads or writes.
 */
export function organizationsRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const prisma = deps.prisma;
  const system = <T>(work: () => Promise<T>) =>
    reportRules(() => runAsSystem("team membership", work));
  return {
    organizations: {
      list: authed.organizations.list.handler(({ context }) =>
        system(() => listTeams(prisma, context.actor.userId)),
      ),
      create: authed.organizations.create.handler(({ context, input }) =>
        system(() =>
          createOrganization(prisma, { userId: context.actor.userId, name: input.name }),
        ),
      ),
      members: authed.organizations.members.handler(({ context, input }) =>
        system(async () =>
          (await listOrganizationMembers(prisma, context.actor.userId, input.organizationId)).map(
            (member) => ({ ...member, joinedAt: iso(member.joinedAt) }),
          ),
        ),
      ),
      setRole: authed.organizations.setRole.handler(({ context, input }) =>
        system(async () => {
          await setMemberRole(prisma, {
            userId: context.actor.userId,
            organizationId: input.organizationId,
            targetUserId: input.userId,
            role: input.role,
          });
          return done;
        }),
      ),
      transferOwnership: authed.organizations.transferOwnership.handler(({ context, input }) =>
        system(async () => {
          await transferOwnership(prisma, {
            userId: context.actor.userId,
            organizationId: input.organizationId,
            targetUserId: input.userId,
          });
          return done;
        }),
      ),
      removeMember: authed.organizations.removeMember.handler(({ context, input }) =>
        system(async () => {
          await removeMember(prisma, {
            userId: context.actor.userId,
            organizationId: input.organizationId,
            targetUserId: input.userId,
          });
          return done;
        }),
      ),
      leave: authed.organizations.leave.handler(({ context, input }) =>
        system(async () => {
          await leaveOrganization(prisma, {
            userId: context.actor.userId,
            organizationId: input.organizationId,
          });
          return done;
        }),
      ),
      invitations: authed.organizations.invitations.handler(({ context, input }) =>
        system(async () =>
          (await listInvitations(prisma, context.actor.userId, input.organizationId)).map(
            (invitation) => ({ ...invitation, expiresAt: iso(invitation.expiresAt) }),
          ),
        ),
      ),
      invite: authed.organizations.invite.handler(({ context, input }) =>
        system(async () => {
          const { invitation, organizationName, inviterName } = await inviteToOrganization(prisma, {
            userId: context.actor.userId,
            organizationId: input.organizationId,
            email: input.email,
            role: input.role,
          });
          if (deps.email) {
            const url = new URL(`/accept-invitation/${invitation.id}`, deps.env.webOrigin).href;
            // The invitation exists either way; a delivery failure is reported, and the invite can be resent.
            await deps.email
              .send(
                await teamInvitationEmail(invitation.email, { organizationName, inviterName, url }),
              )
              .catch((error) => getLogger().error("team invitation email failed", error));
          }
          return { ...invitation, expiresAt: iso(invitation.expiresAt) };
        }),
      ),
      cancelInvitation: authed.organizations.cancelInvitation.handler(({ context, input }) =>
        system(async () => {
          await cancelInvitation(prisma, context.actor.userId, input.invitationId);
          return done;
        }),
      ),
      myInvitations: authed.organizations.myInvitations.handler(({ context }) =>
        system(async () =>
          (await listMyInvitations(prisma, context.actor.userId)).map((invitation) => ({
            ...invitation,
            expiresAt: iso(invitation.expiresAt),
          })),
        ),
      ),
      acceptInvitation: authed.organizations.acceptInvitation.handler(({ context, input }) =>
        system(() =>
          acceptInvitation(prisma, {
            userId: context.actor.userId,
            invitationId: input.invitationId,
          }),
        ),
      ),
    },
  };
}
