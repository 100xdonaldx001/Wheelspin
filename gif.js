/*
 * Tiny dependency-free animated GIF encoder.
 * - Fixed 256-color global palette
 * - LZW compression
 * - Works from file:// (no web workers, no CDN)
 */
(function (global) {
  'use strict';

  // ---------- Palette / quantization ----------

  function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  }

  /**
   * Builds a 256 color palette: the exact "key" colors first (wheel segments,
   * text, background...), some blends of them for smoother anti-aliasing,
   * then a 6x6x6 color cube as a fallback for everything else.
   */
  function buildPalette(keyHexColors) {
    const pal = [];
    const seen = new Set();
    const add = (c) => {
      const k = (c[0] << 16) | (c[1] << 8) | c[2];
      if (!seen.has(k) && pal.length < 256) {
        seen.add(k);
        pal.push(c);
      }
    };
    const keys = keyHexColors.map(hexToRgb);
    const KEY_BUDGET = 40;
    keys.slice(0, KEY_BUDGET).forEach(add);

    // Blends of every key color with every other key color (anti-aliased edges).
    const blends = [];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) blends.push(mix(keys[i], keys[j], 0.5));
    }
    for (const b of blends) {
      if (pal.length >= KEY_BUDGET) break;
      add(b);
    }

    for (let r = 0; r < 6; r++)
      for (let g = 0; g < 6; g++)
        for (let b = 0; b < 6; b++) add([r * 51, g * 51, b * 51]);

    // A few grays to fill any leftover slots.
    for (let v = 8; pal.length < 256 && v < 256; v += 8) add([v, v, v]);
    while (pal.length < 256) pal.push([0, 0, 0]);
    return pal;
  }

  /** Maps RGBA pixel data to palette indices (cached by 15-bit color). */
  function createQuantizer(palette) {
    const cache = new Int16Array(32768).fill(-1);
    const pr = palette.map((c) => c[0]);
    const pg = palette.map((c) => c[1]);
    const pb = palette.map((c) => c[2]);

    function nearest(r, g, b) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < 256; i++) {
        const dr = r - pr[i], dg = g - pg[i], db = b - pb[i];
        const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (d < bestD) {
          bestD = d;
          best = i;
          if (d === 0) break;
        }
      }
      return best;
    }

    return function quantize(rgba, out) {
      const n = rgba.length >> 2;
      out = out || new Uint8Array(n);
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        let idx = cache[key];
        if (idx < 0) {
          idx = nearest((r & 0xf8) | 4, (g & 0xf8) | 4, (b & 0xf8) | 4);
          cache[key] = idx;
        }
        out[i] = idx;
      }
      return out;
    };
  }

  // ---------- LZW ----------

  const TABLE_SIZE = 4096 * 256;
  const lzwCodes = new Int32Array(TABLE_SIZE);
  const lzwStamp = new Int32Array(TABLE_SIZE);
  let lzwGen = 0;

  function lzwEncode(indices, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;
    lzwGen++;

    const raw = new Uint8Array(indices.length * 2 + 64);
    let pos = 0;
    let cur = 0;
    let bits = 0;
    const emit = (code) => {
      cur |= code << bits;
      bits += codeSize;
      while (bits >= 8) {
        raw[pos++] = cur & 255;
        cur >>>= 8;
        bits -= 8;
      }
    };

    emit(clearCode);
    let code = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (code << 8) | k;
      if (lzwStamp[key] === lzwGen) {
        code = lzwCodes[key];
        continue;
      }
      emit(code);
      if (nextCode === 4096) {
        emit(clearCode);
        nextCode = eoiCode + 1;
        codeSize = minCodeSize + 1;
        lzwGen++;
      } else {
        if (nextCode >= 1 << codeSize) codeSize++;
        lzwCodes[key] = nextCode++;
        lzwStamp[key] = lzwGen;
      }
      code = k;
    }
    emit(code);
    emit(eoiCode);
    if (bits > 0) raw[pos++] = cur & 255;

    // Split into sub-blocks of max 255 bytes, prefixed by min code size.
    const out = new Uint8Array(1 + pos + Math.ceil(pos / 255) + 1);
    let o = 0;
    out[o++] = minCodeSize;
    for (let i = 0; i < pos; i += 255) {
      const len = Math.min(255, pos - i);
      out[o++] = len;
      out.set(raw.subarray(i, i + len), o);
      o += len;
    }
    out[o++] = 0; // block terminator
    return out.subarray(0, o);
  }

  // ---------- Writer ----------

  class GifWriter {
    /**
     * @param {number} width
     * @param {number} height
     * @param {number[][]} palette 256 [r,g,b] entries
     * @param {boolean} loop loop forever (true) or play once (false)
     */
    constructor(width, height, palette, loop) {
      this.w = width;
      this.h = height;
      this.parts = [];
      const b = [];
      for (const ch of 'GIF89a') b.push(ch.charCodeAt(0));
      b.push(width & 255, width >> 8, height & 255, height >> 8);
      b.push(0xf7, 0, 0); // global color table, 256 colors
      for (const c of palette) b.push(c[0], c[1], c[2]);
      if (loop) {
        b.push(0x21, 0xff, 0x0b);
        for (const ch of 'NETSCAPE2.0') b.push(ch.charCodeAt(0));
        b.push(3, 1, 0, 0, 0); // loop count 0 = infinite
      }
      this.parts.push(new Uint8Array(b));
    }

    /** @param {Uint8Array} indices palette index per pixel; @param {number} delay in 1/100 s */
    addFrame(indices, delay) {
      const { w, h } = this;
      this.parts.push(
        new Uint8Array([
          0x21, 0xf9, 4, 0x04, delay & 255, (delay >> 8) & 255, 0, 0, // graphic control ext.
          0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0, // image descriptor
        ])
      );
      this.parts.push(lzwEncode(indices, 8));
    }

    finish() {
      this.parts.push(new Uint8Array([0x3b]));
      return new Blob(this.parts, { type: 'image/gif' });
    }
  }

  global.GifEncoder = { GifWriter, buildPalette, createQuantizer, lzwEncode, hexToRgb };
})(typeof window !== 'undefined' ? window : globalThis);
