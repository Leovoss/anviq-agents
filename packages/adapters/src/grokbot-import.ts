import type { BotBundle, BotBundleBot, BotImportSkipped } from "@anviq/contracts";
import { BotBundleBotSchema, BotBundleSchema } from "@anviq/contracts";
import { z } from "zod";

const ManifestRoutineSchema = z.object({
  name: z.string().default(""),
  prompt: z.string().default(""),
  crons: z.array(z.string()).default([]),
  timezone: z.string().default("UTC"),
});

const ManifestBotSchema = z.object({
  name: z.string().default(""),
  title: z.string().default(""),
  description: z.string().default(""),
  instructions: z.string().default(""),
  routines: z.array(ManifestRoutineSchema).default([]),
  memory_files: z.array(z.string()).default([]),
});

const ManifestSchema = z.object({
  version: z.literal(1),
  bots: z.array(ManifestBotSchema),
});

const SHARED_SEGMENT = "shared";
const SKILL_DIR = "skills/";

function safeRelativePath(path: string): string | null {
  const parts = path.split("/");
  if (path.startsWith("/") || parts.some((part) => part === "" || part === "..")) return null;
  return path;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function botMemory(
  bot: z.infer<typeof ManifestBotSchema>,
  files: Record<string, string>,
  skipped: BotImportSkipped[],
): Pick<BotBundleBot, "memory" | "sharedMemory"> {
  const memory: BotBundleBot["memory"] = [];
  const sharedMemory: BotBundleBot["sharedMemory"] = [];
  const prefix = `memory/${bot.name}/`;
  for (const file of bot.memory_files) {
    const content = files[file];
    const relative = file.startsWith(prefix) ? file.slice(prefix.length) : null;
    if (content === undefined || relative === null || !safeRelativePath(file)) {
      skipped.push({ item: file, reason: "Memory file is missing or has an unexpected path." });
      continue;
    }
    if (relative.startsWith(`${SHARED_SEGMENT}/`)) {
      sharedMemory.push({ path: `grokbot/${bot.name}/${relative}`, content });
    } else {
      memory.push({ path: relative, content });
    }
  }
  return { memory, sharedMemory };
}

/**
 * Translates a Grok Bot fleet export (manifest.json plus memory/ and skills/ Markdown)
 * into the provider-neutral bundle. Connectors, logins and managed skills are not part of the
 * result; event-triggered routines are reported as skipped.
 */
export function parseGrokBotExport(files: Record<string, string>): BotBundle {
  const rawManifest = files["manifest.json"];
  if (rawManifest === undefined) throw new Error("manifest.json is missing from the export.");
  let json: unknown;
  try {
    json = JSON.parse(rawManifest);
  } catch {
    throw new Error("manifest.json is not valid JSON.");
  }
  const manifest = ManifestSchema.safeParse(json);
  if (!manifest.success) throw new Error("manifest.json is not a supported Grok Bot export.");

  const skipped: BotImportSkipped[] = [];
  const bots: BotBundleBot[] = [];
  const usedKeys = new Set<string>();

  for (const bot of manifest.data.bots) {
    const name = bot.name.trim();
    if (!name) {
      skipped.push({ item: "(unnamed bot)", reason: "A bot has no name." });
      continue;
    }
    const baseKey = `grokbot:${slug(name) || "bot"}`;
    let key = baseKey;
    for (let n = 2; usedKeys.has(key); n++) key = `${baseKey}-${n}`;
    usedKeys.add(key);

    // The export repeats the instructions as the description.
    const instructions = bot.instructions || bot.description;
    const description = bot.description === instructions ? "" : bot.description;

    const routines: BotBundleBot["routines"] = [];
    for (const routine of bot.routines) {
      if (routine.crons.length === 0 || !routine.prompt.trim()) {
        skipped.push({
          item: `${name}: ${routine.name || "routine"}`,
          reason: "Only scheduled routines are imported.",
        });
        continue;
      }
      routines.push({
        name: routine.name.trim().slice(0, 80) || "Routine",
        prompt: routine.prompt,
        crons: routine.crons,
        timezone: routine.timezone,
      });
    }

    const { memory, sharedMemory } = botMemory({ ...bot, name }, files, skipped);
    const candidate = BotBundleBotSchema.safeParse({
      key,
      name,
      title: bot.title,
      description,
      instructions,
      routines,
      memory,
      sharedMemory,
    });
    if (!candidate.success) {
      skipped.push({ item: name, reason: "Bot is too long or has invalid fields." });
      continue;
    }
    bots.push(candidate.data);
  }

  const skills = Object.keys(files)
    .filter((path) => path.startsWith(SKILL_DIR) && path.endsWith(".md"))
    .sort()
    .map((path) => files[path] as string);

  return BotBundleSchema.parse({ bots, skills, skipped });
}
