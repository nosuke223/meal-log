// パスワード再設定のメールの文面。文字だけの版と、簡単な HTML の版
import { escapeHtml, htmlMail, type MailTemplate } from './layout'

export function resetPasswordMail({ url }: { url: string }): MailTemplate {
  return {
    subject: '【meal-log】パスワードの再設定',
    text: [
      'meal-log のパスワードの再設定を受け付けました。',
      '',
      '次のリンクを開いて、新しいパスワードを決めてください。',
      url,
      '',
      'リンクの有効期限は1時間です。リンクは1回だけ使えます。',
      '',
      'このメールに心当たりがなければ、無視してください。パスワードは変わりません。',
    ].join('\n'),
    html: htmlMail([
      '<p>meal-log のパスワードの再設定を受け付けました。</p>',
      '<p>次のリンクを開いて、新しいパスワードを決めてください。</p>',
      `<p><a href="${escapeHtml(url)}">新しいパスワードを決める</a></p>`,
      '<p>リンクの有効期限は1時間です。リンクは1回だけ使えます。</p>',
      '<p>このメールに心当たりがなければ、無視してください。パスワードは変わりません。</p>',
    ]),
  }
}
