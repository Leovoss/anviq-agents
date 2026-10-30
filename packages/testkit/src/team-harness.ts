// Copyright 2026 Anviq LLC. All rights reserved.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { createApp } from "@anviq/api/app";
import { acceptInvitation, createOrganization, inviteToOrganization } from "@anviq/db";
import { expect } from "vitest";
import { sessionCookieHeader } from "./index.js";
import { asSystem } from "./system-db.js";

type AppHandles = Awaited<ReturnType<typeof createApp>>;

export type Person = { cookie: string; userId: string; email: string };

/** A running app with one team whose space several people have joined, for isolation tests. */
export async function createTeamHarness(label: string, people: string[]) {
  process.env.WAKEUP_DRIVER = "memory";
  process.env.SANDBOX_PROVIDER = "fake";
  process.env.AGENT_RUNTIME = "scripted";
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), `anviq-${label}-`));
  const { createApp } = await import("@anviq/api/app");
  const handles: AppHandles = await createApp({
    databaseUrl: process.env.DATABASE_URL!,
    encryptionKey: `offline-${label}-encryption-key`,
    dataDir,
    sandboxProvider: "fake",
    agentRuntime: "scripted",
    wakeupDriver: "memory",
    signupsEnabled: "true",
  });
  const db = asSystem(handles.prisma);
  let teamSpaceId = "";

  async function signUp(name: string): Promise<Person> {
    const email = `${name}-${stamp}@anviq.test`;
    const response = await handles.app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ email, password: "password12", name }),
    });
    if (response.status >= 400) throw new Error(`sign-up ${response.status}`);
    const cookie = sessionCookieHeader(response);
    const me = await handles.app.request("/rpc/me", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ json: {} }),
    });
    const { json } = (await me.json()) as { json: { userId: string } };
    await db.user.update({ where: { id: json.userId }, data: { emailVerified: true } });
    return { cookie, userId: json.userId, email };
  }

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

  const harness = {
    stamp,
    handles,
    db,
    get teamSpaceId() {
      return teamSpaceId;
    },
    call,
    async ok<T>(person: Person, procedure: string, body: unknown = {}) {
      const response = await call(person, procedure, body);
      const text = await response.text();
      if (response.status >= 400) throw new Error(`${procedure} ${response.status}: ${text}`);
      return (JSON.parse(text) as { json: T }).json;
    },
    /** The call is refused and its answer carries none of `secret`. */
    async denied(person: Person, procedure: string, body: unknown, secret?: string) {
      const response = await call(person, procedure, body);
      const text = await response.text();
      // A stream refused after it opens answers 200 and then carries an error event.
      const refused = response.status >= 400 || text.includes("event: error");
      expect(refused, `${procedure} should be refused: ${text}`).toBe(true);
      if (secret) expect(text).not.toContain(secret);
    },
    /** A list call either refuses or answers with nothing, and either way shows none of `secret`. */
    async hidden(person: Person, procedure: string, body: unknown, secret: string) {
      const response = await call(person, procedure, body);
      const text = await response.text();
      expect(text, `${procedure} leaked`).not.toContain(secret);
      if (response.status < 400) {
        expect(JSON.parse(text), `${procedure} should list nothing`).toEqual({ json: [] });
      }
    },
    async stop() {
      await handles.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };

  /** Signs everyone up; the first person owns the team and the rest join it as members. */
  const joined: Person[] = [];
  for (const name of people) joined.push(await signUp(name));
  const [owner, ...members] = joined;
  if (!owner) throw new Error("a team needs an owner");
  const team = await createOrganization(db, { userId: owner.userId, name: `Team ${stamp}` });
  teamSpaceId = team.defaultSpaceId;
  for (const person of members) {
    const invited = await inviteToOrganization(db, {
      userId: owner.userId,
      organizationId: team.id,
      email: person.email,
      role: "member",
    });
    await acceptInvitation(db, { userId: person.userId, invitationId: invited.invitation.id });
  }
  return { harness, people: joined };
}
