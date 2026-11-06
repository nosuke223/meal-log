type Props<T extends string> = {
  legend: string
  options: readonly T[]
  labels: Record<T, string>
  value: T | null
  onChange: (value: T | null) => void
}

/** 選択肢をボタンで並べる。選ばれているボタンをもう一度押すと未設定（null）に戻る */
export function ChoiceButtons<T extends string>({ legend, options, labels, value, onChange }: Props<T>) {
  return (
    <div role="group" aria-label={legend} className="choices">
      <span className="choices-legend" aria-hidden="true">
        {legend}
      </span>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className="choice"
          aria-pressed={value === option}
          onClick={() => onChange(value === option ? null : option)}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  )
}
