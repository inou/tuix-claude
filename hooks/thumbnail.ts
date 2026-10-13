import { TOO_SLOW, unzlibInto } from './vendor/inflate'
import { decode as decodeJpeg } from './vendor/jpeg-decoder'
import { encode as encodeJpeg } from './vendor/jpeg-encoder'

// A small copy of a screenshot, made on the computer of the person: the mod reads a PNG or JPEG, shrinks it
// with an area filter, and writes a JPEG that fits in one drawing. A mod has no image decoder, so all of it
// is plain code: the inflate of fflate, the JPEG code of jpeg-js (hooks/vendor), and the PNG reader below.
// The bytes come from a report, so they are untrusted: every size is checked before it is allocated.

export type ThumbnailInput = { mediaType: string; base64: string }
export type Thumbnail = { jpegBase64: string; width: number; height: number }
export type ThumbnailError = { error: string }

// The longest side, and the most pixels, of a screenshot the mod reads. The Tuix server caps a side at 3200
// pixels, and Claude Code resizes anything over 2000, so nothing larger comes.
export const MAX_SIDE = 3200
export const MAX_PIXELS = 3200 * 3200
// The most base64 characters of an input (8 MiB), and the most bytes of PNG data to inflate: the rows with
// their filter bytes, as the stream holds them. 64 MiB holds 3200 x 3200 at 16 bits and three channels (61 MB),
// which is more than a browser writes. 16 bits and four channels would need 82 MB.
export const MAX_BASE64 = 8 * 1024 * 1024
const MAX_RAW = 64 * 1024 * 1024
// The most scans a JPEG may have. A progressive JPEG has about ten, and each scan costs a pass over the picture.
const MAX_SCANS = 64
// How long a screenshot may take: the inflate of a PNG stops when it passes this, and so does the walk down the
// ladder below. A JPEG decode cannot be stopped, so it is limited by its size and its scans instead.
export const TIME_LIMIT_MS = 2000
// The most pixels high a copy is. The most wide is the first width of the ladder below.
const THUMB_HEIGHT = 2000
// The base64 characters a copy may have. One drawing holds 131,072 characters, and the markup is small.
export const DEFAULT_BUDGET = 92_000
// What the mod tries, in order, until a copy fits the budget: the most it is wide, and a JPEG quality.
const LADDER: readonly (readonly [width: number, quality: number])[] = [
  [800, 0.72],
  [800, 0.6],
  [640, 0.6],
  [480, 0.6],
  [480, 0.5],
  [360, 0.5],
]

// An error with words of our own. Any other error (a library's) reads as a screenshot that cannot be read.
class ReadError extends Error {}

const SLOW_TEXT = 'The screenshot took too long to read.'

function fail(message: string): never {
  throw new ReadError(message)
}

// Standard base64: the 64 letters, then up to two `=`. The drawings in tuix.ts check their data with it too.
export const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

// The engine has the base64 methods of Uint8Array (see $.fs.read); the type library does not list them yet.
type Base64Bytes = { fromBase64: (text: string, options?: { lastChunkHandling?: 'strict' }) => Uint8Array }

// Strict base64 to bytes: only the 64 letters, `=` at the end, a length of whole groups.
function bytesOf(base64: string): Uint8Array {
  if (base64.length === 0 || base64.length % 4 !== 0 || !BASE64.test(base64)) {
    fail('The screenshot is not valid base64.')
  }

  try {
    return (Uint8Array as unknown as Base64Bytes).fromBase64(base64, { lastChunkHandling: 'strict' })
  } catch {
    return fail('The screenshot is not valid base64.')
  }
}

function base64Of(bytes: Uint8Array): string {
  return (bytes as Uint8Array & { toBase64: () => string }).toBase64()
}

// A picture to read rows from: the size, and a function that writes the row `y` as RGB bytes, with any
// transparency flattened onto white.
type Raster = { width: number; height: number; readRow: (y: number, out: Uint8Array) => void }

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
// The channels of each colour type, and the bit depths each one allows.
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const DEPTHS: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }

function checkSize(width: number, height: number): void {
  if (width < 1 || height < 1) {
    fail('The screenshot has no size.')
  }

  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    fail('The screenshot is larger than 3200 pixels a side or 10 million pixels.')
  }
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
}

// White under a colour with alpha `a`: 255 is the colour, 0 is white.
function onWhite(colour: number, a: number): number {
  return ((colour * a + 255 * (255 - a) + 127) / 255) | 0
}

type Png = {
  width: number
  height: number
  depth: number
  type: number
  idat: Uint8Array
  palette: Uint8Array | undefined
  alpha: Uint8Array | undefined
}

// Reads the chunks of a PNG. A chunk must lie inside the bytes; the CRCs are not checked, since the inflate
// and the size of the data catch a cut or garbled file.
function parsePng(bytes: Uint8Array): Png {
  if (bytes.length < 33 || SIGNATURE.some((value, index) => bytes[index] !== value)) {
    fail('The screenshot is not a PNG.')
  }

  let header: Pick<Png, 'width' | 'height' | 'depth' | 'type'> | undefined
  let palette: Uint8Array | undefined
  let alpha: Uint8Array | undefined
  const parts: Uint8Array[] = []
  let total = 0
  let at = 8

  while (at + 12 <= bytes.length) {
    const size = u32(bytes, at)
    const name = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!)
    const start = at + 8

    if (size > bytes.length - start - 4) {
      fail('The PNG is cut off.')
    }

    const data = bytes.subarray(start, start + size)

    if (header === undefined && name !== 'IHDR') {
      fail('The PNG has no header.')
    }

    if (name === 'IHDR') {
      if (header !== undefined || size !== 13) {
        fail('The PNG header is wrong.')
      }

      const width = u32(data, 0)
      const height = u32(data, 4)
      const depth = data[8]!
      const type = data[9]!

      // Checked before any pixel is allocated.
      checkSize(width, height)

      if (!(DEPTHS[type]?.includes(depth) ?? false)) {
        fail('This kind of PNG is not supported.')
      }

      if (data[10] !== 0 || data[11] !== 0) {
        fail('This kind of PNG is not supported.')
      }

      if (data[12] !== 0) {
        fail('An interlaced PNG is not supported.')
      }

      header = { width, height, depth, type }
    } else if (name === 'PLTE') {
      if (size === 0 || size % 3 !== 0 || size > 768) {
        fail('The PNG palette is wrong.')
      }

      palette = data
    } else if (name === 'tRNS') {
      alpha = data
    } else if (name === 'IDAT') {
      parts.push(data)
      total += size
    } else if (name === 'IEND') {
      break
    } else if ((name.charCodeAt(0) & 32) === 0) {
      // A critical chunk the mod does not know.
      fail('This kind of PNG is not supported.')
    }

    at = start + size + 4
  }

  if (header === undefined || total === 0) {
    fail('The PNG has no image data.')
  }

  if (header.type === 3 && palette === undefined) {
    fail('The PNG has no palette.')
  }

  const idat = parts.length === 1 ? parts[0]! : new Uint8Array(total)

  if (parts.length > 1) {
    let offset = 0

    for (const part of parts) {
      idat.set(part, offset)
      offset += part.length
    }
  }

  return { ...header, idat, palette, alpha }
}

// The Adler-32 checksum that ends a zlib stream.
function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0

  for (let at = 0; at < data.length; ) {
    // 5552 bytes is the most that cannot overflow before the modulo.
    const end = Math.min(at + 5552, data.length)

    for (; at < end; at += 1) {
      a += data[at]!
      b += a
    }

    a %= 65521
    b %= 65521
  }

  return ((b << 16) | a) >>> 0
}

// Undoes the filter of every row, in place. `step` is the bytes of a pixel (1 below 8 bits), `row` the bytes of a row.
// It indexes `raw` directly (no views), with a loop for each filter, because it runs on every byte of the picture.
function unfilter(raw: Uint8Array, height: number, row: number, step: number): void {
  const stride = row + 1

  for (let y = 0; y < height; y += 1) {
    const kind = raw[y * stride]!
    // The first byte of this row, and past the end of it. The row above the first row is all zeros.
    const start = y * stride + 1
    const end = start + row
    const split = Math.min(end, start + step)

    if (kind === 0) {
      continue
    }

    if (kind === 1) {
      for (let i = start + step; i < end; i += 1) {
        raw[i] = raw[i]! + raw[i - step]!
      }
    } else if (kind === 2) {
      if (y > 0) {
        for (let i = start; i < end; i += 1) {
          raw[i] = raw[i]! + raw[i - stride]!
        }
      }
    } else if (kind === 3) {
      if (y > 0) {
        for (let i = start; i < split; i += 1) {
          raw[i] = raw[i]! + (raw[i - stride]! >> 1)
        }

        for (let i = split; i < end; i += 1) {
          raw[i] = raw[i]! + ((raw[i - step]! + raw[i - stride]!) >> 1)
        }
      } else {
        for (let i = start + step; i < end; i += 1) {
          raw[i] = raw[i]! + (raw[i - step]! >> 1)
        }
      }
    } else if (kind === 4) {
      if (y > 0) {
        // With nothing to the left, the Paeth predictor is the byte above.
        for (let i = start; i < split; i += 1) {
          raw[i] = raw[i]! + raw[i - stride]!
        }

        for (let i = split; i < end; i += 1) {
          const a = raw[i - step]!
          const b = raw[i - stride]!
          const c = raw[i - stride - step]!
          const p = a + b - c
          let pa = p - a
          let pb = p - b
          let pc = p - c

          if (pa < 0) pa = -pa
          if (pb < 0) pb = -pb
          if (pc < 0) pc = -pc

          raw[i] = raw[i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
        }
      } else {
        // With nothing above, it is the byte to the left.
        for (let i = start + step; i < end; i += 1) {
          raw[i] = raw[i]! + raw[i - step]!
        }
      }
    } else {
      fail('The PNG data is wrong.')
    }

  }
}

// The row reader of a decoded PNG: `raw` is the unfiltered data with the filter byte in front of each row.
function pngRaster(png: Png, raw: Uint8Array, row: number): Raster {
  const { width, height, depth, type, palette, alpha } = png
  const stride = row + 1
  const high = depth === 16 ? 2 : 1
  const channels = CHANNELS[type]!
  const max = (1 << Math.min(depth, 8)) - 1
  // A sample of the row at `at`: below 8 bits it is packed, at 16 bits the high byte counts.
  const sample = (at: number, index: number): number => {
    if (depth >= 8) {
      return raw[at + index * high]!
    }

    const bit = index * depth

    return (raw[at + (bit >> 3)]! >> (8 - depth - (bit & 7))) & max
  }
  // The colour a PNG says is clear, for the types that have no alpha channel.
  const key =
    alpha !== undefined && type === 0 && alpha.length >= 2
      ? [(alpha[0]! << 8) | alpha[1]!]
      : alpha !== undefined && type === 2 && alpha.length >= 6
      ? [(alpha[0]! << 8) | alpha[1]!, (alpha[2]! << 8) | alpha[3]!, (alpha[4]! << 8) | alpha[5]!]
      : undefined

  const readRow = (y: number, out: Uint8Array): void => {
    const at = y * stride + 1

    // The common cases first: plain bytes, 8 bits a channel.
    if (depth === 8 && key === undefined && type === 2) {
      out.set(raw.subarray(at, at + width * 3))

      return
    }

    if (depth === 8 && type === 6) {
      for (let x = 0, i = at, o = 0; x < width; x += 1, i += 4, o += 3) {
        const a = raw[i + 3]!

        if (a === 255) {
          out[o] = raw[i]!
          out[o + 1] = raw[i + 1]!
          out[o + 2] = raw[i + 2]!
        } else {
          out[o] = onWhite(raw[i]!, a)
          out[o + 1] = onWhite(raw[i + 1]!, a)
          out[o + 2] = onWhite(raw[i + 2]!, a)
        }
      }

      return
    }

    for (let x = 0, o = 0; x < width; x += 1, o += 3) {
      let r: number
      let g: number
      let b: number
      let a = 255

      if (type === 3) {
        const index = sample(at, x)
        const base = index * 3

        // An index past the palette is black.
        r = base + 2 < palette!.length ? palette![base]! : 0
        g = base + 2 < palette!.length ? palette![base + 1]! : 0
        b = base + 2 < palette!.length ? palette![base + 2]! : 0
        a = alpha !== undefined && index < alpha.length ? alpha[index]! : 255
      } else if (type === 0 || type === 4) {
        const level = sample(at, x * (channels === 2 ? 2 : 1))
        const gray = depth < 8 ? Math.round((level * 255) / max) : level

        r = g = b = gray

        if (type === 4) {
          a = sample(at, x * 2 + 1)
        } else if (key !== undefined && sampleFull(raw, at, x, depth, high) === key[0]) {
          a = 0
        }
      } else {
        r = sample(at, x * channels)
        g = sample(at, x * channels + 1)
        b = sample(at, x * channels + 2)

        if (type === 6) {
          a = sample(at, x * 4 + 3)
        } else if (
          key !== undefined &&
          sampleFull(raw, at, x * 3, depth, high) === key[0] &&
          sampleFull(raw, at, x * 3 + 1, depth, high) === key[1] &&
          sampleFull(raw, at, x * 3 + 2, depth, high) === key[2]
        ) {
          a = 0
        }
      }

      out[o] = a === 255 ? r : onWhite(r, a)
      out[o + 1] = a === 255 ? g : onWhite(g, a)
      out[o + 2] = a === 255 ? b : onWhite(b, a)
    }
  }

  return { width, height, readRow }
}

// The whole sample, for the comparison with a colour key: 16 bits at depth 16.
function sampleFull(raw: Uint8Array, at: number, index: number, depth: number, high: number): number {
  if (depth === 16) {
    return (raw[at + index * high]! << 8) | raw[at + index * high + 1]!
  }

  if (depth === 8) {
    return raw[at + index]!
  }

  const bit = index * depth

  return (raw[at + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
}

function readPng(bytes: Uint8Array, deadline: number): Raster {
  const png = parsePng(bytes)
  const channels = CHANNELS[png.type]!
  const row = Math.ceil((png.width * channels * png.depth) / 8)
  const size = (row + 1) * png.height

  if (size > MAX_RAW) {
    fail('The screenshot is too large to read here.')
  }

  // A zlib stream is 8 bytes at the least: the header, one block and the checksum.
  if (png.idat.length < 8) {
    fail('The PNG data is cut off.')
  }

  // The inflate may fill this buffer and no more: a stream that holds more stops with an error.
  const raw = new Uint8Array(size)
  let inflated: Uint8Array

  try {
    inflated = unzlibInto(png.idat, raw, deadline)
  } catch (error) {
    return fail(error instanceof Error && error.message === TOO_SLOW ? SLOW_TEXT : 'The PNG data is cut off or wrong.')
  }

  if (inflated.length !== size) {
    fail('The PNG data is cut off.')
  }

  if (adler32(raw) !== u32(png.idat, png.idat.length - 4)) {
    fail('The PNG data is wrong.')
  }

  unfilter(raw, png.height, row, Math.max(1, (channels * png.depth) >> 3))

  return pngRaster(png, raw, row)
}

// The size of a JPEG from its first frame header, so that it is checked before the decoder allocates. It
// counts the scans too: the decoder runs once over the picture for each, and a hostile file can hold thousands.
function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    fail('The screenshot is not a JPEG.')
  }

  // A scan starts with the bytes FF DA. They cannot be in the data of a scan, where every FF is followed by 00.
  let scans = 0

  for (let ff = bytes.indexOf(0xff); ff !== -1 && ff + 1 < bytes.length; ff = bytes.indexOf(0xff, ff + 1)) {
    if (bytes[ff + 1] === 0xda) {
      scans += 1

      if (scans > MAX_SCANS) {
        fail('The JPEG has too many scans.')
      }
    }
  }

  let at = 2

  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      fail('The JPEG data is wrong.')
    }

    const marker = bytes[at + 1]!

    if (marker === 0xff) {
      at += 1
      continue
    }

    const size = (bytes[at + 2]! << 8) | bytes[at + 3]!

    // The start of a frame, but not the tables (C4, C8, CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[at + 5]! << 8) | bytes[at + 6]!
      const width = (bytes[at + 7]! << 8) | bytes[at + 8]!

      checkSize(width, height)

      return { width, height }
    }

    if (marker === 0xd9 || marker === 0xda || size < 2) {
      break
    }

    at += 2 + size
  }

  return fail('The JPEG has no size.')
}

function readJpeg(bytes: Uint8Array, deadline: number): Raster {
  const { width, height } = jpegSize(bytes)

  if (Date.now() > deadline) {
    fail(SLOW_TEXT)
  }

  // The limits of the decoder keep a hostile file from filling the memory: checkSize lets in 10.2 million
  // pixels at the most (3200 x 3200), so 11 is never the one that stops it. The decoder may allocate 160 MB,
  // which is enough for 3200 x 3200 at 4:2:0, and for 2900 x 2900 at 4:4:4. A screenshot that Claude Code
  // has resized is at most 2000 pixels, so both come only from a server that sends the original.
  let image: { width: number; height: number; data: Uint8Array }

  try {
    image = decodeJpeg(bytes, {
      formatAsRGBA: true,
      tolerantDecoding: false,
      maxResolutionInMP: 11,
      maxMemoryUsageInMB: 160,
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('limit exceeded')) {
      fail('The screenshot is too large to read here.')
    }

    throw error
  }

  if (image.width !== width || image.height !== height || image.data.length !== width * height * 4) {
    fail('The JPEG data is wrong.')
  }

  const data: Uint8Array = image.data

  return {
    width,
    height,
    readRow(y, out) {
      for (let x = 0, i = y * width * 4, o = 0; x < width; x += 1, i += 4, o += 3) {
        out[o] = data[i]!
        out[o + 1] = data[i + 1]!
        out[o + 2] = data[i + 2]!
      }
    },
  }
}

// Where each source column or row goes: the first target, its weight, and the weight that spills into the
// next target. A source pixel covers one length of the source, and a target covers `scale` of them.
type Spans = { first: Int32Array; weight: Float32Array; spill: Float32Array; total: Float32Array }

function spans(source: number, target: number): Spans {
  const scale = source / target
  const first = new Int32Array(source)
  const weight = new Float32Array(source)
  const spill = new Float32Array(source)
  const total = new Float32Array(target)

  for (let i = 0; i < source; i += 1) {
    const at = Math.min(target - 1, Math.floor(i / scale))
    const edge = (at + 1) * scale
    const inside = at === target - 1 || i + 1 <= edge + 1e-9 ? 1 : Math.min(1, Math.max(0, edge - i))

    first[i] = at
    weight[i] = inside
    spill[i] = 1 - inside
    total[at] = total[at]! + inside

    if (inside < 1) {
      total[at + 1] = total[at + 1]! + (1 - inside)
    }
  }

  return { first, weight, spill, total }
}

// Shrinks a picture to `width` x `height` with an area filter: each new pixel is the mean of the source
// pixels under it, the edges by their share. The result is RGBA, for the JPEG encoder.
function shrink(source: Raster, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  const line = new Uint8Array(source.width * 3)
  const across = spans(source.width, width)
  const down = spans(source.height, height)
  // One source row, summed across into `width` targets.
  const flat = new Float32Array(width * 3)
  let acc = new Float32Array(width * 3)
  let carry = new Float32Array(width * 3)
  let current = 0

  const emit = (row: number): void => {
    const weight = down.total[row]!

    for (let x = 0, o = row * width * 4; x < width; x += 1, o += 4) {
      const scale = 1 / (across.total[x]! * weight)

      out[o] = Math.round(acc[x * 3]! * scale)
      out[o + 1] = Math.round(acc[x * 3 + 1]! * scale)
      out[o + 2] = Math.round(acc[x * 3 + 2]! * scale)
      out[o + 3] = 255
    }
  }

  for (let y = 0; y < source.height; y += 1) {
    source.readRow(y, line)
    flat.fill(0)

    for (let x = 0, i = 0; x < source.width; x += 1, i += 3) {
      const at = across.first[x]! * 3
      const w = across.weight[x]!
      const s = across.spill[x]!

      flat[at] = flat[at]! + line[i]! * w
      flat[at + 1] = flat[at + 1]! + line[i + 1]! * w
      flat[at + 2] = flat[at + 2]! + line[i + 2]! * w

      if (s > 0) {
        flat[at + 3] = flat[at + 3]! + line[i]! * s
        flat[at + 4] = flat[at + 4]! + line[i + 1]! * s
        flat[at + 5] = flat[at + 5]! + line[i + 2]! * s
      }
    }

    const row = down.first[y]!

    // The sums of the row before are done once a row of the next target begins.
    if (row !== current) {
      emit(current)
      ;[acc, carry] = [carry, acc]
      carry.fill(0)
      current = row
    }

    const w = down.weight[y]!
    const s = down.spill[y]!

    for (let i = 0; i < flat.length; i += 1) {
      acc[i] = acc[i]! + flat[i]! * w

      if (s > 0) {
        carry[i] = carry[i]! + flat[i]! * s
      }
    }
  }

  emit(current)

  return out
}

// The size of a copy that is at most `wide` wide and THUMB_HEIGHT high, the shape kept, never larger than the source.
function fit(width: number, height: number, wide: number): { width: number; height: number } {
  const scale = Math.min(1, wide / width, THUMB_HEIGHT / height)

  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function read(input: ThumbnailInput, deadline: number): Raster {
  if (input.mediaType !== 'image/png' && input.mediaType !== 'image/jpeg') {
    fail('Only a PNG or a JPEG screenshot can be shown.')
  }

  if (typeof input.base64 !== 'string' || input.base64.length > MAX_BASE64) {
    fail('The screenshot is too large to read here.')
  }

  const bytes = bytesOf(input.base64)

  return input.mediaType === 'image/png' ? readPng(bytes, deadline) : readJpeg(bytes, deadline)
}

/**
 * Returns every pixel of a screenshot as RGB bytes, or the reason there is none. The mod itself never needs
 * this much: it is for the tests, which check the PNG reader on every colour type and filter.
 */
export function readPixels(input: ThumbnailInput): { width: number; height: number; rgb: Uint8Array } | ThumbnailError {
  try {
    const source = read(input, Date.now() + TIME_LIMIT_MS)
    const rgb = new Uint8Array(source.width * source.height * 3)
    const line = new Uint8Array(source.width * 3)

    for (let y = 0; y < source.height; y += 1) {
      source.readRow(y, line)
      rgb.set(line, y * line.length)
    }

    return { width: source.width, height: source.height, rgb }
  } catch (error) {
    return { error: error instanceof ReadError ? error.message : 'The screenshot could not be read.' }
  }
}

/**
 * Returns a small JPEG copy of a screenshot, as base64 with its size, or the reason there is none. The copy
 * is at most 800 pixels wide and 2000 high, transparency is flattened onto white, and the base64 is at most
 * `budget` characters: when a JPEG is longer, the quality falls, then the width (640, 480, 360 pixels). Only a
 * PNG and a JPEG are read, and nothing over 8 MiB of base64, 3200 pixels a side or 10 million pixels. A PNG
 * whose inflate runs past `limitMs` (2 seconds), and a copy whose next step would begin after it, are refused.
 */
export function makeThumbnail(input: ThumbnailInput, budget = DEFAULT_BUDGET, limitMs = TIME_LIMIT_MS): Thumbnail | ThumbnailError {
  try {
    const deadline = Date.now() + limitMs
    const source = read(input, deadline)
    const tried = new Set<string>()

    for (const [wide, quality] of LADDER) {
      const { width, height } = fit(source.width, source.height, wide)
      const key = `${width}x${height}@${quality}`

      // A small picture has the same size at each width: it only tries the next quality.
      if (tried.has(key)) {
        continue
      }

      // A step costs about what the one before did, so when the time is up the next one is not begun.
      if (tried.size > 0 && Date.now() > deadline) {
        fail(SLOW_TEXT)
      }

      tried.add(key)

      const pixels = shrink(source, width, height)
      const jpeg = encodeJpeg({ data: pixels, width, height }, Math.round(quality * 100)).data as Uint8Array
      const jpegBase64 = base64Of(jpeg)

      if (jpegBase64.length <= budget) {
        return { jpegBase64, width, height }
      }
    }

    return { error: 'The screenshot is too detailed for a small copy.' }
  } catch (error) {
    return { error: error instanceof ReadError ? error.message : 'The screenshot could not be read.' }
  }
}
