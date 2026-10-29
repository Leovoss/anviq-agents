// Copyright 2026 Anviq LLC. All rights reserved.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { createApp } from "@anviq/api/app";
import { acceptInvitation, createOrganization, inviteToOrganization } from "@anviq/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index.js";
import { asSystem } from "./system-db.js";

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeWithDatabase = hasDb ? describe : describe.skip;

type AppHandles = Awaited<ReturnType<typeof createApp>>;
type Person = { cookie: string; userId: string; email: string };

/**
 * Inside a team's space, one person's chats with their own bots stay theirs. Neither a fellow
 * member nor the team's owner (the most privileged person in the space) can list, read, search,
 * write to or export them, and there is no setting that changes this.
 */
describeWithDatabase("team space isolation", () => {
  let handles: AppHandles;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), "anviq-team-isolation-"));
  const needle = `needle-${stamp}`;
  let teamSpaceId: string;
  let ana: Person;
  let ben: Person;
  let cy: Person;
  let anaBotId: string;
  let anaGroupId: string;
  let anaArtifactId: string;

  const call = (person: Person, procedure: string, body: unknown = {}) =>
    handles.app.request(`/rpc/${procedure}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: person.cookie,
        "x-anviq-space-id": teamSpaceId,
        origin: "http://127.0.0.1:5173",
      },
      body: JSON.stringify({ json: body }),
    });
  const ok = async <T>(person: Person, procedure: string, body: unknown = {}) => {
    const response = await call(person, procedure, body);
    const text = await response.text();
    if (response.status >= 400) throw new Error(`${procedure} ${response.status}: ${text}`);
    return (JSON.parse(text) as { json: T }).json;
  };
  const denied = async (person: Person, procedure: string, body: unknown) => {
    const response = await call(person, procedure, body);
    const text = await response.text();
    expect(response.status, `${procedure} should be refused: ${text}`).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain(needle);
  };

  async function signUp(label: string): Promise<Person> {
    const email = `${label}-${stamp}@anviq.test`;
    const response = await handles.app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ email, password: "password12", name: label }),
    });
    if (response.status >= 400) throw new Error(`sign-up ${response.status}`);
    const cookie = sessionCookieHeader(response);
    const me = await handles.app.request("/rpc/me", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ json: {} }),
    });
    const { json } = (await me.json()) as { json: { userId: string } };
    await asSystem(handles.prisma).user.update({
      where: { id: json.userId },
      data: { emailVerified: true },
    });
    return { cookie, userId: json.userId, email };
  }

  beforeAll(async () => {
    const { createApp } = await import("@anviq/api/app");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      encryptionKey: "offline-team-isolation-encryption-key",
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      signupsEnabled: "true",
    });
    ana = await signUp("ana");
    ben = await signUp("ben");
    cy = await signUp("cy");

    const db = asSystem(handles.prisma);
    const team = await createOrganization(db, { userId: cy.userId, name: `Team ${stamp}` });
    teamSpaceId = team.defaultSpaceId;
    for (const person of [ana, ben]) {
      const invited = await inviteToOrganization(db, {
        userId: cy.userId,
        organizationId: team.id,
        email: person.email,
        role: "member",
      });
      await acceptInvitation(db, { userId: person.userId, invitationId: invited.invitation.id });
    }

    const bot = await ok<{ id: string }>(ana, "bots/create", {
      name: "Ana Bot",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: false,
    });
    anaBotId = bot.id;
    await ok(ana, "threads/send", { botId: anaBotId, text: `Remember ${needle}` });
    const group = await ok<{ id: string }>(ana, "groups/create", {
      name: "Ana only",
      botIds: [anaBotId],
    });
    anaGroupId = group.id;
    await ok(ana, "scratchpad/create", { botId: anaBotId, title: needle, notes: needle });
    const artifact = await ok<{ id: string }>(ana, "artifacts/create", {
      botId: anaBotId,
      name: `${needle}.txt`,
      mimeType: "text/plain",
      contentBase64: Buffer.from(needle).toString("base64"),
    });
    anaArtifactId = artifact.id;
  }, 120_000);

  afterAll(async () => {
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("lets the owner of the chats see them, as a baseline", async () => {
    const bots = await ok<Array<{ id: string }>>(ana, "bots/list");
    expect(bots.map((bot) => bot.id)).toContain(anaBotId);
    const messages = await ok(ana, "threads/messages", { botId: anaBotId });
    expect(JSON.stringify(messages)).toContain(needle);
  });

  for (const [label, person] of [
    ["a fellow member", () => ben],
    ["the team's owner", () => cy],
  ] as const) {
    it(`keeps one person's bot chats from ${label}`, async () => {
      const intruder = person();
      const bots = await ok<Array<{ id: string }>>(intruder, "bots/list");
      expect(bots.map((bot) => bot.id)).not.toContain(anaBotId);
      const groups = await ok<Array<{ id: string }>>(intruder, "groups/list");
      expect(groups.map((group) => group.id)).not.toContain(anaGroupId);
      const nav = await ok(intruder, "spaces/list");
      expect(JSON.stringify(nav)).not.toContain(anaBotId);
      expect(JSON.stringify(nav)).not.toContain(anaGroupId);

      for (const target of [{ botId: anaBotId }, { groupId: anaGroupId }]) {
        await denied(intruder, "threads/head", target);
        await denied(intruder, "threads/get", target);
        await denied(intruder, "threads/messages", target);
        await denied(intruder, "threads/subscribe", { ...target, cursor: -1 });
        await denied(intruder, "threads/send", { ...target, text: "reading over your shoulder" });
        await denied(intruder, "threads/stop", target);
      }
      await denied(intruder, "bots/get", { botId: anaBotId });
      await denied(intruder, "bots/update", { botId: anaBotId, name: "Taken" });
      await denied(intruder, "bots/archive", { botId: anaBotId });
      await denied(intruder, "bots/remove", { botId: anaBotId });
      await denied(intruder, "groups/get", { groupId: anaGroupId });
      await denied(intruder, "export/bot", { botId: anaBotId });
    });

    it(`keeps one person's search, files, notes and memory from ${label}`, async () => {
      const intruder = person();
      const found = await ok(intruder, "search/query", { q: needle });
      expect(JSON.stringify(found)).not.toContain(needle);
      const files = await ok(intruder, "artifacts/listSpace", {});
      expect(JSON.stringify(files)).not.toContain(needle);
      await denied(intruder, "artifacts/list", { botId: anaBotId });
      await denied(intruder, "artifacts/getById", { artifactId: anaArtifactId });
      await denied(intruder, "artifacts/get", { botId: anaBotId, artifactId: anaArtifactId });
      await denied(intruder, "artifacts/remove", { artifactId: anaArtifactId });
      await denied(intruder, "scratchpad/list", { botId: anaBotId });
      await denied(intruder, "routines/list", { botId: anaBotId });
      await denied(intruder, "memory/list", { botId: anaBotId });
      const exported = await ok(intruder, "memory/exportMarkdown", {});
      expect(JSON.stringify(exported)).not.toContain(needle);
    });
  }
});
