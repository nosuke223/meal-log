-- 会員のプラン（無料・有料）。行がない会員は無料として扱う。
-- 決済ができるまでは、D1 を直接書き換えて切り替える（手順は docs/deploy.md）
CREATE TABLE member_plans (
  -- 会員の ID。会員が消えたら、その会員のプランの行も消える
  user_id TEXT NOT NULL PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  -- free / paid
  plan TEXT NOT NULL CHECK (plan IN ('free', 'paid')),
  -- ISO 8601（UTC、ミリ秒まで）
  updated_at TEXT NOT NULL
);
