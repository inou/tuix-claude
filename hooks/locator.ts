import type { TuixBox, TuixPoint, TuixSize } from '../types'

// A report gives numbers only: no string of a report reaches this drawing.

export type Locator = { source: string; alt: string; width: number; height: number }

export type LocatorInput = { box: TuixBox | null; viewport: TuixSize | null; scroll: TuixPoint | null }

export const LOCATOR_ALT = 'Where the reported element was in the browser window'

const WIDTH = 240
const PAD = 8
// The room for the window: the width left of the scroll bar, and the height.
const ROOM_WIDTH = 212
const ROOM_HEIGHT = 168
const BAR_WIDTH = 6
// No page is larger than this; the cap keeps a wild number from making a huge drawing.
const LIMIT = 1_000_000

function finite(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= LIMIT
}

// One decimal is enough for a drawing of 240 pixels.
function round(value: number): number {
  return Math.round(value * 10) / 10
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

type Drawable = { box: TuixBox; viewport: TuixSize; scroll: TuixPoint }

// The input with every part present and every number fit to draw, or undefined.
function drawable(input: LocatorInput): Drawable | undefined {
  const { box, viewport } = input
  const scroll = input.scroll ?? { x: 0, y: 0 }

  if (box === null || viewport === null) {
    return undefined
  }

  const numbers = [box.x, box.y, box.width, box.height, viewport.width, viewport.height, scroll.x, scroll.y]
  const isFit = numbers.every(finite) && viewport.width > 0 && viewport.height > 0 && box.width >= 0 && box.height >= 0

  return isFit ? { box, viewport, scroll } : undefined
}

function fmt(value: number): string {
  return String(Math.round(value))
}

/**
 * Returns one line with the numbers of the locator: the window, the scroll
 * offset and the box of the element as the window shows it. The terminal pane
 * draws it in place of the picture. It is undefined when a number is missing.
 */
export function locatorText(input: LocatorInput): string | undefined {
  const shape = drawable(input)

  if (shape === undefined) {
    return undefined
  }

  const { box, viewport, scroll } = shape
  const left = box.x - scroll.x
  const top = box.y - scroll.y
  const isInside = left < viewport.width && left + box.width > 0 && top < viewport.height && top + box.height > 0

  return [
    `Window ${fmt(viewport.width)} x ${fmt(viewport.height)}.`,
    `Scrolled ${fmt(scroll.x)}, ${fmt(scroll.y)}.`,
    `Element ${fmt(box.width)} x ${fmt(box.height)} at ${fmt(left)}, ${fmt(top)} in the window${isInside ? '.' : ' (outside the window).'}`,
  ].join(' ')
}

/**
 * Returns a vector picture, 240 pixels wide, of where the element was: the
 * window as a rectangle, the element box minus the scroll offset, a dot at its
 * centre and a bar for the scroll position. It holds no text, so it holds no
 * string of a report. It is undefined when the box or the window is missing.
 */
export function locatorSvg(input: LocatorInput): Locator | undefined {
  const shape = drawable(input)

  if (shape === undefined) {
    return undefined
  }

  const { box, viewport, scroll } = shape
  const scale = Math.min(ROOM_WIDTH / viewport.width, ROOM_HEIGHT / viewport.height)
  const width = viewport.width * scale
  const height = viewport.height * scale
  const left = PAD + (ROOM_WIDTH - width) / 2
  const total = round(height + PAD * 2)

  // The box in window coordinates, and the part of it the window shows.
  const x0 = box.x - scroll.x
  const y0 = box.y - scroll.y
  const x1 = Math.max(x0, 0)
  const y1 = Math.max(y0, 0)
  const x2 = Math.min(x0 + box.width, viewport.width)
  const y2 = Math.min(y0 + box.height, viewport.height)
  const isShown = x2 > x1 && y2 > y1
  const centreX = isShown ? (x1 + x2) / 2 : clamp(x0 + box.width / 2, 0, viewport.width)
  const centreY = isShown ? (y1 + y2) / 2 : clamp(y0 + box.height / 2, 0, viewport.height)

  // The least document height we know: the window at the scroll offset, and the element.
  const known = Math.max(viewport.height + Math.max(scroll.y, 0), box.y + box.height)
  const track = height
  const thumb = Math.max(8, Math.min(track, (track * viewport.height) / known))
  const range = known - viewport.height
  const thumbTop = PAD + (range > 0 ? (track - thumb) * clamp(scroll.y / range, 0, 1) : 0)
  const barLeft = WIDTH - PAD - BAR_WIDTH

  const shapes = [
    `<rect x="${round(left)}" y="${PAD}" width="${round(width)}" height="${round(height)}" rx="2" fill="#94a3b8" fill-opacity="0.12" stroke="#94a3b8"/>`,
    isShown
      ? `<rect x="${round(left + x1 * scale)}" y="${round(PAD + y1 * scale)}" width="${round(Math.max(3, (x2 - x1) * scale))}" height="${round(Math.max(3, (y2 - y1) * scale))}" fill="#dc2626" fill-opacity="0.28" stroke="#dc2626"/>`
      : '',
    `<circle cx="${round(left + centreX * scale)}" cy="${round(PAD + centreY * scale)}" r="3.5" fill="${isShown ? '#dc2626' : 'none'}" stroke="#dc2626" stroke-width="1.5"/>`,
    `<rect x="${barLeft}" y="${PAD}" width="${BAR_WIDTH}" height="${round(track)}" rx="3" fill="#94a3b8" fill-opacity="0.3"/>`,
    `<rect x="${barLeft}" y="${round(thumbTop)}" width="${BAR_WIDTH}" height="${round(thumb)}" rx="3" fill="#64748b"/>`,
  ]
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${total}" viewBox="0 0 ${WIDTH} ${total}">` +
    `${shapes.join('')}</svg>`

  return { source, alt: LOCATOR_ALT, width: WIDTH, height: total }
}
