import type { MemoryStore } from "@anviq/adapter-kit";
import type { Actor, Bot } from "@anviq/contracts";
import type { PrismaClient } from "@anviq/db";
import { describe, expect, it, vi } from "vitest";
import { createAgentSkillsService } from "./agent-skills.js";
import { createBotImportService } from "./bot-import.js";

const actor: Actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@anviq.test",
  isDeploymentOwner: true,
};

const SKILL = "---\nname: demo-skill\ndescription: Demo\n---\nSteps";

const files = {
  "manifest.json": JSON.stringify({
    version: 1,
    bots: [
      {
        name: "Helper",
        instructions: "Be helpful.",
        description: "Be helpful.",
        routines: [
          { name: "Weekly", prompt: "Go", crons: ["0 9 * * 1"], timezone: "UTC", active: true },
          { name: "Broken", prompt: "Go", crons: ["not a cron"], timezone: "UTC", active: true },
        ],
        memory_files: ["memory/Helper/profile.md", "memory/Helper/shared/team.md"],
      },
    ],
  }),
  "memory/Helper/profile.md": "- likes tea",
  "memory/Helper/shared/team.md": "team note",
  "skills/demo-skill.md": SKILL,
};

function setup() {
  const bots: { spawnKey: string }[] = [];
  const routines: { botId: string; active: boolean; name: string }[] = [];
  const skills: { name: string }[] = [];
  const prisma = {
    bot: {
      findMany: vi.fn(async () => bots),
    },
    routine: {
      create: vi.fn(
        async ({ data }: { data: { botId: string; active: boolean; name: string } }) => {
          routines.push(data);
          return data;
        },
      ),
    },
    agentSkill: {
      findFirst: vi.fn(
        async ({ where }: { where: { name: { equals: string } } }) =>
          skills.find((s) => s.name.toLowerCase() === where.name.equals.toLowerCase()) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: { name: string } }) => {
        skills.push(data);
        return { ...data, id: "s", source: "user", createdAt: new Date(0), updatedAt: new Date(0) };
      }),
    },
  } as unknown as PrismaClient;
  const commit = vi.fn(async () => ({ id: "m", path: "p", revision: 1, content: "" }));
  const createBot = vi.fn(async (_actor: Actor, input: { spawnKey: string }) => {
    bots.push({ spawnKey: input.spawnKey });
    return { id: "bot-1" } as Bot;
  });
  const service = createBotImportService({
    prisma,
    memory: { commit } as unknown as MemoryStore,
    agentSkills: createAgentSkillsService(prisma),
    createBot,
  });
  return { service, createBot, commit, routines, skills, prisma };
}

describe("bot import", () => {
  it("reports a dry run without writing anything", async () => {
    const { service, createBot, commit, routines } = setup();
    const result = await service.run(actor, { source: "grokbot", files, dryRun: true });
    expect(result).toMatchObject({ applied: false, bots: 1, routines: 1, skills: 1, memory: 2 });
    expect(result.skipped).toEqual([{ item: "Helper: Broken", reason: "Schedule is not valid." }]);
    expect(createBot).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(routines).toEqual([]);
  });

  it("creates bots, paused routines, memory and skills", async () => {
    const { service, createBot, commit, routines, skills } = setup();
    const result = await service.run(actor, { source: "grokbot", files, dryRun: false });
    expect(result).toMatchObject({ applied: true, bots: 1, routines: 1, skills: 1, memory: 2 });
    expect(createBot).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ name: "Helper", spawnKey: "grokbot:helper", description: "" }),
    );
    expect(routines).toEqual([expect.objectContaining({ botId: "bot-1", active: false })]);
    expect(commit).toHaveBeenCalledWith(
      { scope: "bot", botId: "bot-1", path: "profile.md", content: "- likes tea" },
      expect.anything(),
    );
    expect(commit).toHaveBeenCalledWith(
      {
        scope: "user",
        botId: undefined,
        path: "grokbot/Helper/shared/team.md",
        content: "team note",
      },
      expect.anything(),
    );
    expect(skills.map((s) => s.name)).toEqual(["demo-skill"]);
  });

  it("adds nothing when the same export is imported again", async () => {
    const { service, createBot, commit } = setup();
    await service.run(actor, { source: "grokbot", files, dryRun: false });
    commit.mockClear();
    const again = await service.run(actor, { source: "grokbot", files, dryRun: false });
    expect(again).toMatchObject({ bots: 0, routines: 0, skills: 0, memory: 0 });
    expect(again.skipped).toEqual(
      expect.arrayContaining([
        { item: "Helper", reason: "Already imported." },
        { item: "demo-skill", reason: "A skill with that name already exists." },
      ]),
    );
    expect(createBot).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects an export it cannot read", async () => {
    const { service } = setup();
    await expect(
      service.run(actor, { source: "grokbot", files: {}, dryRun: true }),
    ).rejects.toThrow("manifest.json is missing");
  });
});
