import "server-only";
import { deflateRawSync } from "node:zlib";

/**
 * Minimal ZIP archive writer using only node:zlib (deflateRaw). Produces a
 * valid ZIP that Windows Explorer, macOS Finder, and `unzip` accept.
 *
 * We intentionally avoid a dependency (archiver/jszip) and the parent-dir
 * space issue that blocks `npm install` here. Supports enough of the ZIP
 * format for our export bundle: uncompressed-or-deflated entries, a single
 * central directory, and the end-of-central-directory record. No encryption,
 * no ZIP64 (files are small; cap entries so offsets fit in 32 bits).
 */

type ZipEntry = { name: string; data: Buffer };

// CRC-32 (IEEE) table, computed once.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff, 0);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

const DOS_EPOCH = u16(0).subarray(0, 2); // 1980-01-01 00:00:00 in DOS time
const DOS_TIME = u16(0).subarray(0, 2);

export function buildZip(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    // Deflate unless tiny (stored = 0, deflate = 8).
    const compressed = entry.data.length > 64 ? deflateRawSync(entry.data) : entry.data;
    const method = compressed.length < entry.data.length ? 8 : 0;
    const fileData = method === 8 ? compressed : entry.data;

    // Local file header (signature 0x04034b50).
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed to extract (2.0)
      u16(0), // general purpose flags
      u16(method),
      Buffer.concat([DOS_TIME, DOS_EPOCH]), // mod time + date (2x u16)
      u32(crc),
      u32(fileData.length),
      u32(entry.data.length),
      u16(nameBuf.length),
      u16(0), // extra field length
      nameBuf,
      fileData,
    ]);
    localChunks.push(local);

    // Central directory record.
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20), // version made by
      u16(20), // version needed
      u16(0),
      u16(method),
      Buffer.concat([DOS_TIME, DOS_EPOCH]),
      u32(crc),
      u32(fileData.length),
      u32(entry.data.length),
      u16(nameBuf.length),
      u16(0), // extra
      u16(0), // comment
      u16(0), // disk number start
      u16(0), // internal attrs
      u32(0), // external attrs
      u32(offset),
      nameBuf,
    ]);
    centralChunks.push(central);

    offset += local.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralChunks);

  // End of central directory.
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBuf.length),
    u32(centralStart),
    u16(0), // comment length
  ]);

  return Buffer.concat([...localChunks, centralBuf, eocd]);
}
