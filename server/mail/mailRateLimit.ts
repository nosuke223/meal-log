// メールを送る回数の上限。同じ宛先のアドレスと同じ接続元（IP アドレス）の組み合わせごとに、window 秒の間に max 回まで。
// 数えた値は、ログインの試す回数と同じ D1 の表 rateLimit に、key を "mail:" で始めて保存する
// （宛先のアドレスは、そのままでは保存せず、SHA-256 のハッシュにする）

import type { D1Database } from '../d1'

export const MAIL_RATE_LIMIT = { window: 600, max: 3 } as const

const KEY_PREFIX = 'mail:'

export type MailRateLimitResult = { allowed: true } | { allowed: false; retryAfter: number }

/**
 * 1回数えて、上限の内かを返す。上限を超えたときは、待つ秒数を返す。
 * 区切りの始まりの時刻を lastRequest に入れ、window 秒たったら数え直す
 */
export async function consumeMailRateLimit(
  db: D1Database,
  ip: string,
  address: string,
  now: number = Date.now(),
): Promise<MailRateLimitResult> {
  const key = `${KEY_PREFIX}${ip}:${await sha256Hex(address.trim().toLowerCase())}`
  const windowMs = MAIL_RATE_LIMIT.window * 1000
  const row = await db
    .prepare(
      `INSERT INTO "rateLimit" ("id", "key", "count", "lastRequest") VALUES (?1, ?2, 1, ?3)
       ON CONFLICT ("key") DO UPDATE SET
         "count" = CASE WHEN ?3 - "lastRequest" >= ?4 THEN 1 ELSE "count" + 1 END,
         "lastRequest" = CASE WHEN ?3 - "lastRequest" >= ?4 THEN ?3 ELSE "lastRequest" END
       RETURNING "count", "lastRequest"`,
    )
    .bind(crypto.randomUUID(), key, now, windowMs)
    .first<{ count: number; lastRequest: number }>()
  if (row === null || row.count <= MAIL_RATE_LIMIT.max) return { allowed: true }
  const retryAfter = Math.max(1, Math.ceil((Number(row.lastRequest) + windowMs - now) / 1000))
  return { allowed: false, retryAfter }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
