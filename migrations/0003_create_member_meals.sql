-- 食事の記録（1行が1品）。ログインした会員（Better Auth の表 "user"）ごとに分けて保存する。
-- 古い表 meals（Cloudflare Access のメールアドレスごとの記録）は残すが、API は使わない（消すのは別の変更）
-- 値の検査は API（src/meals/mealRecord.ts の検査）で行う
CREATE TABLE member_meals (
  -- 会員の ID。会員が消えたら、その会員の記録も消える
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
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
  -- 別の会員が同じ ID の記録を取り込んでも、別の記録になる
  PRIMARY KEY (user_id, id)
);

-- 日ごと・期間の取得用
CREATE INDEX member_meals_user_id_date ON member_meals (user_id, date);
