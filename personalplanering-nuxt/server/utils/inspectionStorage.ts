// Privat, beständig objektlagring för bilder i egenkontroller (S3-kompatibel:
// Cloudflare R2, AWS S3, MinIO …). Netlify Functions har bara tillfälligt
// filsystem, så lokalt filsystem används aldrig för beständig lagring.
//
// Konfiguration (läses från process.env vid runtime – aldrig runtimeConfig,
// annars hamnar hemligheterna i bunten och Netlifys secrets-scan stoppar bygget):
//   INSPECTION_S3_ENDPOINT           t.ex. https://<konto>.r2.cloudflarestorage.com
//   INSPECTION_S3_BUCKET             privat bucket
//   INSPECTION_S3_ACCESS_KEY_ID
//   INSPECTION_S3_SECRET_ACCESS_KEY
//   INSPECTION_S3_REGION             valfri (standard "auto" – R2; AWS: t.ex. eu-north-1)
//   INSPECTION_S3_FORCE_PATH_STYLE   valfri, "false" = virtual-hosted-style (standard path-style)
//
// Klienten laddar upp direkt till lagringen med en kortlivad signerad PUT-URL
// och hämtar via kortlivad signerad GET-URL – servern delar bara ut dem efter
// behörighetskontroll. Se docs/inspections.md.

import { AwsClient } from 'aws4fetch'

export interface InspectionStorage {
  configured: boolean
  presignPut(key: string, contentType: string, expiresSec: number): Promise<string>
  presignGet(key: string, expiresSec: number): Promise<string>
  head(key: string): Promise<{ size: number } | null>
  /** Hela objektet, eller [start, end] (inklusive) om `range` anges. null = saknas. */
  getBytes(key: string, range?: [number, number]): Promise<Uint8Array | null>
  remove(key: string): Promise<void>
}

export const unconfiguredStorage: InspectionStorage = {
  configured: false,
  presignPut: () => Promise.reject(new Error('Bildlagring är inte konfigurerad.')),
  presignGet: () => Promise.reject(new Error('Bildlagring är inte konfigurerad.')),
  head: () => Promise.resolve(null),
  getBytes: () => Promise.resolve(null),
  remove: () => Promise.resolve(),
}

export function s3Storage(env: Record<string, string | undefined> = process.env): InspectionStorage {
  const endpoint = env.INSPECTION_S3_ENDPOINT?.replace(/\/+$/, '')
  const bucket = env.INSPECTION_S3_BUCKET
  const accessKeyId = env.INSPECTION_S3_ACCESS_KEY_ID
  const secretAccessKey = env.INSPECTION_S3_SECRET_ACCESS_KEY
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return unconfiguredStorage
  const region = env.INSPECTION_S3_REGION || 'auto'
  const pathStyle = env.INSPECTION_S3_FORCE_PATH_STYLE !== 'false'
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region })

  const objectUrl = (key: string) => {
    const k = key.split('/').map(encodeURIComponent).join('/')
    if (pathStyle) return `${endpoint}/${encodeURIComponent(bucket)}/${k}`
    const u = new URL(endpoint)
    return `${u.protocol}//${bucket}.${u.host}/${k}`
  }
  const presign = async (key: string, method: string, expiresSec: number, headers: Record<string, string> = {}) => {
    const url = new URL(objectUrl(key))
    url.searchParams.set('X-Amz-Expires', String(expiresSec))
    const signed = await client.sign(url.toString(), { method, headers, aws: { signQuery: true, allHeaders: true } })
    return signed.url
  }

  return {
    configured: true,
    presignPut: (key, contentType, expiresSec) => presign(key, 'PUT', expiresSec, { 'Content-Type': contentType }),
    presignGet: (key, expiresSec) => presign(key, 'GET', expiresSec),
    async head(key) {
      const r = await client.fetch(objectUrl(key), { method: 'HEAD' })
      if (r.status === 404) return null
      if (!r.ok) throw new Error(`Lagringen svarade ${r.status} på HEAD.`)
      return { size: Number(r.headers.get('content-length') ?? 0) }
    },
    async getBytes(key, range) {
      const headers: Record<string, string> = range ? { Range: `bytes=${range[0]}-${range[1]}` } : {}
      const r = await client.fetch(objectUrl(key), { method: 'GET', headers })
      if (r.status === 404) return null
      if (!r.ok) throw new Error(`Lagringen svarade ${r.status} på GET.`)
      return new Uint8Array(await r.arrayBuffer())
    },
    async remove(key) {
      const r = await client.fetch(objectUrl(key), { method: 'DELETE' })
      if (!r.ok && r.status !== 404) throw new Error(`Lagringen svarade ${r.status} på DELETE.`)
    },
  }
}
