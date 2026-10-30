// Copyright 2026 Anviq LLC. All rights reserved.
import { companyMemoryForSpace } from "@anviq/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Person } from "./team-harness.js";
import { createTeamHarness } from "./team-harness.js";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeWithDatabase = hasDb ? describe : describe.skip;

type Memory = { content: string; revision: number; canEdit: boolean };
type TeamEvent = { type: string; actorName: string; subject: string | null };

/**
 * Company memory is what every bot in a team knows. Owners and admins write it, members read it,
 * and it belongs to the team: no person's own memory listing or export ever returns it.
 */
describeWithDatabase("company memory and the team log", () => {
  let harness: Awaited<ReturnType<typeof createTeamHarness>>["harness"];
  let cy: Person;
  let ana: Person;
  let ben: Person;
  let organizationId: string;
  let teamSpaceId: string;
  const rule = () => `Company rule ${harness.stamp}: refunds above 500 need a manager.`;

  beforeAll(async () => {
    const created = await createTeamHarness("company-memory", ["cy", "ana", "ben"]);
    harness = created.harness;
    [cy, ana, ben] = created.people as [Person, Person, Person];
    teamSpaceId = harness.teamSpaceId;
    const teams = await harness.ok<Array<{ id: string; spaceId: string }>>(
      cy,
      "organizations/list",
    );
    organizationId = teams.find((team) => team.spaceId === teamSpaceId)?.id as string;
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("starts empty, and only an owner or admin can change it", async () => {
    const empty = await harness.ok<Memory>(ana, "organizations/memory", { organizationId });
    expect(empty).toMatchObject({ content: "", revision: 0, canEdit: false });
    await harness.denied(ana, "organizations/setMemory", { organizationId, content: "mine" });
    const saved = await harness.ok<{ revision: number }>(cy, "organizations/setMemory", {
      organizationId,
      content: rule(),
    });
    expect(saved.revision).toBe(1);
    const seen = await harness.ok<Memory>(ana, "organizations/memory", { organizationId });
    expect(seen).toMatchObject({ content: rule(), revision: 1, canEdit: false });
    expect((await harness.ok<Memory>(cy, "organizations/memory", { organizationId })).canEdit).toBe(
      true,
    );
  });

  it("refuses a stale edit and keeps the history", async () => {
    await harness.denied(cy, "organizations/setMemory", {
      organizationId,
      content: "overwrite",
      expectedRevision: 0,
    });
    const next = await harness.ok<{ revision: number }>(cy, "organizations/setMemory", {
      organizationId,
      content: `${rule()} Updated.`,
      expectedRevision: 1,
    });
    expect(next.revision).toBe(2);
    const revisions = await harness.db.memoryRevision.count({
      where: { document: { userId: `org:${organizationId}` } },
    });
    expect(revisions).toBe(2);
  });

  it("never shows up in a person's own memory", async () => {
    for (const person of [cy, ana, ben]) {
      const listed = await harness.ok(person, "memory/list", {});
      expect(JSON.stringify(listed)).not.toContain(rule());
      const exported = await harness.ok(person, "memory/exportMarkdown", {});
      expect(JSON.stringify(exported)).not.toContain(rule());
      const found = await harness.ok(person, "search/query", { q: "refunds" });
      expect(JSON.stringify(found)).not.toContain("Company rule");
    }
  });

  it("reaches the team's runs and no one else's", async () => {
    expect(await companyMemoryForSpace(harness.db, teamSpaceId)).toContain("Updated.");
    const personal = await harness.db.space.findFirst({
      where: { id: { not: teamSpaceId }, memberships: { some: { userId: ana.userId } } },
      select: { id: true },
    });
    expect(personal).not.toBeNull();
    expect(await companyMemoryForSpace(harness.db, personal?.id as string)).toBeUndefined();
  });

  it("keeps a log for admins that members cannot read", async () => {
    await harness.denied(ana, "organizations/events", { organizationId });
    const events = await harness.ok<TeamEvent[]>(cy, "organizations/events", { organizationId });
    const types = events.map((event) => event.type);
    expect(types).toContain("memory.updated");
    expect(events.find((event) => event.type === "memory.updated")?.actorName).toBe("cy");
  });
});
