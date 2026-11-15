import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, queryKeys, type Exam } from '../api'
import { QuestionCard } from './QuestionCard'

const SAVE_DELAY_MS = 400

/** `#/exam/<id>`: a mock test being taken, or its result and review. */
export function ExamPage({ id }: { id: string }) {
  const exam = useQuery({
    queryKey: queryKeys.exam(id),
    queryFn: () => api.exam(id),
    retry: false,
    // A test under way is not reloaded behind the user's back; their choices live in the page.
    staleTime: Infinity,
  })
  if (exam.isError) {
    return (
      <section className="practice-page" aria-label="Test not found">
        <h1>Test not found</h1>
        <p className="muted">It may not exist, or it is not yours.</p>
        <a href="#/">Back to home</a>
      </section>
    )
  }
  if (!exam.data) return <section className="practice-page" aria-label="Test" aria-busy="true" />
  return exam.data.submitted_at !== null && exam.data.result ? (
    <ExamResultView exam={exam.data} />
  ) : (
    <TakeExam exam={exam.data} />
  )
}

function formatLeft(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function TakeExam({ exam }: { exam: Exam }) {
  const client = useQueryClient()
  const [answers, setAnswers] = useState<Record<string, number>>(exam.answers)
  const [index, setIndex] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deadline = new Date(exam.deadline).getTime()
  const [left, setLeft] = useState(() => deadline - Date.now())

  // The latest answers, and whether the server has them yet.
  const latest = useRef(answers)
  const dirty = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const done = useRef(false)

  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    if (!dirty.current || done.current) return
    dirty.current = false
    api.saveExamAnswers(exam.id, latest.current).catch((e) => {
      // 409: the test is finished (for example submitted in another tab); show the result.
      if (e instanceof ApiError && e.status === 409) void client.invalidateQueries({ queryKey: queryKeys.exam(exam.id) })
      else dirty.current = true
    })
  }, [client, exam.id])

  // Leaving the page keeps what was chosen.
  useEffect(() => flush, [flush])

  const choose = (questionId: string, choice: number) => {
    const next = { ...latest.current, [questionId]: choice }
    latest.current = next
    dirty.current = true
    setAnswers(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, SAVE_DELAY_MS)
  }

  const submit = useCallback(async () => {
    if (done.current) return
    done.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    setSubmitting(true)
    setConfirming(false)
    setError(null)
    try {
      const finished = await api.submitExam(exam.id, latest.current)
      client.setQueryData(queryKeys.exam(exam.id), finished)
      void client.invalidateQueries({ queryKey: queryKeys.bankExams(exam.bank_id) })
      void client.invalidateQueries({ queryKey: queryKeys.bankQuestions(exam.bank_id) })
    } catch (e) {
      done.current = false
      setSubmitting(false)
      if (e instanceof ApiError && e.status === 409) void client.invalidateQueries({ queryKey: queryKeys.exam(exam.id) })
      else setError(e instanceof Error ? e.message : 'Could not submit the test.')
    }
  }, [client, exam.id, exam.bank_id])

  // The countdown; at zero the test goes in with the answers given.
  useEffect(() => {
    const tick = () => {
      const remaining = deadline - Date.now()
      setLeft(remaining)
      if (remaining <= 0) void submit()
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [deadline, submit])

  const question = exam.questions[index]
  const unanswered = exam.questions.filter((q) => answers[q.id] === undefined).length

  return (
    <section className="practice-page exam-page" aria-label="Test">
      <div className="exam-bar">
        <h1>Test</h1>
        <span className={left <= 60_000 ? 'exam-timer low' : 'exam-timer'} role="timer" aria-label="Time left">
          {formatLeft(left)}
        </span>
      </div>
      <nav className="palette" aria-label="Questions">
        {exam.questions.map((q, i) => (
          <button
            key={q.id}
            type="button"
            className={[answers[q.id] !== undefined ? 'answered' : '', i === index ? 'current' : ''].join(' ').trim()}
            aria-current={i === index ? 'step' : undefined}
            aria-label={`Question ${i + 1}${answers[q.id] !== undefined ? ', answered' : ''}`}
            onClick={() => setIndex(i)}
          >
            {i + 1}
          </button>
        ))}
      </nav>
      <QuestionCard
        key={question.id}
        question={question}
        label={index + 1}
        total={exam.questions.length}
        choice={answers[question.id] ?? null}
        onChoose={(c) => choose(question.id, c)}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="flow-nav">
        <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          Previous
        </button>
        <button type="button" disabled={index === exam.questions.length - 1} onClick={() => setIndex(index + 1)}>
          Next
        </button>
        <button type="button" className="primary" disabled={submitting || confirming} onClick={() => setConfirming(true)}>
          Submit test
        </button>
      </div>
      {confirming && (
        <p className="note-confirm" role="alertdialog" aria-label="Confirm submit">
          {unanswered === 0
            ? 'Submit your test now?'
            : `You have ${unanswered} unanswered ${unanswered === 1 ? 'question' : 'questions'}. They count as wrong. Submit now?`}
          <button type="button" className="primary" onClick={() => void submit()}>
            Yes, submit
          </button>
          <button type="button" autoFocus onClick={() => setConfirming(false)}>
            Keep going
          </button>
        </p>
      )}
    </section>
  )
}

function ExamResultView({ exam }: { exam: Exam }) {
  const result = exam.result!
  const byId = new Map(exam.questions.map((q) => [q.id, q]))
  const critical = result.failed_on_critical
  return (
    <section className="practice-page exam-page" aria-label="Test result">
      <a className="breadcrumb" href="#/" onClick={(e) => { e.preventDefault(); window.history.back() }}>
        Back
      </a>
      <h1 className={result.passed ? 'result-pass' : 'result-fail'}>{result.passed ? 'Passed' : 'Failed'}</h1>
      <p className="score">
        Score: <strong>{result.score}/{result.total}</strong>
      </p>
      {!result.passed && critical.length > 0 && (
        <p className="result-fail" role="note">
          {critical.length === 1
            ? `Failed because critical question ${critical[0]} was answered wrong.`
            : `Failed because critical questions ${critical.join(', ')} were answered wrong.`}
        </p>
      )}
      <h3>Review</h3>
      <ol className="review" aria-label="Review">
        {result.review.map((item) => {
          const question = byId.get(item.question_id)
          if (!question) return null
          return (
            <li key={item.question_id} className={item.correct ? 'review-item ok' : 'review-item bad'}>
              <p className="review-head">
                <strong>Question {item.number}</strong>
                {question.critical && <span className="crit-badge">Critical</span>}
                <span className={item.correct ? 'result-pass' : 'result-fail'}>
                  {item.choice === null ? 'Not answered' : item.correct ? 'Right' : 'Wrong'}
                </span>
              </p>
              <p className="question-text">{question.text}</p>
              {question.has_image && (
                <img className="question-image" src={api.questionImageUrl(question.id)} alt={`Question ${item.number} picture`} />
              )}
              <ul className="review-options">
                {question.options.map((option, i) => {
                  const n = i + 1
                  const isRight = n === item.answer
                  const chosen = n === item.choice
                  return (
                    <li key={n} className={isRight ? 'option right' : chosen ? 'option wrong' : 'option'}>
                      <span className="option-text">{option}</span>
                      {isRight && <span className="option-tag">Correct answer</span>}
                      {chosen && <span className="option-tag">Your answer</span>}
                    </li>
                  )
                })}
              </ul>
              {item.explanation && (
                <p className="explanation">
                  <strong>Explanation:</strong> {item.explanation}
                </p>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
