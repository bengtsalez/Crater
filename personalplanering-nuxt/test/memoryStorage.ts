import type { InspectionStorage } from '../server/utils/inspectionStorage'

// Lagring i minnet – ENDAST för tester. "Uppladdning" simuleras med put().
export function memoryStorage(): InspectionStorage & { objects: Map<string, Uint8Array>; put: (key: string, b: Uint8Array) => void } {
  const objects = new Map<string, Uint8Array>()
  return {
    configured: true,
    objects,
    put: (key, b) => void objects.set(key, b),
    presignPut: async (key) => `https://mem.test/${encodeURIComponent(key)}?sig=put`,
    presignGet: async (key) => `https://mem.test/${encodeURIComponent(key)}?sig=get`,
    head: async (key) => (objects.has(key) ? { size: objects.get(key)!.length } : null),
    getBytes: async (key, range) => {
      const b = objects.get(key)
      if (!b) return null
      return range ? b.slice(range[0], range[1] + 1) : b
    },
    remove: async (key) => void objects.delete(key),
  }
}

/** Minimal giltig JPEG-header (SOI + APP1/EXIF-orientering + SOF0 med mått). */
export function fakeJpeg(width: number, height: number, orientation = 1): Uint8Array {
  const exif = [
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF big-endian, IFD @8
    0x00, 0x01, // 1 post
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]
  const app1 = [0xff, 0xe1, ((exif.length + 2) >> 8) & 0xff, (exif.length + 2) & 0xff, ...exif]
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
  return new Uint8Array([0xff, 0xd8, ...app1, ...sof, 0xff, 0xd9])
}
