// Identifierar faktisk bildtyp ur filens första byte (magiska tal) och läser
// bredd/höjd samt EXIF-orientering (JPEG). Klientens angivna Content-Type
// används aldrig som sanning. Nitro-fri.

import type { ImageType } from '../../shared/inspections'

export interface ImageInfo {
  type: ImageType
  width: number | null
  height: number | null
  /** EXIF-orientering 1–8 (bara JPEG), null om okänd. */
  orientation: number | null
}

/** Så många byte behövs normalt för att nå JPEG:s SOF-segment (EXIF kan vara stort). */
export const SNIFF_BYTES = 256 * 1024

const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!
const u16le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8)
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)

function readExifOrientation(b: Uint8Array, start: number, end: number): number | null {
  // "Exif\0\0" + TIFF-huvud
  if (end - start < 14) return null
  if (b[start] !== 0x45 || b[start + 1] !== 0x78 || b[start + 2] !== 0x69 || b[start + 3] !== 0x66) return null
  const t = start + 6
  const le = b[t] === 0x49 && b[t + 1] === 0x49
  const rd16 = (o: number) => (le ? u16le(b, o) : u16be(b, o))
  const rd32 = (o: number) => (le ? (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0 : u32be(b, o))
  const ifd = t + rd32(t + 4)
  if (ifd + 2 > end) return null
  const n = rd16(ifd)
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12
    if (e + 12 > end) return null
    if (rd16(e) === 0x0112) {
      const v = rd16(e + 8)
      return v >= 1 && v <= 8 ? v : null
    }
  }
  return null
}

function sniffJpeg(b: Uint8Array): ImageInfo {
  let o = 2
  let orientation: number | null = null
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) break
    const marker = b[o + 1]!
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += 2
      continue
    }
    const len = u16be(b, o + 2)
    if (marker === 0xe1 && orientation === null) orientation = readExifOrientation(b, o + 4, Math.min(b.length, o + 2 + len))
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof && o + 9 <= b.length) {
      return { type: 'image/jpeg', height: u16be(b, o + 5), width: u16be(b, o + 7), orientation }
    }
    if (marker === 0xda) break
    o += 2 + len
  }
  return { type: 'image/jpeg', width: null, height: null, orientation }
}

function sniffWebp(b: Uint8Array): ImageInfo {
  const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!)
  if (chunk === 'VP8X' && b.length >= 30) return { type: 'image/webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1, orientation: null }
  if (chunk === 'VP8 ' && b.length >= 30) {
    return { type: 'image/webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, orientation: null }
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)
    return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, orientation: null }
  }
  return { type: 'image/webp', width: null, height: null, orientation: null }
}

export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  const b = bytes
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return sniffJpeg(b)
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { type: 'image/png', width: u32be(b, 16), height: u32be(b, 20), orientation: null }
  }
  if (
    b.length >= 16 &&
    String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === 'RIFF' &&
    String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === 'WEBP'
  ) {
    return sniffWebp(b)
  }
  return null
}
