// Copyright 2026 Anviq LLC. All rights reserved.
import type { Actor } from "@anviq/contracts";
import { OrganizationError } from "@anviq/db";
import { RPCHandler } from "@orpc/server/fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const db = vi.hoisted(() => ({
  inviteToOrganization: vi.fn(),
  listTeams: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock("@anviq/db", async (original) => ({
  ...(await original<typeof import("@anviq/db")>()),
  inviteToOrganization: db.inviteToOrganization,
  listTeams: db.listTeams,
  removeMember: db.removeMember,
  runAsSystem: (_reason: string, work: () => unknown) => work(),
}));

const actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "owner@anviq.test",
  isDeploymentOwner: false,
} satisfies Actor;

async function call(procedure: string, input: unknown, email?: { send: ReturnType<typeof vi.fn> }) {
  const deps = {
    prisma: {},
    email: email && { send: email.send, describe: () => ({ id: "test" }) },
    env: { webOrigin: "https://app.example.com" },
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  const { response } = await handler.handle(
    new Request(`http://127.0.0.1/rpc/organizations/${procedure}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: input }),
    }),
    { prefix: "/rpc", context: { actor } },
  );
  return { status: response?.status, body: (await response?.json()) as { json?: unknown } };
}

describe("organization routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the signed-in person's teams", async () => {
    db.listTeams.mockResolvedValue([{ id: "t1", name: "Acme", role: "owner", memberCount: 2 }]);
    const result = await call("list", {});
    expect(result.status).toBe(200);
    expect(db.listTeams).toHaveBeenCalledWith(expect.anything(), "user-1");
    expect(result.body.json).toEqual([{ id: "t1", name: "Acme", role: "owner", memberCount: 2 }]);
  });

  it("emails an invitation with a link to accept it", async () => {
    db.inviteToOrganization.mockResolvedValue({
      invitation: {
        id: "inv-1",
        email: "ben@anviq.test",
        role: "member",
        expiresAt: new Date("2026-11-05T00:00:00.000Z"),
      },
      organizationName: "Acme",
      inviterName: "Ana",
    });
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await call(
      "invite",
      { organizationId: "t1", email: "Ben@Anviq.test" },
      { send },
    );

    expect(result.status).toBe(200);
    expect(db.inviteToOrganization).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      organizationId: "t1",
      email: "Ben@Anviq.test",
      role: "member",
    });
    expect(send).toHaveBeenCalledOnce();
    const message = send.mock.calls[0]![0] as { to: string; html: string };
    expect(message.to).toBe("ben@anviq.test");
    expect(message.html).toContain("https://app.example.com/accept-invitation/inv-1");
    expect(result.body.json).toMatchObject({ id: "inv-1", expiresAt: "2026-11-05T00:00:00.000Z" });
  });

  it("keeps the invitation when the email cannot be sent", async () => {
    db.inviteToOrganization.mockResolvedValue({
      invitation: { id: "inv-2", email: "ben@anviq.test", role: "member", expiresAt: new Date() },
      organizationName: "Acme",
      inviterName: "Ana",
    });
    const send = vi.fn().mockRejectedValue(new Error("smtp down"));
    const result = await call(
      "invite",
      { organizationId: "t1", email: "ben@anviq.test" },
      { send },
    );
    expect(result.status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    ["NOT_FOUND", 404],
    ["FORBIDDEN", 403],
    ["INVALID", 400],
    ["CONFLICT", 409],
    ["LIMIT", 400],
  ] as const)("reports a %s rule as status %i", async (code, status) => {
    db.removeMember.mockRejectedValue(new OrganizationError(code, "Nope"));
    const result = await call("removeMember", { organizationId: "t1", userId: "user-2" });
    expect(result.status).toBe(status);
    expect(db.removeMember).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      organizationId: "t1",
      targetUserId: "user-2",
    });
  });

  it("rejects a malformed invitation before it reaches the database", async () => {
    const result = await call("invite", { organizationId: "t1", email: "not an email" });
    expect(result.status).toBe(400);
    expect(db.inviteToOrganization).not.toHaveBeenCalled();
  });
});
