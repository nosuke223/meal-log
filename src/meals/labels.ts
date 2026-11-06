// 画面に表示する名前
import type { DishType, Genre, MealStatus, MealType } from './mealRecord'

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: '朝',
  lunch: '昼',
  dinner: '夜',
  snack: '間食',
}

export const GENRE_LABELS: Record<Genre, string> = {
  japanese: '和',
  western: '洋',
  chinese: '中',
  other: 'その他',
}

export const DISH_TYPE_LABELS: Record<DishType, string> = {
  staple: '主食',
  main: '主菜',
  side: '副菜',
  soup: '汁物',
  other: 'その他',
}

export const MEAL_STATUS_LABELS: Record<MealStatus, string> = {
  planned: '予定',
  eaten: '食べた',
}
