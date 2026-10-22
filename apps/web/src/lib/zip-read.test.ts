// @vitest-environment node
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readZipTextFiles } from "./zip-read";

function buildZip(entries: { name: string; text: string; deflate?: boolean }[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.text);
    const body = entry.deflate ? deflateRawSync(data) : data;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, entry.deflate ? 8 : 0, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const header = new Uint8Array(46 + name.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x02014b50, true);
    hv.setUint16(10, entry.deflate ? 8 : 0, true);
    hv.setUint32(20, body.length, true);
    hv.setUint32(24, data.length, true);
    hv.setUint16(28, name.length, true);
    hv.setUint32(42, offset, true);
    header.set(name, 46);
    central.push(header);
    parts.push(local, body);
    offset += local.length + body.length;
  }
  const directorySize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe("readZipTextFiles", () => {
  it("reads stored and deflated text files and ignores everything else", async () => {
    const zip = buildZip([
      { name: "manifest.json", text: '{"version":1}' },
      { name: "memory/Bot/profile.md", text: "- é note ".repeat(50), deflate: true },
      { name: "image.png", text: "binary" },
      { name: "__MACOSX/manifest.json", text: "junk" },
    ]);
    const files = await readZipTextFiles(zip);
    expect(Object.keys(files)).toEqual(["manifest.json", "memory/Bot/profile.md"]);
    expect(files["manifest.json"]).toBe('{"version":1}');
    expect(files["memory/Bot/profile.md"]).toBe("- é note ".repeat(50));
  });

  it("removes a single wrapping folder", async () => {
    const zip = buildZip([
      { name: "export/manifest.json", text: "{}" },
      { name: "export/skills/a.md", text: "a" },
    ]);
    expect(Object.keys(await readZipTextFiles(zip))).toEqual(["manifest.json", "skills/a.md"]);
  });

  it("stops inflating a file that is larger than allowed", async () => {
    const zip = buildZip([{ name: "big.md", text: "a".repeat(5_000_000), deflate: true }]);
    await expect(readZipTextFiles(zip)).rejects.toThrow("too large");
  });

  it("rejects data that is not a zip", async () => {
    await expect(readZipTextFiles(new TextEncoder().encode("nope"))).rejects.toThrow("not a zip");
  });
});
