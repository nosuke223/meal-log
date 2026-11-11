// 会員登録の確認のメールの文面。文字だけの版と、簡単な HTML の版
import { escapeHtml, htmlMail, type MailTemplate } from './layout'

export function verifyEmailMail({ url }: { url: string }): MailTemplate {
  return {
    subject: '【meal-log】メールアドレスの確認',
    text: [
      'meal-log に会員登録していただき、ありがとうございます。',
      '',
      '次のリンクを開いて、メールアドレスを確認してください。確認できたら、ログインできるようになります。',
      url,
      '',
      'リンクの有効期限は24時間です。リンクは1回だけ使えます。',
      '',
      'このメールに心当たりがなければ、無視してください。',
    ].join('\n'),
    html: htmlMail([
      '<p>meal-log に会員登録していただき、ありがとうございます。</p>',
      '<p>次のリンクを開いて、メールアドレスを確認してください。確認できたら、ログインできるようになります。</p>',
      `<p><a href="${escapeHtml(url)}">メールアドレスを確認する</a></p>`,
      '<p>リンクの有効期限は24時間です。リンクは1回だけ使えます。</p>',
      '<p>このメールに心当たりがなければ、無視してください。</p>',
    ]),
  }
}
