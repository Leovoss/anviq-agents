// Copyright 2026 Anviq LLC. All rights reserved.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Person } from "./team-harness.js";
import { createTeamHarness } from "./team-harness.js";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeWithDatabase = hasDb ? describe : describe.skip;

type GroupView = {
  id: string;
  unread: boolean;
  canManage?: boolean;
  participants?: Array<{ userId: string; name: string; host: boolean }>;
};
type MessagePage = {
  messages: Array<{ role: string; blocks: unknown; sender?: { userId: string; name: string } }>;
};

/**
 * A group the host shares with some people in a team's space: those people read and write in it,
 * and nobody else in the space, owner included, can reach it. A guest runs the host's bots as the
 * host, but never as the host's own request.
 */
describeWithDatabase("shared chats", () => {
  let harness: Awaited<ReturnType<typeof createTeamHarness>>["harness"];
  let cy: Person;
  let ana: Person;
  let ben: Person;
  let dee: Person;
  let groupId: string;
  let privateGroupId: string;
  let botIds: string[];

  const spoken = (page: MessagePage, text: string) =>
    page.messages.find((message) => JSON.stringify(message.blocks).includes(text));

  beforeAll(async () => {
    const created = await createTeamHarness("shared-chats", ["cy", "ana", "ben", "dee"]);
    harness = created.harness;
    [cy, ana, ben, dee] = created.people as [Person, Person, Person, Person];
    botIds = [];
    for (const name of ["Ada", "Bo"]) {
      const bot = await harness.ok<{ id: string }>(ana, "bots/create", {
        name,
        title: "",
        description: "",
        instructions: "",
        notifyOnFinish: false,
      });
      botIds.push(bot.id);
    }
    groupId = (await harness.ok<{ id: string }>(ana, "groups/create", { name: "Launch", botIds }))
      .id;
    privateGroupId = (
      await harness.ok<{ id: string }>(ana, "groups/create", { name: "Mine", botIds })
    ).id;
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("keeps a group private until its host shares it", async () => {
    for (const person of [ben, cy, dee]) {
      const groups = await harness.ok<GroupView[]>(person, "groups/list");
      expect(groups.map((group) => group.id)).not.toContain(groupId);
      await harness.denied(person, "threads/messages", { groupId });
    }
    const mine = await harness.ok<GroupView[]>(ana, "groups/list");
    expect(mine.find((group) => group.id === groupId)?.participants).toBeUndefined();
  });

  it("lets only the host share, and only with people in the space", async () => {
    await harness.denied(ben, "groups/setParticipants", { groupId, userIds: [ben.userId] });
    await harness.denied(ana, "groups/setParticipants", { groupId, userIds: ["not-a-person"] });
    const shared = await harness.ok<GroupView>(ana, "groups/setParticipants", {
      groupId,
      userIds: [ben.userId],
    });
    expect(shared.canManage).toBe(true);
    expect(shared.participants?.map((person) => [person.name, person.host])).toEqual([
      ["ana", true],
      ["ben", false],
    ]);
  });

  it("shows the shared group to its guest, and to nobody else", async () => {
    const guest = await harness.ok<GroupView[]>(ben, "groups/list");
    const seen = guest.find((group) => group.id === groupId);
    expect(seen?.canManage).toBe(false);
    expect(seen?.participants?.length).toBe(2);
    expect(guest.map((group) => group.id)).not.toContain(privateGroupId);
    for (const outsider of [cy, dee]) {
      const groups = await harness.ok<GroupView[]>(outsider, "groups/list");
      expect(groups.map((group) => group.id)).not.toContain(groupId);
      await harness.denied(outsider, "threads/messages", { groupId });
      await harness.denied(outsider, "threads/send", { groupId, text: "let me in" });
      await harness.denied(outsider, "threads/subscribe", { groupId, cursor: -1 });
    }
    await harness.denied(ben, "threads/messages", { groupId: privateGroupId });
  });

  it("puts both people's messages in one transcript, each with its sender", async () => {
    await harness.ok(ana, "threads/send", { groupId, text: "Ana here: kickoff" });
    await harness.ok(ben, "threads/send", { groupId, text: "Ben here: question" });
    for (const person of [ana, ben]) {
      const page = await harness.ok<MessagePage>(person, "threads/messages", { groupId });
      expect(spoken(page, "kickoff")?.sender?.name).toBe("ana");
      expect(spoken(page, "question")?.sender?.name).toBe("ben");
    }
  });

  it("runs the host's bots for a guest without treating it as the host's own request", async () => {
    const runs = await harness.db.run.findMany({
      where: { threadId: await threadIdOf(groupId) },
      select: { userId: true, triggeredByUserId: true, task: { select: { prompt: true } } },
    });
    const forBen = runs.filter((run) => run.task.prompt.includes("question"));
    expect(forBen.length).toBeGreaterThan(0);
    for (const run of forBen) {
      expect(run.userId).toBe(ana.userId);
      expect(run.triggeredByUserId).toBe(ben.userId);
      expect(run.task.prompt).toContain("ben wrote in this shared chat");
    }
    const forAna = runs.filter((run) => run.task.prompt.includes("kickoff"));
    for (const run of forAna) expect(run.triggeredByUserId).toBeNull();
  });

  it("keeps each person's own reading position", async () => {
    const before = await harness.ok<GroupView[]>(ben, "groups/list");
    await harness.ok(ana, "threads/send", { groupId, text: "Ana again" });
    const unread = await harness.ok<GroupView[]>(ben, "groups/list");
    expect(unread.find((group) => group.id === groupId)?.unread).toBe(true);
    expect(before.find((group) => group.id === groupId)).toBeDefined();
    await harness.ok(ben, "threads/markRead", { groupId });
    const read = await harness.ok<GroupView[]>(ben, "groups/list");
    expect(read.find((group) => group.id === groupId)?.unread).toBe(false);
    const hostView = await harness.ok<GroupView[]>(ana, "groups/list");
    expect(hostView.find((group) => group.id === groupId)?.unread).toBe(false);
  });

  it("keeps a guest from changing the group or answering for the host", async () => {
    await harness.denied(ben, "groups/update", { groupId, name: "Renamed" });
    await harness.denied(ben, "groups/archive", { groupId });
    await harness.denied(ben, "groups/remove", { groupId });
    await harness.denied(ben, "groups/duplicate", { groupId });
    await harness.denied(ben, "threads/stop", { groupId });
    await harness.denied(ben, "threads/clear", { groupId });
    await harness.denied(ben, "threads/answer", {
      groupId,
      runId: "run",
      messageId: "message",
      answer: "yes",
    });
    await harness.denied(ben, "bots/get", { botId: botIds[0] });
    await harness.denied(ben, "artifacts/list", { botId: botIds[0] });
    await harness.denied(ben, "memory/list", { botId: botIds[0] });
  });

  it("refuses to share a chat that already has messages until it is cleared", async () => {
    await harness.ok(ana, "threads/send", { groupId: privateGroupId, text: "private plans" });
    await harness.denied(ana, "groups/setParticipants", {
      groupId: privateGroupId,
      userIds: [dee.userId],
    });
    await harness.ok(ana, "threads/clear", { groupId: privateGroupId });
    const shared = await harness.ok<GroupView>(ana, "groups/setParticipants", {
      groupId: privateGroupId,
      userIds: [dee.userId],
    });
    expect(shared.participants?.length).toBe(2);
    await harness.ok(ana, "groups/setParticipants", { groupId: privateGroupId, userIds: [] });
    await harness.denied(dee, "threads/messages", { groupId: privateGroupId });
  });

  it("lets a guest leave and then loses access", async () => {
    await harness.ok(ben, "groups/leave", { groupId });
    await harness.denied(ben, "threads/messages", { groupId });
    const groups = await harness.ok<GroupView[]>(ben, "groups/list");
    expect(groups.map((group) => group.id)).not.toContain(groupId);
    const hostView = await harness.ok<GroupView[]>(ana, "groups/list");
    expect(hostView.find((group) => group.id === groupId)?.participants).toBeUndefined();
  });

  async function threadIdOf(id: string) {
    const group = await harness.ok<{ threadId: string }>(ana, "groups/get", { groupId: id });
    return group.threadId;
  }
});
