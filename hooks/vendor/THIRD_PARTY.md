# Third-party code

The mod makes a small copy of a screenshot on your computer. A mod has no image decoder, so it reads and writes the pictures with plain code. These three files are copies of small, well-known libraries. Each file keeps the licence header of its library, word for word. The comment under the header lists every change.

| File | Library | Licence | Source |
| --- | --- | --- | --- |
| `inflate.ts` | The inflate part of fflate 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| `jpeg-encoder.ts` | `lib/encoder.js` of jpeg-js 0.4.4 | BSD-3-Clause (Adobe Systems Incorporated) | https://github.com/jpeg-js/jpeg-js |
| `jpeg-decoder.ts` | `lib/decoder.js` of jpeg-js 0.4.4 | Apache-2.0 (notmasteryet) | https://github.com/jpeg-js/jpeg-js |

The package jpeg-js 0.4.4 as a whole has the BSD-3-Clause licence of Eugene Ware. Its decoder file has the Apache-2.0 notice of its author, and its encoder file has the notice of Adobe. The text of Apache-2.0 is in `Apache-2.0.txt` in this folder.

The PNG reader, the area filter and the rest of the code are in `../thumbnail.ts`. They are part of the mod.

## Changes

- `inflate.ts`: only the inflate code. The tables, `inflt` and the zlib header check are kept. The deflate, gzip, zip, streaming and worker code is left out. `inflt` stops with an error when its output would pass the end of a buffer that the caller gave, so that a hostile stream cannot be read to its end. `unzlibInto` is `unzlibSync` with the `out` option. Two more changes keep a hostile stream from costing minutes:
  - `inflt` takes a `deadline`, a time of `Date.now()`, and checks it at the head of every block. A stream still running past it stops with the error `inflate took too long` (exported as `TOO_SLOW`). Without it, a stream of many empty dynamic blocks with 15 bit tables builds two tables of 2^15 entries for each block and writes nothing, so no limit on the output stops it.
  - A dynamic block header must pass what zlib checks: at most 286 length codes and 30 distance codes, and each of the three sets of code lengths neither over-subscribed nor incomplete (a lone code of one bit may stand alone in the length and distance codes, as in zlib). This refuses what no encoder writes. It does not stop the stream above, which can be made with complete codes; the deadline does.
- `jpeg-encoder.ts`: `encode` is an ES module export and returns a `Uint8Array`. The code for Node `Buffer`, `btoa`, the window export and the DOM helper is left out, because a mod has none of them.
- `jpeg-decoder.ts`: `decode` is an ES module export and always returns a `Uint8Array`. The code for Node `Buffer`, `XMLHttpRequest` and the window export is left out.
- All three files start with `// @ts-nocheck`. They are not written in the style of this repository, and the type check of the mod does not read them.

## fflate (MIT)

MIT License

Copyright (c) 2026 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## jpeg-js (BSD-3-Clause)

Copyright (c) 2014, Eugene Ware
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. Neither the name of Eugene Ware nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY EUGENE WARE ''AS IS'' AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL EUGENE WARE BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
