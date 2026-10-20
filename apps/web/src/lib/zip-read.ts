import {
  BOT_IMPORT_MAX_FILE_CHARS,
  BOT_IMPORT_MAX_FILES,
  BOT_IMPORT_MAX_TOTAL_CHARS,
} from "@anviq/contracts";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const TEXT_FILE = /\.(json|md)$/i;

/** Reads a deflate stream, giving up as soon as it passes `limit` bytes. */
async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data.slice()])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("A file in the export is too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Strips a single wrapping folder, as zipping a folder produces. */
function withoutWrapperFolder(files: Record<string, string>): Record<string, string> {
  if ("manifest.json" in files) return files;
  const manifest = Object.keys(files).find((path) => /^[^/]+\/manifest\.json$/.test(path));
  if (!manifest) return files;
  const prefix = manifest.slice(0, manifest.indexOf("/") + 1);
  return Object.fromEntries(
    Object.entries(files)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, text]) => [path.slice(prefix.length), text]),
  );
}

/** The .json and .md files of a zip as text, keyed by path. */
export async function readZipTextFiles(zip: Uint8Array): Promise<Record<string, string>> {
  if (zip.length > MAX_ZIP_BYTES) throw new Error("The export is too large.");
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("This is not a zip file.");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  if (count === 0xffff || cursor === 0xffffffff) throw new Error("This zip file is not supported.");

  const decoder = new TextDecoder();
  const files: Record<string, string> = {};
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > zip.length || view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error("This zip file is damaged.");
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder
      .decode(zip.subarray(cursor + 46, cursor + 46 + nameLength))
      .replaceAll("\\", "/");
    cursor += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/") || name.startsWith("__MACOSX/") || !TEXT_FILE.test(name)) continue;
    if (Object.keys(files).length >= BOT_IMPORT_MAX_FILES) throw new Error("Too many files.");
    if (localOffset + 30 > zip.length || view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) {
      throw new Error("This zip file is damaged.");
    }
    const start =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    const raw = zip.subarray(start, start + compressedSize);
    let bytes: Uint8Array;
    if (method === 0) bytes = raw;
    else if (method === 8) bytes = await inflate(raw, BOT_IMPORT_MAX_FILE_CHARS * 4);
    else throw new Error("This zip file is not supported.");

    const text = decoder.decode(bytes);
    total += text.length;
    if (text.length > BOT_IMPORT_MAX_FILE_CHARS || total > BOT_IMPORT_MAX_TOTAL_CHARS) {
      throw new Error("The export is too large.");
    }
    files[name] = text;
  }
  return withoutWrapperFolder(files);
}
