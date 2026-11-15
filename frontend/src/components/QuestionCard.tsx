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
  /** The last saved answer: its option is marked right or wrong without showing the correct one. */
  saved?: { choice: number; correct: boolean } | null
  /** Shows the Bookmark toggle in the header when `onBookmark` is given. */
  bookmarked?: boolean
  onBookmark?: () => void
}

/** One question: number, plain text, picture, and its options as radio buttons. */
export function QuestionCard({ question, label, total, choice, onChoose, locked, correct, explanation, saved, bookmarked, onBookmark }: Props) {
  const textId = `question-text-${question.id}`
  return (
    <article className="question-card" aria-label={`Question ${label}`}>
      <header className="question-head">
        <h2>
          Question {label}
          {total !== undefined && <span className="muted"> of {total}</span>}
        </h2>
        {question.critical && <span className="crit-badge">Critical</span>}
        {onBookmark && (
          <button type="button" className="bookmark-toggle" aria-pressed={bookmarked ?? false} onClick={onBookmark}>
            Bookmark
          </button>
        )}
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
          const savedHere = correct == null && saved != null && saved.choice === n
          if (savedHere) classes.push(saved.correct ? 'right' : 'wrong')
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
              {((correct != null && n !== correct && choice === n) || savedHere) && <span className="option-tag">Your answer</span>}
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
