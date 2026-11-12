const MAX_FILE_BYTES = 20 * 1024 * 1024;

const EXTENSIONS_BY_MIME = Object.freeze({
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "video/mp4": [".mp4", ".m4v"],
  "video/webm": [".webm"],
  "video/quicktime": [".mov", ".qt"],
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
});

const MP4_BRANDS = new Set([
  "isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4VH", "M4VP",
  "MSNV", "dash", "3gp4", "3gp5", "3gp6", "cmfc", "cmfs",
]);
const FORBIDDEN_TEXT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const FORBIDDEN_ARCHIVE_ENTRY = /(?:^|\/)vbaproject\.bin$|\.(?:exe|dll|js|mjs|html?|svg|bat|cmd|ps1|vbs|jar|scr)$/i;

function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function readU32BE(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function ascii(bytes, start = 0, end = bytes.length) {
  let result = "";
  for (let index = start; index < end; index += 1) result += String.fromCharCode(bytes[index]);
  return result;
}

async function readBlob(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

function beginsWith(bytes, signature) {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function findBytes(bytes, value) {
  const needle = new TextEncoder().encode(value);
  outer: for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

export function filenameMatchesMime(name, mimeType) {
  const safeName = String(name ?? "").trim().toLowerCase();
  const mime = String(mimeType ?? "").trim().toLowerCase();
  const extensions = EXTENSIONS_BY_MIME[mime];
  return Boolean(extensions && extensions.some((extension) => safeName.endsWith(extension)));
}

async function isUtf8Text(blob) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (FORBIDDEN_TEXT_CONTROLS.test(chunk)) return false;
    }
    return !FORBIDDEN_TEXT_CONTROLS.test(decoder.decode());
  } catch {
    return false;
  } finally {
    reader.releaseLock();
  }
}

async function officeArchiveEntries(blob, mime) {
  if (blob.size < 22 || blob.size > MAX_FILE_BYTES) return null;
  const signature = await readBlob(blob, 0, 4);
  if (!beginsWith(signature, [0x50, 0x4b, 0x03, 0x04])) return null;

  const tailStart = Math.max(0, blob.size - 65557);
  const tail = await readBlob(blob, tailStart, blob.size);
  let eocd = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (readU32(tail, index) !== 0x06054b50) continue;
    const commentLength = readU16(tail, index + 20);
    if (index + 22 + commentLength === tail.length) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) return null;

  const diskNumber = readU16(tail, eocd + 4);
  const centralDisk = readU16(tail, eocd + 6);
  const diskEntries = readU16(tail, eocd + 8);
  const totalEntries = readU16(tail, eocd + 10);
  const centralSize = readU32(tail, eocd + 12);
  const centralOffset = readU32(tail, eocd + 16);
  const eocdAbsolute = tailStart + eocd;
  if (
    diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries ||
    totalEntries < 1 || totalEntries > 5000 || totalEntries === 0xffff ||
    centralSize > 2 * 1024 * 1024 || centralSize === 0xffffffff || centralOffset === 0xffffffff ||
    centralOffset + centralSize > eocdAbsolute
  ) return null;

  const directory = await readBlob(blob, centralOffset, centralOffset + centralSize);
  const entries = new Map();
  let offset = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > directory.length || readU32(directory, offset) !== 0x02014b50) return null;
    const flags = readU16(directory, offset + 8);
    const compressedSize = readU32(directory, offset + 20);
    const nameLength = readU16(directory, offset + 28);
    const extraLength = readU16(directory, offset + 30);
    const commentLength = readU16(directory, offset + 32);
    const localOffset = readU32(directory, offset + 42);
    const nameStart = offset + 46;
    const entryEnd = nameStart + nameLength + extraLength + commentLength;
    if ((flags & 1) !== 0 || nameLength < 1 || nameLength > 1024 || entryEnd > directory.length) return null;

    let name;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(directory.slice(nameStart, nameStart + nameLength));
    } catch {
      return null;
    }
    if (
      name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") ||
      FORBIDDEN_ARCHIVE_ENTRY.test(name)
    ) return null;
    if (localOffset + 30 > centralOffset) return null;
    entries.set(name, { localOffset, compressedSize });
    offset = entryEnd;
  }

  const required = ["[Content_Types].xml"];
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") required.push("word/document.xml");
  else if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") required.push("xl/workbook.xml");
  else return null;
  if (!required.every((name) => entries.has(name))) return null;

  for (const name of required) {
    const entry = entries.get(name);
    const local = await readBlob(blob, entry.localOffset, Math.min(blob.size, entry.localOffset + 30 + 1024));
    if (local.length < 30 || readU32(local, 0) !== 0x04034b50) return null;
    const localNameLength = readU16(local, 26);
    const localExtraLength = readU16(local, 28);
    if (localNameLength < 1 || 30 + localNameLength + localExtraLength > local.length) return null;
    let localName;
    try {
      localName = new TextDecoder("utf-8", { fatal: true }).decode(local.slice(30, 30 + localNameLength));
    } catch {
      return null;
    }
    if (localName !== name) return null;
    const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + entry.compressedSize > centralOffset) return null;
  }
  return entries;
}

export async function validateAttachmentContent(blob, mimeType) {
  const mime = String(mimeType ?? "").trim().toLowerCase();
  if (!blob || typeof blob.slice !== "function" || blob.size < 1 || blob.size > MAX_FILE_BYTES) return false;
  try {
    if (mime === "text/plain" || mime === "text/csv") return await isUtf8Text(blob);
    if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      return Boolean(await officeArchiveEntries(blob, mime));
    }

    const prefix = await readBlob(blob, 0, Math.min(blob.size, 1024));
    if (mime === "image/jpeg") {
      const tail = await readBlob(blob, Math.max(0, blob.size - 65536), blob.size);
      const hasEndMarker = tail.some((byte, index) => byte === 0xff && tail[index + 1] === 0xd9);
      return beginsWith(prefix, [0xff, 0xd8, 0xff]) && hasEndMarker;
    }
    if (mime === "image/png") {
      return blob.size >= 24 && beginsWith(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) &&
        readU32BE(prefix, 8) === 13 && ascii(prefix, 12, 16) === "IHDR" && readU32BE(prefix, 16) > 0 && readU32BE(prefix, 20) > 0;
    }
    if (mime === "image/gif") {
      const tail = await readBlob(blob, Math.max(0, blob.size - 1), blob.size);
      const header = ascii(prefix, 0, 6);
      return (header === "GIF87a" || header === "GIF89a") && tail[0] === 0x3b;
    }
    if (mime === "image/webp") {
      return blob.size >= 16 && ascii(prefix, 0, 4) === "RIFF" && ascii(prefix, 8, 12) === "WEBP" && readU32(prefix, 4) + 8 <= blob.size;
    }
    if (mime === "video/webm") {
      return beginsWith(prefix, [0x1a, 0x45, 0xdf, 0xa3]) && findBytes(prefix, "webm");
    }
    if (mime === "video/mp4" || mime === "video/quicktime") {
      if (prefix.length < 16 || ascii(prefix, 4, 8) !== "ftyp") return false;
      const brands = new Set([ascii(prefix, 8, 12)]);
      for (let offset = 16; offset + 4 <= prefix.length; offset += 4) brands.add(ascii(prefix, offset, offset + 4));
      if (mime === "video/quicktime") return brands.has("qt  ");
      return [...brands].some((brand) => brand !== "qt  " && MP4_BRANDS.has(brand));
    }
    if (mime === "application/pdf") {
      const tail = await readBlob(blob, Math.max(0, blob.size - 65536), blob.size);
      return ascii(prefix, 0, 5) === "%PDF-" && findBytes(tail, "%%EOF");
    }
    return false;
  } catch {
    return false;
  }
}
