// Copyright 2026 Anviq LLC. All rights reserved.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Person } from "./team-harness.js";
import { createTeamHarness } from "./team-harness.js";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeWithDatabase = hasDb ? describe : describe.skip;

/**
 * Inside a team's space, one person's chats with their own bots stay theirs. Neither a fellow
 * member nor the team's owner (the most privileged person in the space) can list, read, search,
 * write to or export them, and there is no setting that changes this.
 */
describeWithDatabase("team space isolation", () => {
  let harness: Awaited<ReturnType<typeof createTeamHarness>>["harness"];
  let ana: Person;
  let ben: Person;
  let cy: Person;
  let needle: string;
  let anaBotId: string;
  let anaGroupId: string;
  let anaArtifactId: string;

  beforeAll(async () => {
    const created = await createTeamHarness("team-isolation", ["cy", "ana", "ben"]);
    harness = created.harness;
    [cy, ana, ben] = created.people as [Person, Person, Person];
    needle = `needle-${harness.stamp}`;

    const bot = await harness.ok<{ id: string }>(ana, "bots/create", {
      name: "Ana Bot",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: false,
    });
    anaBotId = bot.id;
    const second = await harness.ok<{ id: string }>(ana, "bots/create", {
      name: "Ana Helper",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: false,
    });
    await harness.ok(ana, "threads/send", { botId: anaBotId, text: `Remember ${needle}` });
    const group = await harness.ok<{ id: string }>(ana, "groups/create", {
      name: "Ana only",
      botIds: [anaBotId, second.id],
    });
    anaGroupId = group.id;
    await harness.ok(ana, "scratchpad/create", { botId: anaBotId, title: needle, notes: needle });
    const artifact = await harness.ok<{ id: string }>(ana, "artifacts/create", {
      botId: anaBotId,
      name: `${needle}.txt`,
      mimeType: "text/plain",
      contentBase64: Buffer.from(needle).toString("base64"),
    });
    anaArtifactId = artifact.id;
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("lets the owner of the chats see them, as a baseline", async () => {
    const bots = await harness.ok<Array<{ id: string }>>(ana, "bots/list");
    expect(bots.map((bot) => bot.id)).toContain(anaBotId);
    const messages = await harness.ok(ana, "threads/messages", { botId: anaBotId });
    expect(JSON.stringify(messages)).toContain(needle);
  });

  for (const [label, person] of [
    ["a fellow member", () => ben],
    ["the team's owner", () => cy],
  ] as const) {
    it(`keeps one person's bot chats from ${label}`, async () => {
      const intruder = person();
      const bots = await harness.ok<Array<{ id: string }>>(intruder, "bots/list");
      expect(bots.map((bot) => bot.id)).not.toContain(anaBotId);
      const groups = await harness.ok<Array<{ id: string }>>(intruder, "groups/list");
      expect(groups.map((group) => group.id)).not.toContain(anaGroupId);
      const nav = await harness.ok(intruder, "spaces/list");
      expect(JSON.stringify(nav)).not.toContain(anaBotId);
      expect(JSON.stringify(nav)).not.toContain(anaGroupId);

      for (const target of [{ botId: anaBotId }, { groupId: anaGroupId }]) {
        await harness.denied(intruder, "threads/head", target, needle);
        await harness.denied(intruder, "threads/get", target, needle);
        await harness.denied(intruder, "threads/messages", target, needle);
        await harness.denied(intruder, "threads/subscribe", { ...target, cursor: -1 }, needle);
        await harness.denied(
          intruder,
          "threads/send",
          { ...target, text: "reading over your shoulder" },
          needle,
        );
        await harness.denied(intruder, "threads/stop", target, needle);
      }
      await harness.denied(intruder, "bots/get", { botId: anaBotId }, needle);
      await harness.denied(intruder, "bots/update", { botId: anaBotId, name: "Taken" }, needle);
      await harness.denied(intruder, "bots/archive", { botId: anaBotId }, needle);
      await harness.denied(intruder, "bots/remove", { botId: anaBotId }, needle);
      await harness.denied(intruder, "groups/get", { groupId: anaGroupId }, needle);
      await harness.denied(intruder, "export/bot", { botId: anaBotId }, needle);
    });

    it(`keeps one person's search, files, notes and memory from ${label}`, async () => {
      const intruder = person();
      const found = await harness.ok(intruder, "search/query", { q: needle });
      expect(JSON.stringify(found)).not.toContain(needle);
      const files = await harness.ok(intruder, "artifacts/listSpace", {});
      expect(JSON.stringify(files)).not.toContain(needle);
      await harness.hidden(intruder, "artifacts/list", { botId: anaBotId }, needle);
      await harness.denied(intruder, "artifacts/getById", { artifactId: anaArtifactId }, needle);
      await harness.denied(
        intruder,
        "artifacts/get",
        { botId: anaBotId, artifactId: anaArtifactId },
        needle,
      );
      await harness.denied(intruder, "artifacts/remove", { artifactId: anaArtifactId }, needle);
      await harness.hidden(intruder, "scratchpad/list", { botId: anaBotId }, needle);
      await harness.hidden(intruder, "routines/list", { botId: anaBotId }, needle);
      await harness.hidden(intruder, "memory/list", { botId: anaBotId }, needle);
      const exported = await harness.ok(intruder, "memory/exportMarkdown", {});
      expect(JSON.stringify(exported)).not.toContain(needle);
    });
  }
});
