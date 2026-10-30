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
  let guestBotId: string;

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
    const threadId = await threadIdOf(groupId);
    const tasks = await harness.db.task.findMany({
      where: { threadId },
      select: { id: true, prompt: true },
    });
    const runs = await harness.db.run.findMany({
      where: { threadId },
      select: { taskId: true, userId: true, triggeredByUserId: true },
    });
    const promptOf = (taskId: string) => tasks.find((task) => task.id === taskId)?.prompt ?? "";
    const forBen = runs.filter((run) => promptOf(run.taskId).includes("question"));
    expect(forBen.length).toBeGreaterThan(0);
    for (const run of forBen) {
      expect(run.userId).toBe(ana.userId);
      expect(run.triggeredByUserId).toBe(ben.userId);
      expect(promptOf(run.taskId)).toContain("ben wrote in this shared chat");
    }
    const forAna = runs.filter((run) => promptOf(run.taskId).includes("kickoff"));
    expect(forAna.length).toBeGreaterThan(0);
    for (const run of forAna) expect(run.triggeredByUserId).toBeNull();
  });

  it("keeps each person's own reading position", async () => {
    const position = async (userId: string) =>
      (
        await harness.db.chatGroupParticipant.findFirstOrThrow({
          where: { groupId, userId },
          select: { lastReadSeq: true },
        })
      ).lastReadSeq;
    await harness.ok(ana, "threads/send", { groupId, text: "Ana again" });
    const page = await harness.ok<{ messages: Array<{ seq: number; blocks: unknown }> }>(
      ana,
      "threads/messages",
      { groupId },
    );
    const again = page.messages.find((message) =>
      JSON.stringify(message.blocks).includes("Ana again"),
    );
    expect(again).toBeDefined();
    const seq = again?.seq as number;
    const guest = await harness.ok<GroupView[]>(ben, "groups/list");
    expect(guest.find((group) => group.id === groupId)?.unread).toBe(true);
    const hostBefore = await position(ana.userId);
    expect(await position(ben.userId)).toBeLessThan(seq);

    await harness.ok(ben, "threads/markRead", { groupId });
    expect(await position(ben.userId)).toBeGreaterThanOrEqual(seq);
    expect(await position(ana.userId)).toBe(hostBefore);
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
    await harness.hidden(ben, "artifacts/list", { botId: botIds[0] }, "Ada");
    await harness.hidden(ben, "memory/list", { botId: botIds[0] }, "Ada");
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

  it("lets a guest bring their own bot, which answers for them and asks them", async () => {
    const bot = await harness.ok<{ id: string }>(ben, "bots/create", {
      name: "Bea",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: false,
    });
    guestBotId = bot.id;
    const joined = await harness.ok<
      GroupView & { members: Array<{ botId: string; ownerUserId?: string }> }
    >(ben, "groups/setMyBots", { groupId, botIds: [guestBotId] });
    const owners = new Map(joined.members.map((member) => [member.botId, member.ownerUserId]));
    expect(owners.get(guestBotId)).toBe(ben.userId);
    expect(owners.get(botIds[0] as string)).toBe(ana.userId);

    // The host asks the guest's bot: it runs as Ben, at Ana's request.
    await harness.ok(ana, "threads/send", {
      groupId,
      text: "Bea, please review the plan",
      mentions: [guestBotId],
    });
    const threadId = await threadIdOf(groupId);
    const run = await harness.db.run.findFirstOrThrow({
      where: { threadId, botId: guestBotId },
      select: { id: true, userId: true, triggeredByUserId: true },
    });
    expect(run).toMatchObject({ userId: ben.userId, triggeredByUserId: ana.userId });

    // Only the bot's owner answers what it asks.
    const answer = (person: Person) =>
      harness.call(person, "threads/answer", {
        groupId,
        runId: run.id,
        messageId: "message",
        answer: "yes",
      });
    expect((await answer(ana)).status).not.toBe(409);
    expect((await answer(ben)).status).toBe(409);
  });

  it("keeps a guest's bots when the host edits the group", async () => {
    const group = await harness.ok<{ members: Array<{ botId: string }> }>(ana, "groups/update", {
      groupId,
      botIds: botIds,
    });
    expect(group.members.map((member) => member.botId)).toContain(guestBotId);
    const withGuest = await harness.ok<{ members: Array<{ botId: string }> }>(
      ana,
      "groups/update",
      {
        groupId,
        botIds: [...botIds, guestBotId],
      },
    );
    expect(withGuest.members.length).toBe(3);
  });

  it("lets people in the chat open each other's files, and nobody else", async () => {
    const make = (person: Person, name: string) =>
      harness.ok<{ id: string }>(person, "artifacts/create", {
        groupId,
        name,
        mimeType: "text/plain",
        contentBase64: Buffer.from(name).toString("base64"),
      });
    const fromGuest = await make(ben, "guest-notes.txt");
    const fromHost = await make(ana, "host-notes.txt");
    await harness.ok(ana, "artifacts/get", { groupId, artifactId: fromGuest.id });
    await harness.ok(ben, "artifacts/get", { groupId, artifactId: fromHost.id });
    for (const outsider of [cy, dee]) {
      await harness.denied(outsider, "artifacts/get", { groupId, artifactId: fromGuest.id });
      await harness.denied(outsider, "artifacts/create", {
        groupId,
        name: "x.txt",
        mimeType: "text/plain",
        contentBase64: "eA==",
      });
    }
    await harness.denied(ben, "artifacts/get", {
      groupId: privateGroupId,
      artifactId: fromHost.id,
    });
  });

  it("lets a guest leave and then loses access", async () => {
    await harness.ok(ben, "groups/leave", { groupId });
    const afterLeave = await harness.ok<{ members: Array<{ botId: string }> }>(ana, "groups/get", {
      groupId,
    });
    expect(afterLeave.members.map((member) => member.botId)).not.toContain(guestBotId);
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
