import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Kryptering av personnummer för ROT (AES-256-GCM). Nyckeln läses direkt från
// process.env vid runtime – aldrig via runtimeConfig (Netlifys secrets-scan).
// BILLING_ENCRYPTION_KEY = 32 slumpbyte, base64 (`openssl rand -base64 32`).
//
// Format: "v1:<iv b64>:<tag b64>:<ciphertext b64>". Filen är Nitro-fri och
// testas direkt med vitest.

export class BillingError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

function key(): Buffer {
  const raw = process.env.BILLING_ENCRYPTION_KEY
  if (!raw) throw new BillingError(500, 'Kryptering av personnummer är inte konfigurerad (BILLING_ENCRYPTION_KEY saknas).')
  const k = Buffer.from(raw, 'base64')
  if (k.length !== 32) throw new BillingError(500, 'BILLING_ENCRYPTION_KEY måste vara 32 byte (base64).')
  return k
}

export function encryptPnr(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decryptPnr(enc: string): string {
  const [v, iv, tag, ct] = enc.split(':')
  if (v !== 'v1' || !iv || !tag || !ct) throw new BillingError(500, 'Okänt krypteringsformat för personnummer.')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8')
}
