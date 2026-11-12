import assert from "node:assert/strict";
import { test } from "node:test";
import { filenameMatchesMime, validateAttachmentContent } from "../supabase/functions/support-chat/attachment-validation.mjs";

function zipFixture(files) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, contents] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(contents, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const count = Object.keys(files).length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return new Blob([...localParts, centralDirectory, end]);
}

test("filename extension must agree with the declared MIME type", () => {
  assert.equal(filenameMatchesMime("screen.JPG", "image/jpeg"), true);
  assert.equal(filenameMatchesMime("screen.exe", "image/jpeg"), false);
  assert.equal(filenameMatchesMime("guide.pdf", "text/plain"), false);
  assert.equal(filenameMatchesMime("book.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), true);
});

test("rejects executable bytes disguised as an allowed image", async () => {
  assert.equal(await validateAttachmentContent(new Blob([Buffer.from("MZ\x90\x00", "binary")]), "image/jpeg"), false);
});

test("validates common image, video, PDF and UTF-8 text signatures", async () => {
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1,
  ]);
  const mp4 = Buffer.from([0, 0, 0, 20, ...Buffer.from("ftypisom"), 0, 0, 0, 0, ...Buffer.from("mp42")]);
  const mov = Buffer.from([0, 0, 0, 16, ...Buffer.from("ftypqt  "), 0, 0, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from("\x42\x82\x84webm", "binary")]);
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
  const text = Buffer.from("A support note\nwith UTF-8: café\n", "utf8");

  assert.equal(await validateAttachmentContent(new Blob([png]), "image/png"), true);
  assert.equal(await validateAttachmentContent(new Blob([jpeg]), "image/jpeg"), true);
  assert.equal(await validateAttachmentContent(new Blob([mp4]), "video/mp4"), true);
  assert.equal(await validateAttachmentContent(new Blob([mov]), "video/quicktime"), true);
  assert.equal(await validateAttachmentContent(new Blob([webm]), "video/webm"), true);
  assert.equal(await validateAttachmentContent(new Blob([pdf]), "application/pdf"), true);
  assert.equal(await validateAttachmentContent(new Blob([text]), "text/plain"), true);
  assert.equal(await validateAttachmentContent(new Blob([Buffer.from([0x61, 0x00, 0x62])]), "text/csv"), false);
});

test("requires real DOCX/XLSX ZIP directory entries and rejects generic or macro archives", async () => {
  const docx = zipFixture({
    "[Content_Types].xml": "<Types></Types>",
    "word/document.xml": "<document></document>",
  });
  const xlsx = zipFixture({
    "[Content_Types].xml": "<Types></Types>",
    "xl/workbook.xml": "<workbook></workbook>",
  });
  const genericZip = zipFixture({ "payload.txt": "not an office document" });
  const macroDoc = zipFixture({
    "[Content_Types].xml": "<Types></Types>",
    "word/document.xml": "<document></document>",
    "word/vbaProject.bin": "macro",
  });

  assert.equal(await validateAttachmentContent(docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), true);
  assert.equal(await validateAttachmentContent(xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), true);
  assert.equal(await validateAttachmentContent(genericZip, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), false);
  assert.equal(await validateAttachmentContent(macroDoc, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), false);
});
