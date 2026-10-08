import { readFileSync } from "node:fs";

/** Inspect existing archives in memory, without extracting or executing code. */
export function readAsar(archivePath) {
  const buffer = readFileSync(archivePath);
  if (buffer.length < 16 || buffer.readUInt32LE(0) !== 4) throw new Error("Invalid ASAR header");
  const headerSize = buffer.readUInt32LE(4);
  const jsonSize = buffer.readUInt32LE(12);
  const dataOffset = 8 + headerSize;
  if (jsonSize > headerSize || 16 + jsonSize > buffer.length || dataOffset > buffer.length) {
    throw new Error("Invalid ASAR bounds");
  }
  const header = JSON.parse(buffer.subarray(16, 16 + jsonSize).toString("utf8"));
  return {
    header,
    read(path) {
      let entry = header;
      for (const segment of path.split("/")) {
        if (!segment || segment === "." || segment === "..") throw new Error("Invalid archive path");
        entry = entry.files?.[segment];
        if (!entry) throw new Error("ASAR entry not found: " + path);
      }
      if (entry.unpacked || entry.link || entry.files) throw new Error("Entry is not an archived regular file");
      const start = dataOffset + Number(entry.offset), end = start + entry.size;
      if (!Number.isSafeInteger(start) || start < dataOffset || end > buffer.length) {
        throw new Error("Invalid ASAR entry bounds");
      }
      return buffer.subarray(start, end);
    },
  };
}
