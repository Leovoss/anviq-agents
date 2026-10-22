import type { MemoryStore } from "@anviq/adapter-kit";
import { parseGrokBotExport } from "@anviq/adapters";
import type {
  Actor,
  Bot,
  BotBundle,
  BotBundleBot,
  BotImportInput,
  BotImportResult,
  BotImportSkipped,
} from "@anviq/contracts";
import { nextCronDateAcrossStrict } from "@anviq/core";
import type { PrismaClient } from "@anviq/db";
import { ORPCError } from "@orpc/server";
import type { AgentSkillsService } from "./agent-skills.js";
import { resolveSkillContent } from "./agent-skills.js";

interface BotImportDeps {
  prisma: PrismaClient;
  memory: MemoryStore;
  agentSkills: AgentSkillsService;
  createBot: (
    actor: Actor,
    input: {
      name: string;
      title: string;
      description: string;
      instructions: string;
      notifyOnFinish: boolean;
      spawnKey: string;
    },
  ) => Promise<Bot>;
}

function translate(source: BotImportInput["source"], files: Record<string, string>): BotBundle {
  switch (source) {
    case "grokbot":
      try {
        return parseGrokBotExport(files);
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          message: error instanceof Error ? error.message : "Unsupported export.",
        });
      }
  }
}

function validSchedule(crons: string[], timezone: string): boolean {
  try {
    return nextCronDateAcrossStrict(crons, new Date(), timezone) !== null;
  } catch {
    return false;
  }
}

/** Creates the bots, routines, skills and memory of an exported bundle. Re-importing adds nothing. */
export function createBotImportService(deps: BotImportDeps) {
  const { prisma } = deps;

  return {
    async run(actor: Actor, input: BotImportInput): Promise<BotImportResult> {
      const bundle = translate(input.source, input.files);
      const skipped: BotImportSkipped[] = [...bundle.skipped];
      const counts = { bots: 0, routines: 0, skills: 0, memory: 0 };
      const memoryContext = {
        operationId: "bot-import",
        traceId: "bot-import",
        spaceId: actor.spaceId,
        userId: actor.userId,
        signal: new AbortController().signal,
      };
      const writeMemory = async (
        scope: "bot" | "user",
        botId: string | undefined,
        notes: BotBundleBot["memory"],
      ) => {
        for (const note of notes) {
          await deps.memory.commit(
            { scope, botId, path: note.path, content: note.content },
            memoryContext,
          );
          counts.memory += 1;
        }
      };

      const existingKeys = new Set(
        (
          await prisma.bot.findMany({
            where: {
              spaceId: actor.spaceId,
              userId: actor.userId,
              spawnKey: { in: bundle.bots.map((bot) => bot.key) },
            },
            select: { spawnKey: true },
          })
        ).map((bot) => bot.spawnKey),
      );

      for (const bot of bundle.bots) {
        if (existingKeys.has(bot.key)) {
          skipped.push({ item: bot.name, reason: "Already imported." });
          continue;
        }
        const routines = bot.routines.filter((routine) => {
          if (validSchedule(routine.crons, routine.timezone)) return true;
          skipped.push({ item: `${bot.name}: ${routine.name}`, reason: "Schedule is not valid." });
          return false;
        });
        if (input.dryRun) {
          counts.bots += 1;
          counts.routines += routines.length;
          counts.memory += bot.memory.length + bot.sharedMemory.length;
          continue;
        }
        try {
          const created = await deps.createBot(actor, {
            name: bot.name,
            title: bot.title,
            description: bot.description,
            instructions: bot.instructions,
            notifyOnFinish: true,
            spawnKey: bot.key,
          });
          counts.bots += 1;
          // Routines arrive paused so nothing runs until the user turns it on.
          for (const routine of routines) {
            await prisma.routine.create({
              data: {
                spaceId: actor.spaceId,
                userId: actor.userId,
                botId: created.id,
                name: routine.name,
                prompt: routine.prompt,
                crons: routine.crons,
                timezone: routine.timezone,
                active: false,
              },
            });
            counts.routines += 1;
          }
          await writeMemory("bot", created.id, bot.memory);
          await writeMemory("user", undefined, bot.sharedMemory);
        } catch {
          skipped.push({ item: bot.name, reason: "Could not be imported." });
        }
      }

      for (const content of bundle.skills) {
        let name: string;
        try {
          name = resolveSkillContent({ content }).name;
        } catch {
          skipped.push({ item: "Skill", reason: "Not a valid SKILL.md." });
          continue;
        }
        const taken = await prisma.agentSkill.findFirst({
          where: {
            spaceId: actor.spaceId,
            userId: actor.userId,
            name: { equals: name, mode: "insensitive" },
          },
          select: { id: true },
        });
        if (taken) {
          skipped.push({ item: name, reason: "A skill with that name already exists." });
          continue;
        }
        if (!input.dryRun) {
          try {
            await deps.agentSkills.create(actor, { content });
          } catch {
            skipped.push({ item: name, reason: "Could not be imported." });
            continue;
          }
        }
        counts.skills += 1;
      }

      return { applied: !input.dryRun, ...counts, skipped };
    },
  };
}

export type BotImportService = ReturnType<typeof createBotImportService>;
