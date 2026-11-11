// メールの文面の共通の部分

/** メールの件名と本文（宛先は送るときに付ける） */
export type MailTemplate = {
  subject: string
  /** 文字だけの版 */
  text: string
  /** HTML の版 */
  html: string
}

/** 段落の HTML を、簡単な HTML のメールにする */
export function htmlMail(paragraphs: string[]): string {
  return [
    '<!doctype html>',
    '<html lang="ja">',
    '<head><meta charset="utf-8"><title>meal-log</title></head>',
    '<body style="font-family: sans-serif; line-height: 1.6;">',
    ...paragraphs,
    '</body>',
    '</html>',
  ].join('\n')
}

/** HTML に埋め込む文字を、そのまま表示されるようにする */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
