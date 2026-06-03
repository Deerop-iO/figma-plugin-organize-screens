/**
 * Minimal zero-dependency ZIP writer (UI lane only).
 *
 * Copy of the canonical kit helper `shared/ui/zip.ts` in
 * create-plugin-starter-kit. Keep this in sync with that source. Used here by
 * the Functional Analysis documentation export to bundle one `.md` per screen
 * into a single download.
 *
 * Produces a STORE (uncompressed) archive with fully-known headers — no
 * streaming data descriptor — so the output is deterministic and easy to keep
 * spec-correct.
 *
 * UI-only: this relies on `TextEncoder`/`Uint8Array`/`DataView`, which exist in
 * the plugin iframe. It must never be imported by `code.ts` (the QuickJS
 * sandbox has no DOM and the download itself happens in the UI).
 */

export interface ZipEntry {
  name: string;
  content: string;
}

// Standard CRC32 (IEEE 802.3) with a lazily-built lookup table.
let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build a STORE-method ZIP from the given files and return its bytes.
 * Names are written UTF-8 with the language-encoding flag (bit 11) set, so
 * non-ASCII filenames stay valid.
 */
export function createZipStore(files: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  // Fixed MS-DOS time/date (no meaningful timestamp; avoids locale noise).
  const dosTime = 0;
  const dosDate = 0x21; // 1980-01-01

  interface Local {
    nameBytes: Uint8Array;
    data: Uint8Array;
    crc: number;
    offset: number;
  }

  const locals: Local[] = [];
  const localChunks: Uint8Array[] = [];
  let offset = 0;

  for (let i = 0; i < files.length; i++) {
    const nameBytes = encoder.encode(files[i].name);
    const data = encoder.encode(files[i].content);
    const crc = crc32(data);

    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // local file header signature
    view.setUint16(4, 20, true); // version needed
    view.setUint16(6, 0x0800, true); // flags: bit 11 = UTF-8 names
    view.setUint16(8, 0, true); // method: STORE
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true); // compressed size
    view.setUint32(22, data.length, true); // uncompressed size
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true); // extra field length
    header.set(nameBytes, 30);

    localChunks.push(header, data);
    locals.push({ nameBytes, data, crc, offset });
    offset += header.length + data.length;
  }

  // Central directory.
  const centralChunks: Uint8Array[] = [];
  let centralSize = 0;
  for (let i = 0; i < locals.length; i++) {
    const l = locals[i];
    const record = new Uint8Array(46 + l.nameBytes.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true); // central dir signature
    view.setUint16(4, 20, true); // version made by
    view.setUint16(6, 20, true); // version needed
    view.setUint16(8, 0x0800, true); // flags: bit 11 = UTF-8 names
    view.setUint16(10, 0, true); // method: STORE
    view.setUint16(12, dosTime, true);
    view.setUint16(14, dosDate, true);
    view.setUint32(16, l.crc, true);
    view.setUint32(20, l.data.length, true); // compressed size
    view.setUint32(24, l.data.length, true); // uncompressed size
    view.setUint16(28, l.nameBytes.length, true);
    view.setUint16(30, 0, true); // extra field length
    view.setUint16(32, 0, true); // comment length
    view.setUint16(34, 0, true); // disk number start
    view.setUint16(36, 0, true); // internal attrs
    view.setUint32(38, 0, true); // external attrs
    view.setUint32(42, l.offset, true); // local header offset
    record.set(l.nameBytes, 46);
    centralChunks.push(record);
    centralSize += record.length;
  }

  // End of central directory record.
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true); // this disk
  endView.setUint16(6, 0, true); // disk with central dir
  endView.setUint16(8, locals.length, true); // entries on this disk
  endView.setUint16(10, locals.length, true); // total entries
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true); // central dir offset
  endView.setUint16(20, 0, true); // comment length

  const total =
    offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (let i = 0; i < localChunks.length; i++) {
    out.set(localChunks[i], p);
    p += localChunks[i].length;
  }
  for (let i = 0; i < centralChunks.length; i++) {
    out.set(centralChunks[i], p);
    p += centralChunks[i].length;
  }
  out.set(end, p);
  return out;
}
