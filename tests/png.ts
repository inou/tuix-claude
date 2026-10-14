// A PNG writer for the tests of the thumbnail: any colour type and bit depth, any filter, in chunks, with a zlib
// stream of stored blocks or of runs. It shares no code with the reader in hooks/thumbnail.ts. The mod has no
// deflate, so a big image is made of runs: a few bytes that a match at a short distance repeats.

type ColourType = 0 | 2 | 3 | 4 | 6

const CHANNELS: Record<ColourType, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export function u32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
}

const CRC = (() => {
  const table: number[] = []

  for (let n = 0; n < 256; n += 1) {
    let c = n

    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }

    table.push(c >>> 0)
  }

  return table
})()

function crc32(bytes: readonly number[] | Uint8Array): number {
  let c = 0xffffffff

  for (const byte of bytes) {
    c = CRC[(c ^ byte) & 255]! ^ (c >>> 8)
  }

  return (c ^ 0xffffffff) >>> 0
}

export function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0

  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }

  return ((b << 16) | a) >>> 0
}

function join(parts: readonly (readonly number[] | Uint8Array)[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0))
  let at = 0

  for (const one of parts) {
    out.set(one, at)
    at += one.length
  }

  return out
}

export function chunk(type: string, data: readonly number[] | Uint8Array): Uint8Array {
  const name = [...type].map(letter => letter.charCodeAt(0))

  return join([u32(data.length), name, data, u32(crc32([...name, ...data]))])
}

// A zlib stream of stored blocks: no compression, so any size of data.
export function zlibStored(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = []

  for (let at = 0; at < Math.max(1, data.length); at += 65535) {
    const part = data.subarray(at, at + 65535)
    const isLast = at + 65535 >= data.length

    blocks.push(join([[isLast ? 1 : 0, part.length & 255, part.length >> 8, ~part.length & 255, (~part.length >> 8) & 255], part]))
  }

  return join([[0x78, 0x01], ...blocks, u32(adler32(data))])
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

// A zlib stream of one block with the fixed Huffman codes. Where the data repeats what came `distances` bytes
// before, a match says so, up to 258 bytes at a time: so a solid row, or a row that equals the row above, is a few bits.
export function zlibRuns(data: Uint8Array, distances: readonly number[]): Uint8Array {
  const out: number[] = []
  let bits = 0
  let count = 0

  // The bits of a value go out low bit first; a Huffman code goes out high bit first.
  const put = (value: number, length: number): void => {
    for (let i = 0; i < length; i += 1) {
      bits |= ((value >> i) & 1) << count
      count += 1

      if (count === 8) {
        out.push(bits)
        bits = 0
        count = 0
      }
    }
  }
  const code = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i -= 1) {
      put((value >> i) & 1, 1)
    }
  }
  const symbol = (value: number): void => {
    if (value < 144) code(0x30 + value, 8)
    else if (value < 256) code(0x190 + value - 144, 9)
    else if (value < 280) code(value - 256, 7)
    else code(0xc0 + value - 280, 8)
  }

  put(1, 1)
  put(1, 2)

  for (let at = 0; at < data.length; ) {
    let best = 0
    let bestDistance = 0

    for (const distance of distances) {
      if (distance > at) continue

      let length = 0

      while (length < 258 && at + length < data.length && data[at + length] === data[at + length - distance]) {
        length += 1
      }

      if (length > best) {
        best = length
        bestDistance = distance
      }
    }

    if (best >= 3) {
      const lengthIndex = LENGTH_BASE.findLastIndex(base => base <= best)
      const distanceIndex = DISTANCE_BASE.findLastIndex(base => base <= bestDistance)

      symbol(257 + lengthIndex)
      put(best - LENGTH_BASE[lengthIndex]!, LENGTH_EXTRA[lengthIndex]!)
      code(distanceIndex, 5)
      put(bestDistance - DISTANCE_BASE[distanceIndex]!, DISTANCE_EXTRA[distanceIndex]!)
      at += best
    } else {
      symbol(data[at]!)
      at += 1
    }
  }

  symbol(256)

  if (count > 0) {
    out.push(bits)
  }

  return join([[0x78, 0x01], out, u32(adler32(data))])
}

// The bits of a deflate stream: the bits of a value go out low bit first, a Huffman code high bit first.
class Bits {
  bytes: number[] = []
  private bits = 0
  private count = 0

  put(value: number, length: number): void {
    for (let i = 0; i < length; i += 1) {
      this.bits |= ((value >> i) & 1) << this.count
      this.count += 1

      if (this.count === 8) {
        this.bytes.push(this.bits)
        this.bits = 0
        this.count = 0
      }
    }
  }

  code(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.put((value >> i) & 1, 1)
    }
  }

  flush(): void {
    if (this.count > 0) {
      this.bytes.push(this.bits)
      this.bits = 0
      this.count = 0
    }
  }
}

// The order in which a dynamic block lists the lengths of the codes that code the lengths.
const LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
// The codes that code the lengths: the lengths 0 to 14 get four bits, and 15 and the run of zeros (18) get five.
// Together they fill the code exactly: 15/16 + 2/32.
const LENGTH_CODE_BITS: Record<number, number> = { ...Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i, 4])), 15: 5, 18: 5 }
// The codes of a canonical Huffman code, as deflate hands them out: by length, then by symbol.
function canonical(lengths: Record<number, number>): Record<number, number> {
  const codes: Record<number, number> = {}
  let code = 0

  for (let length = 1; length <= 15; length += 1) {
    for (const symbol of Object.keys(lengths).map(Number).sort((a, b) => a - b)) {
      if (lengths[symbol] === length) {
        codes[symbol] = code
        code += 1
      }
    }

    code <<= 1
  }

  return codes
}

// A dynamic block of nothing but its end: the header holds `literals` and `distances` code lengths, so a decoder
// builds the tables of those codes for each block and writes no byte.
function emptyBlock(bits: Bits, literals: readonly number[], distances: readonly number[]): void {
  const lengthCodes = canonical(LENGTH_CODE_BITS)
  const all = [...literals, ...distances]

  bits.put(0, 1)
  bits.put(2, 2)
  bits.put(literals.length - 257, 5)
  bits.put(distances.length - 1, 5)
  bits.put(19 - 4, 4)

  for (const symbol of LENGTH_ORDER) {
    bits.put(LENGTH_CODE_BITS[symbol] ?? 0, 3)
  }

  // The lengths, a run of eleven zeros or more as one symbol.
  for (let at = 0; at < all.length; ) {
    let run = 0

    while (all[at + run] === 0 && run < 138) run += 1

    if (run >= 11) {
      bits.code(lengthCodes[18]!, 5)
      bits.put(run - 11, 7)
      at += run
    } else {
      bits.code(lengthCodes[all[at]!]!, LENGTH_CODE_BITS[all[at]!]!)
      at += 1
    }
  }

  // The end of block is the one code of one bit in the codes below, and the code of one bit is 0.
  bits.code(0, 1)
}

export type BombSpec = {
  // How many length codes and distance codes each block's header holds; zlib allows 286 and 30.
  literals?: number
  distances?: number
  // The lengths of the codes in each block: `complete` fills the code exactly, as zlib wants it; `over` has
  // two codes of one bit more than a code can hold; `incomplete` leaves a gap.
  codes?: 'complete' | 'over' | 'incomplete'
}

// A zlib stream of `count` empty dynamic blocks and an empty stored block to end it. A block is some thirty
// bytes and writes nothing, but its header has codes of fifteen bits, so a decoder builds two tables of 2^15
// entries for it. A decoder that stops only when its output is full runs for as long as the blocks last.
export function zlibBomb(count: number, spec: BombSpec = {}): Uint8Array {
  const { literals = 286, distances = 30, codes = 'complete' } = spec
  // The end of block (256) has the one code of one bit; fourteen literals have two to fifteen bits, and one more
  // has fifteen: 1/2 + 1/4 + ... + 2^-15 + 2^-15 = 1.
  const lit = Array.from({ length: literals }, () => 0)

  lit[256] = 1

  for (let i = 0; i < 14; i += 1) lit[i] = i + 2

  lit[14] = 15

  // The distances: one to fifteen bits in the same way.
  const dist = Array.from({ length: distances }, (_, i) => (i < 14 ? i + 1 : i < 16 ? 15 : 0))

  if (codes === 'over') lit[257] = 1
  if (codes === 'incomplete') lit[14] = 0

  const bits = new Bits()

  for (let i = 0; i < count; i += 1) emptyBlock(bits, lit, dist)

  // An empty stored block ends the stream, then the Adler-32 of nothing, which is 1.
  bits.put(1, 1)
  bits.put(0, 2)
  bits.flush()

  return join([[0x78, 0x01], bits.bytes, [0, 0, 0xff, 0xff], u32(1)])
}

export type PngSpec = {
  width: number
  height: number
  type: ColourType
  depth: 1 | 2 | 4 | 8 | 16
  // The sample `channel` of the pixel at x, y (the palette index for a palette), below 2 ** depth.
  sample: (x: number, y: number, channel: number) => number
  palette?: number[]
  transparency?: number[]
  // The filter of row y is filters[y % filters.length]; none by default.
  filters?: readonly number[]
  // `runs` makes the zlib stream of matches, for a big image. Stored blocks by default.
  stream?: 'stored' | 'runs'
  // The interlace byte of the header.
  interlace?: number
  // The size the header says, when it is not the size of the data.
  declare?: { width: number; height: number }
  // The IDAT data is cut in this many chunks.
  parts?: number
  // Changes the bytes of the zlib stream before they are cut in chunks.
  edit?: (zlib: Uint8Array) => Uint8Array
  // More chunks after the data, and the end.
  noEnd?: boolean
}

// The bytes of a row, the samples packed to the bit depth.
function packRow(spec: PngSpec, y: number): Uint8Array {
  const channels = CHANNELS[spec.type]
  const row = new Uint8Array(Math.ceil((spec.width * channels * spec.depth) / 8))
  let at = 0
  let bits = 0
  let count = 0

  for (let x = 0; x < spec.width; x += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = spec.sample(x, y, channel)

      if (spec.depth === 16) {
        row[at++] = value >> 8
        row[at++] = value & 255
      } else if (spec.depth === 8) {
        row[at++] = value
      } else {
        bits = (bits << spec.depth) | value
        count += spec.depth

        if (count === 8) {
          row[at++] = bits
          bits = 0
          count = 0
        }
      }
    }
  }

  if (count > 0) {
    row[at] = bits << (8 - count)
  }

  return row
}

function filterRow(kind: number, row: Uint8Array, above: Uint8Array, step: number): Uint8Array {
  if (kind === 0) {
    return row
  }

  const out = new Uint8Array(row.length)

  for (let i = 0; i < row.length; i += 1) {
    const a = i >= step ? row[i - step]! : 0
    const b = above[i]!
    const c = i >= step ? above[i - step]! : 0
    let predicted = 0

    if (kind === 1) {
      predicted = a
    } else if (kind === 2) {
      predicted = b
    } else if (kind === 3) {
      predicted = (a + b) >> 1
    } else {
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)

      predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }

    out[i] = (row[i]! - predicted) & 255
  }

  return out
}

// The data of the image: each row has its filter byte in front.
export function imageData(spec: PngSpec): Uint8Array {
  const step = Math.max(1, (CHANNELS[spec.type] * spec.depth) >> 3)
  const filters = spec.filters ?? [0]
  const first = packRow(spec, 0)
  const data = new Uint8Array((first.length + 1) * spec.height)
  let above: Uint8Array = new Uint8Array(first.length)

  for (let y = 0; y < spec.height; y += 1) {
    const row = y === 0 ? first : packRow(spec, y)
    const kind = filters[y % filters.length]!

    data[y * (row.length + 1)] = kind
    data.set(filterRow(kind, row, above, step), y * (row.length + 1) + 1)
    above = row
  }

  return data
}

export function png(spec: PngSpec): Uint8Array {
  const data = imageData(spec)
  const step = Math.max(1, (CHANNELS[spec.type] * spec.depth) >> 3)
  const stride = data.length / spec.height
  const zlib = (spec.edit ?? (one => one))(spec.stream === 'runs' ? zlibRuns(data, [step, stride]) : zlibStored(data))
  const parts = Math.max(1, spec.parts ?? 1)
  const size = Math.ceil(zlib.length / parts)
  const idat = Array.from({ length: parts }, (_, i) => chunk('IDAT', zlib.subarray(i * size, (i + 1) * size)))

  return join([
    [137, 80, 78, 71, 13, 10, 26, 10],
    chunk('IHDR', [...u32(spec.declare?.width ?? spec.width), ...u32(spec.declare?.height ?? spec.height), spec.depth, spec.type, 0, 0, spec.interlace ?? 0]),
    ...(spec.palette === undefined ? [] : [chunk('PLTE', spec.palette)]),
    ...(spec.transparency === undefined ? [] : [chunk('tRNS', spec.transparency)]),
    ...idat,
    ...(spec.noEnd === true ? [] : [chunk('IEND', [])]),
  ])
}

// The engine has the base64 methods of Uint8Array; the type library does not list them yet.
export function base64Of(bytes: Uint8Array): string {
  return (bytes as Uint8Array & { toBase64: () => string }).toBase64()
}

export function bytesOf(base64: string): Uint8Array {
  return (Uint8Array as unknown as { fromBase64: (text: string) => Uint8Array }).fromBase64(base64)
}
