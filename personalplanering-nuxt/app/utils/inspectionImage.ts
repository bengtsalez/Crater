// Förbereder ett foto för uppladdning: avkodar med EXIF-orientering
// tillämpad, skalar ner till högst MAX_EDGE px och kodar om som JPEG. Det ger
// korrekt stående/liggande bild överallt (även i PDF), tar bort EXIF-data
// (t.ex. GPS) och håller filen liten för mobilnät.

import { IMAGE_TYPES, MAX_IMAGE_BYTES } from '../../shared/inspections'

const MAX_EDGE = 2400
const QUALITY = 0.85

export class ImagePrepError extends Error {}

export async function prepareImageForUpload(file: File): Promise<Blob> {
  const declared = file.type.toLowerCase()
  if (declared && !declared.startsWith('image/')) {
    throw new ImagePrepError('Filen är inte en bild. Använd JPEG, PNG eller WebP.')
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // T.ex. HEIC i en webbläsare som inte kan avkoda formatet.
    throw new ImagePrepError('Bildformatet stöds inte. Använd JPEG, PNG eller WebP (ändra ev. kamerainställningen till "Mest kompatibel").')
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ImagePrepError('Kunde inte behandla bilden i webbläsaren.')
  ctx.fillStyle = '#fff' // transparens → vit bakgrund i JPEG
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
  if (blob && blob.size <= MAX_IMAGE_BYTES) return blob
  // Fallback: originalet om det redan är ett tillåtet format och tillräckligt litet.
  if ((IMAGE_TYPES as readonly string[]).includes(declared) && file.size <= MAX_IMAGE_BYTES) return file
  throw new ImagePrepError(`Bilden är för stor (högst ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB).`)
}
