import { z } from "zod";
import {
  BOT_DESCRIPTION_MAX_LENGTH,
  BOT_INSTRUCTIONS_MAX_LENGTH,
  BOT_NAME_MAX_LENGTH,
  BOT_TITLE_MAX_LENGTH,
} from "./domain.js";

export const BOT_IMPORT_MAX_FILES = 2_000;
export const BOT_IMPORT_MAX_FILE_CHARS = 1_000_000;
export const BOT_IMPORT_MAX_TOTAL_CHARS = 8_000_000;

/** Services whose export can be translated into a bot bundle. */
export const BotImportSourceSchema = z.enum(["grokbot"]);
export type BotImportSource = z.infer<typeof BotImportSourceSchema>;

/** Text files of an export, keyed by their path inside the export. */
export const BotImportFilesSchema = z
  .record(z.string().min(1).max(500), z.string().max(BOT_IMPORT_MAX_FILE_CHARS))
  .superRefine((files, ctx) => {
    const paths = Object.keys(files);
    if (paths.length > BOT_IMPORT_MAX_FILES) {
      ctx.addIssue({ code: "custom", message: "Too many files" });
      return;
    }
    const total = paths.reduce((sum, path) => sum + (files[path]?.length ?? 0), 0);
    if (total > BOT_IMPORT_MAX_TOTAL_CHARS) {
      ctx.addIssue({ code: "custom", message: "Export is too large" });
    }
  });

/** What an import leaves out, and why. */
export const BotImportSkippedSchema = z.object({
  item: z.string(),
  reason: z.string(),
});
export type BotImportSkipped = z.infer<typeof BotImportSkippedSchema>;

export const BotBundleRoutineSchema = z.object({
  name: z.string().min(1).max(80),
  prompt: z.string().min(1),
  crons: z.array(z.string().min(1)).min(1),
  timezone: z.string().min(1),
});
export type BotBundleRoutine = z.infer<typeof BotBundleRoutineSchema>;

export const BotBundleMemorySchema = z.object({
  path: z.string().min(1).max(300),
  content: z.string(),
});
export type BotBundleMemory = z.infer<typeof BotBundleMemorySchema>;

export const BotBundleBotSchema = z.object({
  /** Stable id from the source so importing the same export twice adds nothing. */
  key: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(BOT_NAME_MAX_LENGTH),
  title: z.string().max(BOT_TITLE_MAX_LENGTH).default(""),
  description: z.string().max(BOT_DESCRIPTION_MAX_LENGTH).default(""),
  instructions: z.string().max(BOT_INSTRUCTIONS_MAX_LENGTH).default(""),
  routines: z.array(BotBundleRoutineSchema).default([]),
  memory: z.array(BotBundleMemorySchema).default([]),
  /** Notes the bot kept for the whole team rather than for itself. */
  sharedMemory: z.array(BotBundleMemorySchema).default([]),
});
export type BotBundleBot = z.infer<typeof BotBundleBotSchema>;

/** Provider-neutral shape every importer translates into. */
export const BotBundleSchema = z.object({
  bots: z.array(BotBundleBotSchema),
  /** SKILL.md documents. */
  skills: z.array(z.string().min(1)).default([]),
  skipped: z.array(BotImportSkippedSchema).default([]),
});
export type BotBundle = z.infer<typeof BotBundleSchema>;

export const BotImportInput = z.object({
  source: BotImportSourceSchema,
  files: BotImportFilesSchema,
  /** Report what would change without writing anything. */
  dryRun: z.boolean().default(false),
});
export type BotImportInput = z.infer<typeof BotImportInput>;

export const BotImportResultSchema = z.object({
  applied: z.boolean(),
  bots: z.number().int(),
  routines: z.number().int(),
  skills: z.number().int(),
  memory: z.number().int(),
  skipped: z.array(BotImportSkippedSchema),
});
export type BotImportResult = z.infer<typeof BotImportResultSchema>;
