// メールを送る部品。Better Auth（server/memberAuth.ts）からは、この部品を通してだけ送る。
// 送る部分（MailTransport）は差し替えられる: 本番とプレビューは Resend の API、テストと手元の開発は偽物（メモリーにためる）

/** 送信元の表示名 */
export const MAIL_FROM_NAME = 'meal-log'

/** Resend の送信の API */
export const RESEND_API_URL = 'https://api.resend.com/emails'

export type MailEnv = {
  /** Resend の API キー（秘密の値）。リポジトリには書かない */
  RESEND_API_KEY?: string
  /** 送信元のメールアドレス（例: onboarding@resend.dev）。表示名は meal-log になる */
  MAIL_FROM?: string
  /**
   * 任意（プレビュー用）。設定されているときだけ、このアドレスにしか送らない（ほかの宛先は、送らずに記録だけ残す）。
   * 本番には設定しない
   */
  MAIL_ALLOWED_TO?: string
}

/** 送るメール（宛先と文面） */
export type MailContent = {
  to: string
  subject: string
  /** 文字だけの版 */
  text: string
  /** HTML の版 */
  html: string
}

/** 送る部分に渡すメール（送信元を付けたもの） */
export type MailMessage = MailContent & {
  /** 表示名つきの送信元（例: meal-log <onboarding@resend.dev>） */
  from: string
}

/** 送る部分。送れなければ MailSendError */
export type MailTransport = (message: MailMessage) => Promise<void>

/** メールの設定（環境変数）が足りないときのエラー */
export class MailConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MailConfigurationError'
  }
}

/** メールを送れなかったときのエラー。message に宛先や秘密の値を入れない */
export class MailSendError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MailSendError'
  }
}

/** 記録を残す関数。宛先のメールアドレスや秘密の値は渡さない */
export type MailLogger = (message: string) => void

export type MailerOptions = {
  /** 送る部分。省略すると Resend の API で送る（RESEND_API_KEY が要る） */
  transport?: MailTransport
  /** Resend の API を呼ぶのに使う。テストで差し替える */
  fetch?: typeof fetch
  /** 記録を残す。省略すると console.info */
  log?: MailLogger
}

/** 送った（sent）か、宛先が許可されていないので送らなかった（skipped）か */
export type MailResult = 'sent' | 'skipped'

export type Mailer = {
  send(content: MailContent): Promise<MailResult>
}

/**
 * メールを送る部品を作る。設定が足りなければ、送るときに MailConfigurationError にする
 * （メールを送らない API は、設定がなくても動くようにする）
 */
export function createMailer(env: MailEnv, options: MailerOptions = {}): Mailer {
  const log = options.log ?? ((message: string) => console.info(message))
  const allowed = parseAllowedTo(env.MAIL_ALLOWED_TO)

  return {
    async send(content) {
      const fromAddress = env.MAIL_FROM?.trim()
      if (!fromAddress) throw new MailConfigurationError('環境変数 MAIL_FROM を設定してください')
      let transport = options.transport
      if (transport === undefined) {
        const apiKey = env.RESEND_API_KEY?.trim()
        if (!apiKey) throw new MailConfigurationError('環境変数 RESEND_API_KEY を設定してください')
        transport = createResendTransport(apiKey, { fetch: options.fetch })
      }

      if (allowed !== null && !allowed.has(normalizeAddress(content.to))) {
        log('[meal-log-mail] 送り先が許可されていないので送らなかった（MAIL_ALLOWED_TO）')
        return 'skipped'
      }
      await transport({ ...content, from: `${MAIL_FROM_NAME} <${fromAddress}>` })
      return 'sent'
    },
  }
}

/** MAIL_ALLOWED_TO を読む。設定されていなければ null（どこにでも送る）。カンマで区切って複数書ける */
function parseAllowedTo(value: string | undefined): Set<string> | null {
  const addresses = (value ?? '')
    .split(',')
    .map(normalizeAddress)
    .filter((address) => address !== '')
  return addresses.length === 0 ? null : new Set(addresses)
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase()
}

/** Resend の API（https://api.resend.com/emails）で送る部分を作る。SDK は使わず、fetch で呼ぶ */
export function createResendTransport(apiKey: string, options: { fetch?: typeof fetch } = {}): MailTransport {
  const fetchApi = options.fetch ?? ((input, init) => fetch(input, init))
  return async function sendWithResend(message) {
    let response: Response
    try {
      response = await fetchApi(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      })
    } catch (error) {
      throw new MailSendError('メールを送れませんでした（Resend に接続できません）', { cause: error })
    }
    // 応答の本文には宛先が入ることがあるので、エラーには状態の番号だけを入れる
    if (!response.ok) throw new MailSendError(`メールを送れませんでした（Resend: ${response.status}）`)
  }
}

/** メモリーにためる偽物の送る部分（テストと手元の開発用。本番では使わない） */
export function createMemoryTransport(): MailTransport & { messages: MailMessage[] } {
  const messages: MailMessage[] = []
  const transport = async (message: MailMessage) => {
    messages.push(message)
  }
  return Object.assign(transport, { messages })
}
