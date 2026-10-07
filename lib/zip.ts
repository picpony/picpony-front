/**
 * A ZIP archive writer, store-only — the pictures it packs are already compressed, so deflating
 * them again costs time and saves nothing (and no dependency is needed for it).
 *
 * What it writes is the plain PKWARE format any unzip opens: a local header and the bytes for each
 * entry, then the central directory and its end record. Names are UTF-8 (general-purpose bit 11),
 * so Chinese file names survive. Once an offset, a size or the entry count outgrows the classic
 * 32-bit fields (an archive over 4 GiB, or more than 65,535 entries), the ZIP64 extra fields and
 * end records are written as well — `zip64: 'always'` forces them, for tests.
 *
 * Plain module, no DOM beyond `Blob`: the archive is assembled from parts, so the pictures are
 * never copied into one buffer.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const ZIP64_END = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const UTF8_NAMES = 0x0800;
const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), as ZIP stores it. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date, in the device's own time zone — the format has no other. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

class Bytes {
  readonly buffer: Uint8Array;
  private view: DataView;
  private at = 0;
  constructor(length: number) {
    this.buffer = new Uint8Array(length);
    this.view = new DataView(this.buffer.buffer);
  }
  u16(value: number) {
    this.view.setUint16(this.at, value, true);
    this.at += 2;
    return this;
  }
  u32(value: number) {
    this.view.setUint32(this.at, value >>> 0, true);
    this.at += 4;
    return this;
  }
  u64(value: number) {
    this.view.setBigUint64(this.at, BigInt(value), true);
    this.at += 8;
    return this;
  }
  bytes(value: Uint8Array) {
    this.buffer.set(value, this.at);
    this.at += value.length;
    return this;
  }
}

interface Written {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
  zip64: boolean;
}

export interface ZipOptions {
  /** `auto` (the default): ZIP64 only where a value needs it. `always`: every entry and the end. */
  zip64?: 'auto' | 'always';
}

export class ZipWriter {
  private readonly parts: BlobPart[] = [];
  private readonly entries: Written[] = [];
  private offset = 0;
  private readonly forceZip64: boolean;
  private readonly encoder = new TextEncoder();
  private finished: Blob | null = null;

  constructor(options: ZipOptions = {}) {
    this.forceZip64 = options.zip64 === 'always';
  }

  get count(): number {
    return this.entries.length;
  }

  /** Add a file. `name` is the path inside the archive; the caller makes it unique. */
  add(name: string, data: Uint8Array, modified: Date = new Date()): void {
    if (this.finished) throw new Error('archive already finished');
    const encodedName = this.encoder.encode(name);
    if (encodedName.length > MAX_16) throw new RangeError('entry name is too long');
    const crc = crc32(data);
    const { time, date } = dosDateTime(modified);
    const zip64 = this.forceZip64 || data.length >= MAX_32 || this.offset >= MAX_32;
    /* The local header's ZIP64 extra holds the two sizes (the offset lives in the directory). */
    const extraLength = zip64 ? 20 : 0;
    const header = new Bytes(30 + encodedName.length + extraLength)
      .u32(LOCAL_HEADER)
      .u16(zip64 ? 45 : 20)
      .u16(UTF8_NAMES)
      .u16(0)
      .u16(time)
      .u16(date)
      .u32(crc)
      .u32(zip64 ? MAX_32 : data.length)
      .u32(zip64 ? MAX_32 : data.length)
      .u16(encodedName.length)
      .u16(extraLength)
      .bytes(encodedName);
    if (zip64) header.u16(0x0001).u16(16).u64(data.length).u64(data.length);
    this.entries.push({ name: encodedName, crc, size: data.length, offset: this.offset, time, date, zip64 });
    this.parts.push(header.buffer as Uint8Array<ArrayBuffer>, data as Uint8Array<ArrayBuffer>);
    this.offset += header.buffer.length + data.length;
  }

  /** The archive. Nothing can be added after. */
  finish(): Blob {
    if (this.finished) return this.finished;
    const directoryOffset = this.offset;
    let directorySize = 0;
    for (const entry of this.entries) {
      const needs64 = entry.zip64 || entry.offset >= MAX_32;
      const extraLength = needs64 ? 28 : 0;
      const record = new Bytes(46 + entry.name.length + extraLength)
        .u32(CENTRAL_HEADER)
        .u16(needs64 ? 45 : 20)
        .u16(needs64 ? 45 : 20)
        .u16(UTF8_NAMES)
        .u16(0)
        .u16(entry.time)
        .u16(entry.date)
        .u32(entry.crc)
        .u32(needs64 ? MAX_32 : entry.size)
        .u32(needs64 ? MAX_32 : entry.size)
        .u16(entry.name.length)
        .u16(extraLength)
        .u16(0)
        .u16(0)
        .u16(0)
        .u32(0)
        .u32(needs64 ? MAX_32 : entry.offset)
        .bytes(entry.name);
      if (needs64) record.u16(0x0001).u16(24).u64(entry.size).u64(entry.size).u64(entry.offset);
      this.parts.push(record.buffer as Uint8Array<ArrayBuffer>);
      directorySize += record.buffer.length;
    }
    const count = this.entries.length;
    const end64 =
      this.forceZip64 || count >= MAX_16 || directoryOffset >= MAX_32 || directorySize >= MAX_32;
    if (end64) {
      const zip64EndOffset = directoryOffset + directorySize;
      const record = new Bytes(56)
        .u32(ZIP64_END)
        .u64(44)
        .u16(45)
        .u16(45)
        .u32(0)
        .u32(0)
        .u64(count)
        .u64(count)
        .u64(directorySize)
        .u64(directoryOffset);
      const locator = new Bytes(20).u32(ZIP64_LOCATOR).u32(0).u64(zip64EndOffset).u32(1);
      this.parts.push(record.buffer as Uint8Array<ArrayBuffer>, locator.buffer as Uint8Array<ArrayBuffer>);
    }
    const end = new Bytes(22)
      .u32(END_OF_CENTRAL)
      .u16(0)
      .u16(0)
      .u16(end64 ? MAX_16 : count)
      .u16(end64 ? MAX_16 : count)
      .u32(end64 ? MAX_32 : directorySize)
      .u32(end64 ? MAX_32 : directoryOffset)
      .u16(0);
    this.parts.push(end.buffer as Uint8Array<ArrayBuffer>);
    this.finished = new Blob(this.parts, { type: 'application/zip' });
    /* The Blob holds its own copy of the bytes: keeping the parts as well held every picture of
       the archive twice for as long as the writer lived (G3-013). */
    this.parts.length = 0;
    return this.finished;
  }
}

/** Characters no file system takes in a name, and the control range. */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const MAX_NAME = 180;

/**
 * A safe, unique name for an archive entry — the original front end's rule: the last segment of
 * the source URL, decoded, unsafe characters as `_`, at most 180 characters, `fallback` when nothing
 * is left; a second entry of the same name (compared without case, as Windows and macOS do) becomes
 * `name_2.ext`, then `name_3.ext`. `taken` is the archive's names so far, lower-cased; it is updated.
 */
export function uniqueEntryName(url: string, fallback: string, taken: Set<string>): string {
  const segment = url.split(/[?#]/, 1)[0].split('/').pop() ?? '';
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    /* A malformed escape: the raw segment, made safe below. */
  }
  const clean = (value: string) => value.replace(UNSAFE, '_').trim().slice(0, MAX_NAME).replace(/[. ]+$/, '');
  let safe = clean(decoded) || clean(fallback) || 'picture';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = `_${safe}`;
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : '';
  let candidate = safe;
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${stem}_${n}${extension}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}
