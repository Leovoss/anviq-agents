// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));
vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray) => strings.join(""),
  plural: (n: number, forms: { one: string; other: string }) =>
    (n === 1 ? forms.one : forms.other).replace("#", String(n)),
}));
vi.mock("@anviq/ui-web", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

const { run, readZip } = vi.hoisted(() => ({ run: vi.fn(), readZip: vi.fn() }));
vi.mock("../lib/space-rpc", () => ({ useSpaceRpc: () => ({ botImport: { run } }) }));
vi.mock("../lib/zip-read", () => ({ readZipTextFiles: readZip }));

import { ImportSettingsPanel } from "./ImportSettingsPanel";

const preview = {
  applied: false,
  bots: 2,
  routines: 1,
  skills: 3,
  memory: 5,
  skipped: [{ item: "Helper: Watch CI", reason: "Only scheduled routines are imported." }],
};

it("previews an export, then imports it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  readZip.mockResolvedValue({ "manifest.json": "{}" });
  run.mockResolvedValueOnce(preview).mockResolvedValueOnce({ ...preview, applied: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<ImportSettingsPanel />));

  const input = container.querySelector<HTMLInputElement>('[data-testid="import-file"]');
  const file = new File(["zip"], "export.zip");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input?.dispatchEvent(new Event("change", { bubbles: true }));
  });

  expect(run).toHaveBeenLastCalledWith({
    source: "grokbot",
    files: { "manifest.json": "{}" },
    dryRun: true,
  });
  const summary = container.querySelector('[data-testid="import-summary"]');
  expect(summary?.textContent).toContain("2 bots · 1 routine · 3 skills · 5 notes");
  expect(summary?.textContent).toContain("Helper: Watch CI: Only scheduled routines are imported.");

  const apply = [...container.querySelectorAll("button")].find((b) => b.textContent === "Import");
  await act(async () => apply?.click());
  expect(run).toHaveBeenLastCalledWith({
    source: "grokbot",
    files: { "manifest.json": "{}" },
    dryRun: false,
  });
  expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Import")).toBe(
    false,
  );
  await act(async () => root.unmount());
});

it("shows why an export could not be read", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  readZip.mockRejectedValue(new Error("This is not a zip file."));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<ImportSettingsPanel />));
  const input = container.querySelector<HTMLInputElement>('[data-testid="import-file"]');
  Object.defineProperty(input, "files", { value: [new File(["x"], "x.zip")], configurable: true });
  await act(async () => {
    input?.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("not a zip");
  await act(async () => root.unmount());
});
