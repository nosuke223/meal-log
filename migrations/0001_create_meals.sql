-- 食事の記録（1行が1品）。ログインしている人（Cloudflare Access のメールアドレス）ごとに分けて保存する
-- 値の検査は API（src/meals/mealRecord.ts の検査）で行う
CREATE TABLE meals (
  -- Cloudflare Access が渡すメールアドレス（小文字にそろえる）
  user_email TEXT NOT NULL,
  id TEXT NOT NULL,
  -- YYYY-MM-DD（端末の現地の日付）
  date TEXT NOT NULL,
  -- breakfast / lunch / dinner / snack
  meal_type TEXT NOT NULL,
  name TEXT NOT NULL,
  -- NULL は未設定
  genre TEXT,
  -- NULL は未設定
  dish_type TEXT,
  -- planned / eaten
  status TEXT NOT NULL,
  -- ISO 8601（UTC、ミリ秒まで）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_email, id)
);

-- 日ごと・期間の取得用
CREATE INDEX meals_user_email_date ON meals (user_email, date);
