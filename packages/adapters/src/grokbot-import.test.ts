import { describe, expect, it } from "vitest";
import { parseGrokBotExport } from "./grokbot-import.js";

const SKILL = "---\nname: demo-skill\ndescription: Demo\n---\nSteps";

function exportFiles(manifest: unknown, extra: Record<string, string> = {}) {
  return { "manifest.json": JSON.stringify(manifest), ...extra };
}

const bot = {
  name: "Helper",
  title: "",
  description: "Does things.",
  instructions: "Does things.",
  routines: [
    {
      name: "Weekly",
      prompt: "Run it",
      crons: ["0 9 * * 1"],
      timezone: "Europe/Berlin",
      active: true,
    },
    { name: "On CI failure", prompt: "Look", crons: [], timezone: "UTC", active: false },
  ],
  skills: [],
  memory_files: [
    "memory/Helper/profile.md",
    "memory/Helper/log/2026-09.md",
    "memory/Helper/shared/profile.md",
    "memory/Helper/missing.md",
  ],
};

describe("parseGrokBotExport", () => {
  const files = exportFiles(
    { version: 1, bots: [bot], tools_needing_reconnect: ["Gmail"], problems: ["x"] },
    {
      "memory/Helper/profile.md": "- (2026-09-01) likes tea",
      "memory/Helper/log/2026-09.md": "log",
      "memory/Helper/shared/profile.md": "team note",
      "skills/demo-skill.md": SKILL,
      "notes.txt": "ignored",
    },
  );

  it("maps bots, scheduled routines, memory and skills", () => {
    const bundle = parseGrokBotExport(files);
    expect(bundle.bots).toHaveLength(1);
    const [helper] = bundle.bots;
    expect(helper?.key).toBe("grokbot:helper");
    expect(helper?.instructions).toBe("Does things.");
    expect(helper?.description).toBe("");
    expect(helper?.routines).toEqual([
      { name: "Weekly", prompt: "Run it", crons: ["0 9 * * 1"], timezone: "Europe/Berlin" },
    ]);
    expect(helper?.memory.map((m) => m.path)).toEqual(["profile.md", "log/2026-09.md"]);
    expect(helper?.sharedMemory).toEqual([
      { path: "grokbot/Helper/shared/profile.md", content: "team note" },
    ]);
    expect(bundle.skills).toEqual([SKILL]);
  });

  it("reports what it leaves out", () => {
    const { skipped } = parseGrokBotExport(files);
    expect(skipped.map((s) => s.item)).toEqual([
      "Helper: On CI failure",
      "memory/Helper/missing.md",
    ]);
  });

  it("keeps keys unique for repeated names", () => {
    const bundle = parseGrokBotExport(
      exportFiles({ version: 1, bots: [{ name: "A" }, { name: "A" }] }),
    );
    expect(bundle.bots.map((b) => b.key)).toEqual(["grokbot:a", "grokbot:a-2"]);
  });

  it("skips a bot whose instructions exceed the limit instead of failing the import", () => {
    const bundle = parseGrokBotExport(
      exportFiles({
        version: 1,
        bots: [{ name: "Big", instructions: "x".repeat(20_001) }, { name: "Small" }],
      }),
    );
    expect(bundle.bots.map((b) => b.name)).toEqual(["Small"]);
    expect(bundle.skipped).toEqual([
      { item: "Big", reason: "Bot is too long or has invalid fields." },
    ]);
  });

  it("rejects memory paths that escape the bot folder", () => {
    const bundle = parseGrokBotExport(
      exportFiles(
        { version: 1, bots: [{ name: "A", memory_files: ["memory/A/../B/x.md"] }] },
        { "memory/A/../B/x.md": "nope" },
      ),
    );
    expect(bundle.bots[0]?.memory).toEqual([]);
    expect(bundle.skipped).toHaveLength(1);
  });

  it("rejects exports it cannot read", () => {
    expect(() => parseGrokBotExport({})).toThrow("manifest.json is missing");
    expect(() => parseGrokBotExport({ "manifest.json": "{" })).toThrow("not valid JSON");
    expect(() => parseGrokBotExport(exportFiles({ version: 2, bots: [] }))).toThrow(
      "not a supported",
    );
  });
});
