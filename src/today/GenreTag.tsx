import { GENRE_LABELS } from '../meals/labels'
import type { Genre } from '../meals/mealRecord'

/** ジャンルの札。カレンダーの点と同じ色で、文字（和・洋・中・その他）でも見分けられる */
export function GenreTag({ genre }: { genre: Genre }) {
  return <span className={`tag tag-genre tag-${genre}`}>{GENRE_LABELS[genre]}</span>
}
