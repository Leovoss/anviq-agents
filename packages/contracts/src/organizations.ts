// Copyright 2026 Anviq LLC. All rights reserved.
import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

export const OrganizationRoleSchema = z.enum(["owner", "admin", "member"]);
export type OrganizationRole = z.infer<typeof OrganizationRoleSchema>;

const teamName = z.string().trim().min(1).max(60);
const emailAddress = z.string().trim().email().max(254);

export const TeamSchema = z.object({
  id: Id,
  name: z.string(),
  role: OrganizationRoleSchema,
  memberCount: z.number().int().nonnegative(),
  spaceId: Id,
});
export type Team = z.infer<typeof TeamSchema>;

export const TeamMemberSchema = z.object({
  userId: Id,
  name: z.string(),
  email: z.string(),
  role: OrganizationRoleSchema,
  joinedAt: IsoDate,
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

export const TeamInvitationSchema = z.object({
  id: Id,
  email: z.string(),
  role: OrganizationRoleSchema,
  expiresAt: IsoDate,
});
export type TeamInvitation = z.infer<typeof TeamInvitationSchema>;

/** An invitation addressed to the signed-in person's own verified email. */
export const MyTeamInvitationSchema = z.object({
  id: Id,
  organizationName: z.string(),
  inviterName: z.string(),
  role: OrganizationRoleSchema,
  expiresAt: IsoDate,
});
export type MyTeamInvitation = z.infer<typeof MyTeamInvitationSchema>;

export const CompanyMemorySchema = z.object({
  content: z.string(),
  revision: z.number().int().nonnegative(),
  updatedAt: IsoDate.nullable(),
  canEdit: z.boolean(),
});
export type CompanyMemory = z.infer<typeof CompanyMemorySchema>;
export const SetCompanyMemoryInput = z.object({
  organizationId: Id,
  content: z.string().max(20_000),
  expectedRevision: z.number().int().nonnegative().optional(),
});

export const MemoryProposalSchema = z.object({
  id: Id,
  content: z.string(),
  proposedBy: z.string(),
  mine: z.boolean(),
  createdAt: IsoDate,
});
export type MemoryProposal = z.infer<typeof MemoryProposalSchema>;
export const ProposeMemoryInput = z.object({
  organizationId: Id,
  content: z.string().trim().min(1).max(4000),
});
export const DecideMemoryProposalInput = z.object({ proposalId: Id, approve: z.boolean() });

export const TeamEventSchema = z.object({
  id: Id,
  type: z.string(),
  actorName: z.string(),
  subject: z.string().nullable(),
  createdAt: IsoDate,
});
export type TeamEvent = z.infer<typeof TeamEventSchema>;

export const CreateTeamInput = z.object({ name: teamName });
export const CreateTeamOutput = z.object({ id: Id, defaultSpaceId: Id });
export const TeamIdInput = z.object({ organizationId: Id });
export const SetTeamRoleInput = z.object({
  organizationId: Id,
  userId: Id,
  role: z.enum(["admin", "member"]),
});
export const TeamMemberInput = z.object({ organizationId: Id, userId: Id });
export const InviteToTeamInput = z.object({
  organizationId: Id,
  email: emailAddress,
  role: z.enum(["admin", "member"]).default("member"),
});
export const InvitationIdInput = z.object({ invitationId: Id });
export const AcceptInvitationOutput = z.object({ organizationId: Id, spaceId: Id });
