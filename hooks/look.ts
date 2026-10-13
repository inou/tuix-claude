// What the pictures of the Desktop app share: the Tuix colours (Evening Light), the type of a drawing, and
// the rounding of its numbers. The app draws an Svg as an image, so a picture cannot read the theme of the pane,
// and its own colour scheme may differ from it. So these colours read on a light pane (#faf9f5) and on a dark
// one (#262624), in both schemes: a test holds each text colour to 2.8:1 on both.

// A drawing for an Svg element: the markup, what it says in words, and its size in pixels.
export type Picture = { source: string; alt: string; width: number; height: number }

// A colour for the light scheme and one for the dark scheme.
export type Tone = readonly [light: string, dark: string]

export const MUTED: Tone = ['#726a9b', '#8e86b4']
export const PEACH_TEXT: Tone = ['#b84f23', '#d06a42']
// The peach of Tuix is one colour in both schemes. It is the border of a card under the pointer too.
export const PEACH = '#f0906a'

// One decimal is enough for a drawing of a few hundred pixels.
export function round(value: number): number {
  return Math.round(value * 10) / 10
}
