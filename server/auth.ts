// 認証: Cloudflare Access が付ける JWT（ヘッダー Cf-Access-Jwt-Assertion）を検証し、ログインしている人のメールアドレスを返す

export const ACCESS_JWT_HEADER = 'Cf-Access-Jwt-Assertion'

export type AuthEnv = {
  /** Access のチーム名（<チーム名>.cloudflareaccess.com の <チーム名>） */
  ACCESS_TEAM_NAME?: string
  /** Access のアプリケーションの AUD タグ */
  ACCESS_AUD?: string
  /**
   * 手元の開発とテスト専用。設定すると JWT を検証せず、このメールアドレスの人として扱う。
   * 本番には絶対に設定しない
   */
  DEV_USER_EMAIL?: string
}

/** 認証の設定（環境変数）が足りない、または不正なときのエラー */
export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthConfigurationError'
  }
}

export type AccessVerifierOptions = {
  /** 公開鍵の取得に使う。テストで差し替える */
  fetch?: typeof fetch
  /** 今の日時。テストで差し替える */
  now?: () => Date
}

type Jwk = JsonWebKey & { kid?: string }

/** 公開鍵を取り直すまでの時間（Access は鍵を定期的に入れ替える。知らない kid が来たときも取り直す） */
const KEYS_TTL_MS = 60 * 60 * 1000

const TEAM_NAME_PATTERN = /^[a-z0-9-]+$/i

/**
 * リクエストの人のメールアドレス（小文字）を返す関数を作る。認証できなければ null。
 * 公開鍵は、作った関数の中に保存して使い回す
 */
export function createAuthenticator(options: AccessVerifierOptions = {}) {
  const fetchKeys = options.fetch ?? ((input, init) => fetch(input, init))
  const now = options.now ?? (() => new Date())
  const keyCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>()

  async function getKeys(teamName: string, refresh: boolean): Promise<Jwk[]> {
    const cached = keyCache.get(teamName)
    if (cached && !refresh && now().getTime() - cached.fetchedAt < KEYS_TTL_MS) return cached.keys
    const response = await fetchKeys(`https://${teamName}.cloudflareaccess.com/cdn-cgi/access/certs`)
    if (!response.ok) throw new Error(`Access の公開鍵を取得できません（${response.status}）`)
    const body = (await response.json()) as { keys?: unknown }
    const keys = Array.isArray(body.keys) ? (body.keys as Jwk[]) : []
    keyCache.set(teamName, { keys, fetchedAt: now().getTime() })
    return keys
  }

  async function findKey(teamName: string, kid: string): Promise<Jwk | null> {
    const key = (await getKeys(teamName, false)).find((candidate) => candidate.kid === kid)
    if (key) return key
    return (await getKeys(teamName, true)).find((candidate) => candidate.kid === kid) ?? null
  }

  return async function authenticate(request: Request, env: AuthEnv): Promise<string | null> {
    // 専用の環境変数が設定されているときだけ、認証を省く（設定されていなければ、必ず JWT を検証する）
    const devEmail = env.DEV_USER_EMAIL?.trim()
    if (devEmail) return devEmail.toLowerCase()

    const teamName = env.ACCESS_TEAM_NAME?.trim()
    const aud = env.ACCESS_AUD?.trim()
    if (!teamName || !aud) {
      throw new AuthConfigurationError('環境変数 ACCESS_TEAM_NAME と ACCESS_AUD を設定してください')
    }
    if (!TEAM_NAME_PATTERN.test(teamName)) {
      throw new AuthConfigurationError('環境変数 ACCESS_TEAM_NAME には、Access のチーム名（英数字とハイフン）を設定してください')
    }

    const token = request.headers.get(ACCESS_JWT_HEADER)
    if (!token) return null
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [encodedHeader, encodedPayload, encodedSignature] = parts

    const header = decodeJson(encodedHeader)
    const payload = decodeJson(encodedPayload)
    const signature = decodeBase64Url(encodedSignature)
    if (header === null || payload === null || signature === null) return null
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null

    const jwk = await findKey(teamName, header.kid)
    if (jwk === null) return null
    let verified: boolean
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, n: jwk.n, e: jwk.e },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      )
      verified = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        signature,
        new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
      )
    } catch {
      return null
    }
    if (!verified) return null

    const seconds = now().getTime() / 1000
    if (payload.iss !== `https://${teamName}.cloudflareaccess.com`) return null
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    if (!audiences.includes(aud)) return null
    if (typeof payload.exp !== 'number' || payload.exp <= seconds) return null
    if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > seconds)) return null
    if (typeof payload.email !== 'string' || payload.email.trim() === '') return null
    return payload.email.trim().toLowerCase()
  }
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

function decodeJson(value: string): Record<string, unknown> | null {
  const bytes = decodeBase64Url(value)
  if (bytes === null) return null
  try {
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
    return data as Record<string, unknown>
  } catch {
    return null
  }
}
