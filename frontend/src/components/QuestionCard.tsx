import { api, type Question } from '../api'

interface Props {
  question: Question
  /** The number shown in "Question N" (the bank number in practice, the position in a test). */
  label: number
  /** Shown as "of N" after the label, when known. */
  total?: number
  choice: number | null
  onChoose: (choice: number) => void
  /** Options cannot be changed (an answer was checked). */
  locked?: boolean
  /** The correct option (1-based), once it may be shown. */
  correct?: number | null
  explanation?: string | null
}

/** One question: number, plain text, picture, and its options as radio buttons. */
export function QuestionCard({ question, label, total, choice, onChoose, locked, correct, explanation }: Props) {
  const textId = `question-text-${question.id}`
  return (
    <article className="question-card" aria-label={`Question ${label}`}>
      <header className="question-head">
        <h2>
          Question {label}
          {total !== undefined && <span className="muted"> of {total}</span>}
        </h2>
        {question.critical && <span className="crit-badge">Critical</span>}
      </header>
      {/* Plain text only: React escapes it, and line breaks of the source are kept. */}
      <p id={textId} className="question-text">
        {question.text}
      </p>
      {question.has_image && (
        <img className="question-image" src={api.questionImageUrl(question.id)} alt={`Question ${label} picture`} />
      )}
      <fieldset className="options" aria-labelledby={textId}>
        {question.options.map((option, i) => {
          const n = i + 1
          const classes = ['option']
          if (correct != null && n === correct) classes.push('right')
          else if (correct != null && choice === n) classes.push('wrong')
          return (
            <label key={n} className={classes.join(' ')}>
              <input
                type="radio"
                name={`options-${question.id}`}
                value={n}
                checked={choice === n}
                disabled={locked}
                onChange={() => onChoose(n)}
              />
              <span className="option-text">{option}</span>
              {correct != null && n === correct && <span className="option-tag">Correct answer</span>}
              {correct != null && n !== correct && choice === n && <span className="option-tag">Your answer</span>}
            </label>
          )
        })}
      </fieldset>
      {explanation && (
        <p className="explanation">
          <strong>Explanation:</strong> {explanation}
        </p>
      )}
    </article>
  )
}
