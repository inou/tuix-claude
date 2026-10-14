import { describe, expect, test } from 'claude-code/testing'

import { BASE64, DEFAULT_BUDGET, MAX_BASE64, MAX_PIXELS, MAX_SIDE, TIME_LIMIT_MS, makeThumbnail, readPixels } from '../hooks/thumbnail'
import type { ThumbnailInput } from '../hooks/thumbnail'
import { TOO_SLOW, unzlibInto } from '../hooks/vendor/inflate'
import { decode } from '../hooks/vendor/jpeg-decoder'
import { encode } from '../hooks/vendor/jpeg-encoder'
import { ALPHA_PNG, PROGRESSIVE_JPEG, UI_JPEG, UI_PNG } from './fixtures/shots'
import { base64Of, bytesOf, chunk, png, u32, zlibBomb, zlibRuns, zlibStored } from './png'
import type { BombSpec, PngSpec } from './png'

const asPng = (bytes: Uint8Array): ThumbnailInput => ({ mediaType: 'image/png', base64: base64Of(bytes) })

type Thumb = { jpegBase64: string; width: number; height: number }

// The thumbnail, or a failed test with the reason it is not one.
function made(input: ThumbnailInput, budget?: number): Thumb {
  const result = makeThumbnail(input, budget)

  if ('error' in result) {
    throw new Error(`no thumbnail: ${result.error}`)
  }

  return result
}

// The pixels of a thumbnail, as the JPEG decoder of jpeg-js gives them.
function pixelsOf(thumb: Thumb): { width: number; height: number; at: (x: number, y: number) => number[] } {
  const image = decode(bytesOf(thumb.jpegBase64), { formatAsRGBA: true })

  return {
    width: image.width,
    height: image.height,
    at: (x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)],
  }
}

// Within `by` of each of the three channels.
function near(got: number[], want: number[], by: number): boolean {
  return want.every((value, index) => Math.abs(got[index]! - value) <= by)
}

// White under a colour with this alpha, as the reader flattens it.
const onWhite = (colour: number, alpha: number) => Math.floor((colour * alpha + 255 * (255 - alpha) + 127) / 255)

// The reader's answer for a spec, and the RGB the spec says, pixel by pixel.
function expected(spec: PngSpec): number[] {
  const max = 2 ** spec.depth - 1
  const to8 = (value: number) => (spec.depth === 16 ? value >> 8 : spec.depth < 8 ? Math.round((value * 255) / max) : value)
  const out: number[] = []

  for (let y = 0; y < spec.height; y += 1) {
    for (let x = 0; x < spec.width; x += 1) {
      const s = (channel: number) => spec.sample(x, y, channel)
      let colour: number[]
      let alpha = 255

      if (spec.type === 3) {
        const index = s(0)

        colour = [spec.palette![index * 3]!, spec.palette![index * 3 + 1]!, spec.palette![index * 3 + 2]!]
        alpha = spec.transparency !== undefined && index < spec.transparency.length ? spec.transparency[index]! : 255
      } else if (spec.type === 0 || spec.type === 4) {
        colour = [to8(s(0)), to8(s(0)), to8(s(0))]
        alpha = spec.type === 4 ? to8(s(1)) : 255
      } else {
        colour = [to8(s(0)), to8(s(1)), to8(s(2))]
        alpha = spec.type === 6 ? to8(s(3)) : 255
      }

      out.push(...colour.map(one => (alpha === 255 ? one : onWhite(one, alpha))))
    }
  }

  return out
}

// A value that differs from pixel to pixel and channel to channel, below 2 ** depth.
const varied = (depth: number) => (x: number, y: number, c: number) => ((x + 1) * 2579 + (y + 1) * 7919 + (c + 1) * 104729 + x * y * 31) % 2 ** depth

const FILTER_SETS = [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]
const PALETTE = Array.from({ length: 48 }, (_, i) => (i * 53 + 17) % 256)

// Reads a picture of every filter and cuts the data in one chunk and in three.
function reads(base: Omit<PngSpec, 'filters' | 'parts'>): void {
  for (const filters of FILTER_SETS) {
    for (const parts of [1, 3]) {
      const spec: PngSpec = { ...base, filters, parts }
      const read = readPixels(asPng(png(spec)))

      if ('error' in read) {
        throw new Error(`type ${spec.type} depth ${spec.depth} filters ${filters.join(',')}: ${read.error}`)
      }

      expect(read.width).toBe(spec.width)
      expect(read.height).toBe(spec.height)
      expect([...read.rgb]).toEqual(expected(spec))
    }
  }
}

describe('the PNG reader', () => {
  test('reads gray at every bit depth and every filter', () => {
    for (const depth of [1, 2, 4, 8, 16] as const) {
      reads({ width: 13, height: 11, type: 0, depth, sample: varied(depth) })
    }
  })

  test('reads RGB at 8 and 16 bits at every filter', () => {
    for (const depth of [8, 16] as const) {
      reads({ width: 13, height: 11, type: 2, depth, sample: varied(depth) })
    }
  })

  test('reads a palette at every bit depth and every filter, with and without transparency', () => {
    for (const depth of [1, 2, 4, 8] as const) {
      const size = Math.min(2 ** depth, 16)
      const palette = PALETTE.slice(0, size * 3)
      const sample = (x: number, y: number) => (x * 3 + y) % size

      reads({ width: 13, height: 11, type: 3, depth, sample, palette })
      reads({ width: 13, height: 11, type: 3, depth, sample, palette, transparency: [0, 128, 255].slice(0, size) })
    }
  })

  test('reads gray with alpha and RGB with alpha, and puts a clear pixel on white', () => {
    for (const depth of [8, 16] as const) {
      reads({ width: 13, height: 11, type: 4, depth, sample: varied(depth) })
      reads({ width: 13, height: 11, type: 6, depth, sample: varied(depth) })
    }

    // Alpha 0 is white, alpha 255 is the colour, and half is the mix.
    const clear = readPixels(asPng(png({ width: 3, height: 1, type: 6, depth: 8, sample: (x, _y, c) => [[10, 20, 30, 0], [10, 20, 30, 255], [10, 20, 30, 128]][x]![c]! })))

    expect('error' in clear ? [] : [...clear.rgb]).toEqual([255, 255, 255, 10, 20, 30, onWhite(10, 128), onWhite(20, 128), onWhite(30, 128)])
  })

  test('reads the colour a gray or RGB picture says is clear, and a palette alpha shorter than the palette', () => {
    const gray = readPixels(asPng(png({ width: 3, height: 1, type: 0, depth: 8, sample: x => [77, 78, 77][x]!, transparency: [0, 77] })))
    const rgb = readPixels(asPng(png({ width: 2, height: 1, type: 2, depth: 8, sample: (x, _y, c) => [[1, 2, 3], [1, 2, 4]][x]![c]!, transparency: [0, 1, 0, 2, 0, 3] })))

    expect('error' in gray ? [] : [...gray.rgb]).toEqual([255, 255, 255, 78, 78, 78, 255, 255, 255])
    expect('error' in rgb ? [] : [...rgb.rgb]).toEqual([255, 255, 255, 1, 2, 4])
  })

  test('reads a picture that Chromium drew, which has real deflate data', () => {
    const read = readPixels({ mediaType: 'image/png', base64: UI_PNG })

    if ('error' in read) throw new Error(read.error)

    expect([read.width, read.height]).toEqual([560, 340])

    // The page ground is #eee8dd; the band round the button is the peach of Tuix, #f0906a.
    const at = (x: number, y: number) => [...read.rgb.subarray((y * read.width + x) * 3, (y * read.width + x) * 3 + 3)]
    let peach = 0

    for (let i = 0; i < read.rgb.length; i += 3) {
      if (read.rgb[i] === 0xf0 && read.rgb[i + 1] === 0x90 && read.rgb[i + 2] === 0x6a) peach += 1
    }

    expect(at(3, 150)).toEqual([0xee, 0xe8, 0xdd])
    expect(peach).toBeGreaterThan(100)
  })

  test('puts the clear part of a picture on white', () => {
    const read = readPixels({ mediaType: 'image/png', base64: ALPHA_PNG })

    if ('error' in read) throw new Error(read.error)

    expect([read.width, read.height]).toEqual([220, 120])
    expect([...read.rgb.subarray(0, 3)]).toEqual([255, 255, 255])

    // Inside the box: peach at half strength over white.
    const middle = (60 * 220 + 40) * 3

    expect(near([...read.rgb.subarray(middle, middle + 3)], [247, 199, 181], 4)).toBe(true)
  })
})

// A picture of two flat halves, left red and right blue, made of runs, so that it is big and small at once.
const halves = (width: number, height: number): PngSpec => ({
  width,
  height,
  type: 2,
  depth: 8,
  stream: 'runs',
  sample: (x, _y, c) => (x < width / 2 ? [255, 0, 0] : [0, 0, 255])[c]!,
})

describe('the thumbnail', () => {
  test('makes a JPEG of a screenshot that is small already, with the same size', () => {
    const thumb = made({ mediaType: 'image/png', base64: UI_PNG })
    const pixels = pixelsOf(thumb)

    expect([thumb.width, thumb.height]).toEqual([560, 340])
    expect([pixels.width, pixels.height]).toEqual([560, 340])
    expect(thumb.jpegBase64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(thumb.jpegBase64.length).toBeLessThanOrEqual(92_000)
    // The page ground, to within what a JPEG changes.
    expect(near(pixels.at(3, 150), [0xee, 0xe8, 0xdd], 6)).toBe(true)
  })

  test('reads a baseline JPEG and a progressive one, and makes the same kind of thumbnail', () => {
    const baseline = made({ mediaType: 'image/jpeg', base64: UI_JPEG })
    const progressive = made({ mediaType: 'image/jpeg', base64: PROGRESSIVE_JPEG })

    expect([baseline.width, baseline.height]).toEqual([560, 340])
    expect([progressive.width, progressive.height]).toEqual([112, 68])
    expect(near(pixelsOf(baseline).at(3, 150), [0xee, 0xe8, 0xdd], 8)).toBe(true)
    expect(near(pixelsOf(progressive).at(1, 30), [0xee, 0xe8, 0xdd], 10)).toBe(true)
  })

  test('shrinks 2880 x 1800 to 800 x 500 in well under two seconds, with the colours where they were', () => {
    const input = asPng(png(halves(2880, 1800)))
    const started = Date.now()
    const thumb = made(input)
    const took = Date.now() - started
    const pixels = pixelsOf(thumb)

    expect([thumb.width, thumb.height]).toEqual([800, 500])
    expect(took).toBeLessThan(2000)
    expect(thumb.jpegBase64.length).toBeLessThanOrEqual(92_000)
    expect(near(pixels.at(200, 250), [255, 0, 0], 12)).toBe(true)
    expect(near(pixels.at(600, 250), [0, 0, 255], 12)).toBe(true)
  })

  test('averages the pixels under each new one: a thin line is a faint one, not a lost one', () => {
    // A white line one pixel wide on black. 3.6 pixels become one, so the line is 1/3.6 of 255 where it falls.
    const line = made(
      asPng(png({ width: 2880, height: 1800, type: 0, depth: 8, stream: 'runs', sample: x => (x === 1000 ? 255 : 0) })),
    )
    const pixels = pixelsOf(line)
    const column = Math.floor(1000 / 3.6)
    const level = pixels.at(column, 250)[0]!

    expect(level).toBeGreaterThan(55)
    expect(level).toBeLessThan(90)
    expect(pixels.at(column + 4, 250)[0]!).toBeLessThan(12)
  })

  test('keeps the shape, caps the height at 2000, and never makes a picture larger', () => {
    const tall = made(asPng(png({ width: 1000, height: 3200, type: 0, depth: 8, stream: 'runs', sample: () => 128 })))
    const wide = made(asPng(png({ width: 1600, height: 100, type: 0, depth: 8, stream: 'runs', sample: () => 128 })))
    const small = made(asPng(png({ width: 100, height: 50, type: 0, depth: 8, stream: 'runs', sample: () => 128 })))

    expect([tall.width, tall.height]).toEqual([625, 2000])
    expect([wide.width, wide.height]).toEqual([800, 50])
    expect([small.width, small.height]).toEqual([100, 50])
  })

  test('flattens transparency onto white', () => {
    const thumb = made({ mediaType: 'image/png', base64: ALPHA_PNG })
    const pixels = pixelsOf(thumb)

    expect(near(pixels.at(2, 2), [255, 255, 255], 3)).toBe(true)
    expect(near(pixels.at(40, 60), [247, 199, 181], 12)).toBe(true)
  })

  test('reads the largest picture it allows, 3200 x 3200', () => {
    const started = Date.now()
    const thumb = made(asPng(png({ width: 3200, height: 3200, type: 0, depth: 8, stream: 'runs', sample: () => 90 })))

    expect([thumb.width, thumb.height]).toEqual([800, 800])
    expect(Date.now() - started).toBeLessThan(TIME_LIMIT_MS + 1000)
  })

  test('has the caps of what can arrive: 3200 pixels a side, one picture of 3200 x 3200', () => {
    expect([MAX_SIDE, MAX_PIXELS]).toEqual([3200, 3200 * 3200])
  })

  test('has the base64 methods the reader uses, as one path and no fallback', () => {
    expect(typeof (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64).toBe('function')
    expect(typeof (Uint8Array.prototype as unknown as { toBase64?: unknown }).toBase64).toBe('function')
    expect(BASE64.test(base64Of(bytesOf(UI_PNG)))).toBe(true)
    expect(base64Of(bytesOf(UI_PNG))).toBe(UI_PNG)
    // The strict reading: stray bits in the last group are refused, where a lax reader would take them.
    expect(makeThumbnail({ mediaType: 'image/png', base64: `${UI_PNG}!` })).toEqual({ error: 'The screenshot is not valid base64.' })
    expect(makeThumbnail({ mediaType: 'image/png', base64: 'iVBORw0KGgp=' })).toEqual({ error: 'The screenshot is not valid base64.' })
  })

  describe('the size budget', () => {
    // Noise does not compress, so each step down the ladder makes a smaller JPEG.
    const noise = asPng(
      png({ width: 900, height: 540, type: 2, depth: 8, sample: (x, y, c) => ((x * 7919 + y * 104729 + c * 31337 + ((x * y) % 251) * 17) * 2654435761 >>> 24) & 255 }),
    )

    test('falls to a lower quality, then a lower width, as the budget falls', { timeoutMs: 60_000 }, () => {
      const sizes: Thumb[] = []
      let budget = 10_000_000

      // Each pass asks for a copy one character shorter than the last one that came.
      for (let step = 0; step < 6; step += 1) {
        const result = makeThumbnail(noise, budget)

        if ('error' in result) break

        sizes.push(result)
        budget = result.jpegBase64.length - 1
      }

      const widths = sizes.map(one => one.width)

      expect(widths).toEqual([800, 800, 640, 480, 480, 360])
      expect(sizes.map(one => one.jpegBase64.length)).toEqual([...sizes.map(one => one.jpegBase64.length)].sort((a, b) => b - a))
      expect(new Set(sizes.map(one => one.jpegBase64.length)).size).toBe(6)
    })

    test('says so when no step is small enough', { timeoutMs: 60_000 }, () => {
      expect(makeThumbnail(noise, 1_000)).toEqual({ error: 'The screenshot is too detailed for a small copy.' })
      expect(makeThumbnail({ mediaType: 'image/png', base64: UI_PNG }, 500)).toEqual({ error: 'The screenshot is too detailed for a small copy.' })
    })

    test('keeps a screenshot of 92,000 characters or less as the budget, and lets the caller change it', () => {
      const thumb = made(asPng(png(halves(2880, 1800))))
      const small = made(asPng(png(halves(2880, 1800))), thumb.jpegBase64.length)

      expect(thumb.jpegBase64.length).toBeLessThanOrEqual(92_000)
      expect(small.jpegBase64).toBe(thumb.jpegBase64)
    })
  })
})

describe('what the thumbnail refuses', () => {
  const ok = png({ width: 8, height: 8, type: 2, depth: 8, sample: () => 100 })
  const refused = (input: ThumbnailInput, budget?: number) => {
    const result = makeThumbnail(input, budget)

    if (!('error' in result)) throw new Error('a thumbnail was made')

    return result.error
  }
  const IDAT_AT = 33

  test('takes a PNG and a JPEG, and nothing else', () => {
    for (const mediaType of ['image/gif', 'image/webp', 'image/svg+xml', 'image/png; x', 'text/html', '', 'IMAGE/PNG']) {
      expect(refused({ mediaType, base64: base64Of(ok) })).toBe('Only a PNG or a JPEG screenshot can be shown.')
    }

    expect(refused({ mediaType: 'image/jpeg', base64: base64Of(ok) })).toBe('The screenshot is not a JPEG.')
    expect(refused({ mediaType: 'image/png', base64: UI_JPEG })).toBe('The screenshot is not a PNG.')
  })

  test('checks the base64 strictly', () => {
    const good = base64Of(ok)

    for (const base64 of ['', 'abc', 'abcde', good.slice(0, -1), `${good}\n`, ` ${good}`, good.replace('A', ' '), good.replace('A', '-'), good.replace('A', '_'), `${good}====`, 'AA==AAAA', '====', 'ab=c', 'data:image/png;base64,' + good]) {
      expect(refused({ mediaType: 'image/png', base64 })).toBe('The screenshot is not valid base64.')
    }
  })

  test('refuses an input of more than 8 MiB of base64 before it reads any of it', () => {
    const started = Date.now()

    expect(refused({ mediaType: 'image/png', base64: 'A'.repeat(MAX_BASE64 + 4) })).toBe('The screenshot is too large to read here.')
    expect(Date.now() - started).toBeLessThan(500)
  })

  test('refuses a header over 3200 pixels a side or 10 million pixels, before it allocates any pixels', () => {
    const started = Date.now()
    const words = 'The screenshot is larger than 3200 pixels a side or 10 million pixels.'

    const claim = (width: number, height: number) =>
      refused(asPng(png({ width: 2, height: 2, declare: { width, height }, type: 0, depth: 8, sample: () => 0 })))

    expect(claim(3201, 8)).toBe(words)
    expect(claim(8, 3201)).toBe(words)
    expect(claim(4096, 4096)).toBe(words)
    expect(claim(5000, 5000)).toBe(words)
    expect(claim(2_000_000_000, 2_000_000_000)).toBe(words)
    expect(claim(4294967295, 1)).toBe(words)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  test('refuses a header with no size, a bad type, an odd depth, and an interlaced picture', () => {
    const header = (bytes: Uint8Array, change: (data: number[]) => void) => {
      const out = Uint8Array.from(bytes)
      const data = [...out.subarray(16, 29)]

      change(data)
      out.set(data, 16)
      out.set(u32(0), 29)

      return out
    }
    const picture = (mutate: (data: number[]) => void) => refused(asPng(header(png({ width: 8, height: 8, type: 2, depth: 8, sample: () => 1 }), mutate)))

    expect(picture(data => data.splice(0, 4, 0, 0, 0, 0))).toBe('The screenshot has no size.')
    expect(picture(data => data.splice(8, 2, 8, 5))).toBe('This kind of PNG is not supported.')
    expect(picture(data => data.splice(8, 2, 4, 2))).toBe('This kind of PNG is not supported.')
    expect(picture(data => data.splice(8, 2, 16, 3))).toBe('This kind of PNG is not supported.')
    expect(refused(asPng(png({ width: 8, height: 8, type: 2, depth: 8, sample: () => 1, interlace: 1 })))).toBe('An interlaced PNG is not supported.')
  })

  test('refuses a PNG that is cut off, at any point', () => {
    const full = png({ width: 40, height: 30, type: 6, depth: 8, sample: (x, y, c) => (x + y + c) & 255 })

    for (let at = 0; at < full.length - 12; at += Math.ceil(full.length / 37)) {
      const error = refused(asPng(full.subarray(0, at)))

      expect(error.length).toBeGreaterThan(0)
    }

    // Without its end chunk a PNG is still a PNG: the data is whole.
    expect('error' in makeThumbnail(asPng(png({ width: 8, height: 8, type: 2, depth: 8, sample: () => 7, noEnd: true })))).toBe(false)
    expect(refused(asPng(full.subarray(0, IDAT_AT + 20)))).toBe('The PNG is cut off.')
  })

  test('refuses garbled image data: a changed byte, a cut stream, a wrong checksum', () => {
    const flip = (index: number) => (zlib: Uint8Array) => Uint8Array.from(zlib, (byte, i) => (i === index ? byte ^ 0x5a : byte))
    const sample = (x: number, y: number, c: number) => (x * 5 + y * 3 + c) & 255
    const base: PngSpec = { width: 40, height: 30, type: 2, depth: 8, sample, stream: 'stored' }

    // A byte in the data: the checksum catches it. A byte of the checksum: the same.
    expect(refused(asPng(png({ ...base, edit: flip(900) })))).toBe('The PNG data is wrong.')
    expect(refused(asPng(png({ ...base, edit: zlib => flip(zlib.length - 1)(zlib) })))).toBe('The PNG data is wrong.')
    // A cut stream, a stream of nothing, and a header that is not zlib's.
    expect(refused(asPng(png({ ...base, edit: zlib => zlib.subarray(0, 500) })))).toBe('The PNG data is cut off or wrong.')
    expect(refused(asPng(png({ ...base, edit: zlib => zlib.subarray(0, 6) })))).toBe('The PNG data is cut off.')
    expect(refused(asPng(png({ ...base, edit: zlib => Uint8Array.from(zlib, (byte, i) => (i === 0 ? 0x79 : byte)) })))).toBe('The PNG data is cut off or wrong.')
    // A stream with fewer bytes than the header says.
    expect(refused(asPng(png({ ...base, edit: () => zlibStored(new Uint8Array(1000)) })))).toBe('The PNG data is cut off.')
    // Noise for the whole IDAT.
    expect(refused(asPng(png({ ...base, edit: zlib => Uint8Array.from(zlib, (_, i) => (i * 131 + 7) & 255) })))).toMatch(/^The PNG data is/)
  })

  test('stops an inflate bomb at the size the header says', () => {
    // A zlib stream of a few kilobytes that inflates to 40 MB, under a header that says 100 x 100 and 10,100 bytes.
    const flat = { width: 100, height: 100, type: 0 as const, depth: 8 as const, sample: () => 0, filters: [0] }
    const runs = zlibRuns(new Uint8Array(40_000_000), [1])
    const started = Date.now()
    const error = refused(asPng(png({ ...flat, edit: () => runs })))

    expect(runs.length).toBeLessThan(400_000)
    expect(error).toBe('The PNG data is cut off or wrong.')
    expect(Date.now() - started).toBeLessThan(1500)
    // The same with stored blocks, which `inflate` copies in one piece.
    expect(refused(asPng(png({ ...flat, edit: () => zlibStored(new Uint8Array(3_000_000)), parts: 1 })))).toBe('The PNG data is cut off or wrong.')
  })

  test('Date.now exists and advances here, which the deadline of the inflate relies on', () => {
    const started = Date.now()
    let spins = 0

    // A clock that stood still would end this loop by the count, and fail the check below.
    while (Date.now() - started < 30 && spins < 50_000_000) spins += 1

    expect(typeof Date.now).toBe('function')
    expect(Date.now() - started).toBeGreaterThanOrEqual(30)
  })

  describe('a stream of empty dynamic blocks, which builds two tables of 2^15 entries for each and writes nothing', () => {
    // The picture the header says is small: the stream never fills it.
    const bombPng = (count: number, spec?: BombSpec) =>
      asPng(png({ width: 64, height: 64, type: 2, depth: 8, sample: () => 0, edit: () => zlibBomb(count, spec) }))
    const SLOW = 'The screenshot took too long to read.'

    // A short limit keeps the test fast on a slow CI runner. The blocks last far longer than the limit
    // on a fast machine too, so the stream stops at the deadline and not at its end.
    test('stops at the deadline with a clean error, soon after it, from a file of a few hundred kilobytes', () => {
      const limit = 300
      const input = bombPng(10_000)
      const started = Date.now()
      const result = makeThumbnail(input, DEFAULT_BUDGET, limit)
      const took = Date.now() - started

      // Without the deadline this is some thirty blocks a millisecond for as long as the blocks last: minutes.
      expect(input.base64.length).toBeLessThan(2_000_000)
      expect(result).toEqual({ error: SLOW })
      expect(took).toBeGreaterThanOrEqual(limit - 50)
      expect(took).toBeLessThan(limit + 1500)
      expect(TIME_LIMIT_MS).toBe(2000)
    })

    test('reads the same blocks to the end when there are few, and then finds the data missing', () => {
      const input = bombPng(50)

      expect(makeThumbnail(input)).toEqual({ error: 'The PNG data is cut off.' })
      expect(readPixels(input)).toEqual({ error: 'The PNG data is cut off.' })
    })

    test('stops a stream whose deadline has passed at the head of its first block', () => {
      const out = new Uint8Array(0)

      expect(() => unzlibInto(zlibBomb(3), out, Date.now() - 1)).toThrow(TOO_SLOW)
      expect(unzlibInto(zlibBomb(3), out, Date.now() + 60_000)).toHaveLength(0)
      // No deadline is no limit, as in fflate.
      expect(unzlibInto(zlibBomb(3), out, undefined)).toHaveLength(0)
    })

    test('refuses more length codes or distance codes than zlib allows', () => {
      const wrong = { error: 'The PNG data is cut off or wrong.' }

      // 286 and 30 are the most, and a stream of two such blocks is read to its end. 287 and 288 length codes, 31 and
      // 32 distance codes, stop at the first block, where a decoder that did not check would read the same two.
      expect(makeThumbnail(bombPng(2, { literals: 286, distances: 30 }))).toEqual({ error: 'The PNG data is cut off.' })
      expect(makeThumbnail(bombPng(2, { literals: 287 }))).toEqual(wrong)
      expect(makeThumbnail(bombPng(2, { literals: 288 }))).toEqual(wrong)
      expect(makeThumbnail(bombPng(2, { distances: 31 }))).toEqual(wrong)
      expect(makeThumbnail(bombPng(2, { distances: 32 }))).toEqual(wrong)
    })

    test('refuses a set of code lengths that is over-subscribed or incomplete', () => {
      const wrong = { error: 'The PNG data is cut off or wrong.' }

      expect(makeThumbnail(bombPng(2, { codes: 'complete' }))).toEqual({ error: 'The PNG data is cut off.' })
      expect(makeThumbnail(bombPng(2, { codes: 'over' }))).toEqual(wrong)
      expect(makeThumbnail(bombPng(2, { codes: 'incomplete' }))).toEqual(wrong)
    })

    test('still reads real deflate data: the dynamic blocks of a screenshot that Chromium drew', () => {
      const read = readPixels({ mediaType: 'image/png', base64: UI_PNG })

      expect('error' in read).toBe(false)
      expect('error' in makeThumbnail({ mediaType: 'image/png', base64: ALPHA_PNG })).toBe(false)
    })
  })

  test('refuses a picture whose raw data is over the most the mod inflates, without allocating it', () => {
    const started = Date.now()

    expect(refused(asPng(png({ width: 2, height: 2, declare: { width: 3200, height: 3200 }, type: 6, depth: 16, sample: () => 0 })))).toBe('The screenshot is too large to read here.')
    expect(Date.now() - started).toBeLessThan(1500)
  })

  test('refuses a palette picture with no palette, and a critical chunk it does not know', () => {
    const spec: PngSpec = { width: 4, height: 4, type: 3, depth: 8, sample: () => 0 }

    expect(refused(asPng(png(spec)))).toBe('The PNG has no palette.')

    const full = png({ width: 4, height: 4, type: 2, depth: 8, sample: () => 3 })
    const withChunk = (name: string) => {
      const out = new Uint8Array(full.length + 15)

      out.set(full.subarray(0, IDAT_AT), 0)
      out.set(chunk(name, [1, 2, 3]), IDAT_AT)
      out.set(full.subarray(IDAT_AT), IDAT_AT + 15)

      return asPng(out)
    }

    expect(refused(withChunk('ABCD'))).toBe('This kind of PNG is not supported.')
    // An ancillary chunk (a lower case first letter) is skipped.
    expect('error' in makeThumbnail(withChunk('abcd'))).toBe(false)
  })

  test('refuses a JPEG of a size over the limit from its header, and a JPEG that is cut off or garbled', { timeoutMs: 30_000 }, () => {
    const header = (width: number, height: number) =>
      Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9])
    const words = 'The screenshot is larger than 3200 pixels a side or 10 million pixels.'

    expect(refused({ mediaType: 'image/jpeg', base64: base64Of(header(5000, 10)) })).toBe(words)
    expect(refused({ mediaType: 'image/jpeg', base64: base64Of(header(3201, 3201)) })).toBe(words)
    expect(refused({ mediaType: 'image/jpeg', base64: base64Of(header(0, 10)) })).toBe('The screenshot has no size.')

    const jpeg = bytesOf(UI_JPEG)

    for (const at of [10, 100, 600, 3000, 9000, jpeg.length - 40]) {
      const result = makeThumbnail({ mediaType: 'image/jpeg', base64: base64Of(jpeg.subarray(0, at)) })

      expect('error' in result).toBe(true)
    }

    // A garbled JPEG gives a thumbnail or an error, and never throws or hangs.
    const started = Date.now()

    for (let i = 0; i < 40; i += 1) {
      const garbled = Uint8Array.from(jpeg, (byte, at) => (at > 700 && (at * 2654435761 + i * 40503) % 997 === 0 ? byte ^ 0xff : byte))

      expect(typeof makeThumbnail({ mediaType: 'image/jpeg', base64: base64Of(garbled) })).toBe('object')
    }

    expect(Date.now() - started).toBeLessThan(10_000)
  })

  describe('a JPEG that asks for much of the decoder', () => {
    const jpeg = bytesOf(UI_JPEG)
    // The bytes FF DA that start a scan, in the whole file.
    const scansOf = (bytes: Uint8Array) => bytes.reduce((sum, byte, at) => sum + (byte === 0xff && bytes[at + 1] === 0xda ? 1 : 0), 0)
    // The file with a comment after the start of the image, holding `extra` more pairs of FF DA. The decoder
    // skips a comment, and in a comment the pair may be, as it cannot be in the data of a scan.
    const withScans = (extra: number) => {
      const pairs = Uint8Array.from({ length: extra * 2 }, (_, i) => (i % 2 === 0 ? 0xff : 0xda))
      const size = pairs.length + 2

      return Uint8Array.from([0xff, 0xd8, 0xff, 0xfe, size >> 8, size & 255, ...pairs, ...jpeg.subarray(2)])
    }
    const asJpeg = (bytes: Uint8Array): ThumbnailInput => ({ mediaType: 'image/jpeg', base64: base64Of(bytes) })

    test('reads a JPEG of up to 64 scans and refuses one of more, before it decodes any', () => {
      expect(scansOf(jpeg)).toBe(1)
      expect(scansOf(bytesOf(PROGRESSIVE_JPEG))).toBeGreaterThan(1)
      expect(scansOf(bytesOf(PROGRESSIVE_JPEG))).toBeLessThanOrEqual(64)
      expect(scansOf(withScans(63))).toBe(64)
      expect('error' in makeThumbnail(asJpeg(withScans(63)))).toBe(false)

      const started = Date.now()

      expect(scansOf(withScans(64))).toBe(65)
      expect(makeThumbnail(asJpeg(withScans(64)))).toEqual({ error: 'The JPEG has too many scans.' })
      // A thousand scans, as a hostile file has them: a comment can hold 32,000 of them.
      expect(makeThumbnail(asJpeg(withScans(1000)))).toEqual({ error: 'The JPEG has too many scans.' })
      expect(Date.now() - started).toBeLessThan(500)
    })

    test('refuses a JPEG of 3200 x 3200 that needs more memory than the decoder may use, and reads one of 2000 x 2000', { timeoutMs: 60_000 }, () => {
      const wide = (side: number) => {
        const data = new Uint8Array(side * side * 4)

        for (let i = 0; i < side * side; i += 1) {
          data[i * 4] = ((i % side) >> 3) & 255
          data[i * 4 + 1] = (Math.floor(i / side) >> 3) & 255
          data[i * 4 + 2] = 90
          data[i * 4 + 3] = 255
        }

        return asJpeg(encode({ data, width: side, height: side }, 80).data as Uint8Array)
      }

      // The encoder writes 4:4:4, which needs the most memory: 3200 x 3200 of it is over 160 MB.
      expect(makeThumbnail(wide(3200))).toEqual({ error: 'The screenshot is too large to read here.' })
      expect(made(wide(2000)).width).toBe(800)
    })

    test('stops before a JPEG decodes, and between the steps of the ladder, when the time is up', () => {
      const side = 600
      const noise = new Uint8Array(side * side * 4)

      for (let i = 0; i < side * side * 4; i += 1) noise[i] = i % 4 === 3 ? 255 : ((i * 2654435761) >>> 24) & 255

      const input = asJpeg(encode({ data: noise, width: side, height: side }, 95).data as Uint8Array)
      const slow = { error: 'The screenshot took too long to read.' }

      // Noise does not compress: 1,000 characters is not enough for any of the six steps.
      expect(makeThumbnail(input, 1_000)).toEqual({ error: 'The screenshot is too detailed for a small copy.' })
      // A deadline in the past: it has passed before the decode begins.
      expect(makeThumbnail(input, 1_000, -1)).toEqual(slow)
      expect(makeThumbnail(input, DEFAULT_BUDGET, -1)).toEqual(slow)
      // A deadline of 3 ms: the decode and the first step take longer, so the second step is not begun.
      expect(makeThumbnail(input, 1_000, 3)).toEqual(slow)
      // The same limit does not stop a copy that is made at the first step.
      expect('error' in makeThumbnail(input, 10_000_000, 60_000)).toBe(false)
    })
  })

  test('never throws, whatever the bytes are', () => {
    for (const bytes of [new Uint8Array(0), new Uint8Array(40), Uint8Array.from({ length: 300 }, (_, i) => (i * 37) & 255), zlibStored(new Uint8Array(100))]) {
      for (const mediaType of ['image/png', 'image/jpeg']) {
        expect(typeof makeThumbnail({ mediaType, base64: base64Of(bytes) })).toBe('object')
      }
    }

    expect(typeof makeThumbnail({ mediaType: 'image/png', base64: 5 as unknown as string })).toBe('object')
  })
})
