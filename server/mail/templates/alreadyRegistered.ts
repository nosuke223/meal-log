// すでに登録されているメールアドレスで、会員登録しようとしたときのメールの文面。文字だけの版と、簡単な HTML の版
import { escapeHtml, htmlMail, type MailTemplate } from './layout'

export function alreadyRegisteredMail({ loginUrl }: { loginUrl: string }): MailTemplate {
  return {
    subject: '【meal-log】このメールアドレスはすでに登録されています',
    text: [
      'このメールアドレスで、meal-log に会員登録しようとする操作がありました。',
      '',
      'このメールアドレスは、すでに登録されています。ログインするか、パスワードを再設定してください。',
      loginUrl,
      '',
      'このメールに心当たりがなければ、無視してください。',
    ].join('\n'),
    html: htmlMail([
      '<p>このメールアドレスで、meal-log に会員登録しようとする操作がありました。</p>',
      '<p>このメールアドレスは、すでに登録されています。ログインするか、パスワードを再設定してください。</p>',
      `<p><a href="${escapeHtml(loginUrl)}">ログインの画面を開く</a></p>`,
      '<p>このメールに心当たりがなければ、無視してください。</p>',
    ]),
  }
}
