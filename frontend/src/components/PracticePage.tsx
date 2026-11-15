import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, queryKeys, type AnswerResult, type Bank, type Question, type QuestionFilters } from '../api'
import { useDomains } from '../hooks'
import { navigate } from '../lib/route'
import { useBanksLackingPictures } from '../lib/pictures'
import { BankPictures } from './BankPictures'
import { QuestionCard } from './QuestionCard'

type Mode = { title: string; questions: Question[] }

const plural = (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`

/** `#/practice/<area>`: pick a bank, practise a topic, the critical or the wrong questions, or start a test. */
export function PracticePage({ area }: { area: string }) {
  const banks = useQuery({ queryKey: queryKeys.banks(area), queryFn: () => api.banks(area), retry: false })
  const domains = useDomains()
  const owner = domains.data?.find((d) => d.id === area)?.editable ?? false
  const lacking = useBanksLackingPictures(banks.data)
  const [bankId, setBankId] = useState<string | null>(null)

  if (banks.isError) {
    return (
      <section className="practice-page" aria-label="Practice not found">
        <h1>Practice not found</h1>
        <p className="muted">This area is not available.</p>
        <a href="#/">Back to home</a>
      </section>
    )
  }
  if (!banks.data) return <section className="practice-page" aria-label="Practice" aria-busy="true" />
  const bank = banks.data.find((b) => b.id === bankId) ?? banks.data[0]
  if (!bank) {
    return (
      <section className="practice-page" aria-label="Practice">
        <a className="breadcrumb" href={`#/roadmap/${area}`}>
          Back to the area
        </a>
        <h1>Practice</h1>
        <p className="muted">This area has no question banks yet.</p>
      </section>
    )
  }
  return (
    <section className="practice-page" aria-label="Practice">
      <a className="breadcrumb" href={`#/roadmap/${area}`}>
        Back to the area
      </a>
      <div className="practice-title">
        <h1>{bank.title}</h1>
        {banks.data.length > 1 && (
          <label className="bank-picker">
            Question bank
            <select value={bank.id} onChange={(e) => setBankId(e.target.value)}>
              {banks.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {owner && lacking.some((b) => b.id === bank.id) && <BankPictures key={bank.id} bank={bank} area={area} />}
      <BankPractice key={bank.id} bank={bank} />
    </section>
  )
}

function BankPractice({ bank }: { bank: Bank }) {
  const client = useQueryClient()
  const all = useQuery({
    queryKey: queryKeys.bankQuestions(bank.id),
    queryFn: () => api.bankQuestions(bank.id),
  })
  const [mode, setMode] = useState<Mode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const open = async (title: string, filters: QuestionFilters) => {
    setError(null)
    try {
      const questions = await api.bankQuestions(bank.id, filters)
      if (questions.length === 0) setError('There are no questions here yet.')
      else setMode({ title, questions })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the questions.')
    }
  }
  const back = () => {
    setMode(null)
    // Progress changed while practising: the counts below must follow.
    void client.invalidateQueries({ queryKey: queryKeys.bankQuestions(bank.id) })
  }

  if (mode) return <QuestionFlow key={mode.title} mode={mode} onBack={back} />

  const questions = all.data ?? []
  const rightOf = (list: Question[]) => list.filter((q) => q.last_correct === true).length
  const wrong = questions.filter((q) => q.last_correct === false).length
  const critical = questions.filter((q) => q.critical)
  const start = async () => {
    setStarting(true)
    setError(null)
    try {
      const exam = await api.startExam(bank.id)
      client.setQueryData(queryKeys.exam(exam.id), exam)
      void client.invalidateQueries({ queryKey: queryKeys.bankExams(bank.id) })
      navigate({ page: 'exam', id: exam.id })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the test.')
      setStarting(false)
    }
  }

  return (
    <>
      <p className="muted bank-rules">
        Test: {bank.rules.questions} questions, {bank.rules.minutes} minutes, pass mark {bank.rules.pass_mark}.
      </p>
      <div className="practice-actions">
        <button type="button" className="primary" disabled={starting} onClick={() => void start()}>
          Start a test
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <h3>Practise</h3>
      {all.isError && <p className="error">Could not load the questions.</p>}
      <ul className="topic-list" aria-label="Practice sets">
        {bank.topics.map((t) => (
          <li key={t.slug}>
            <button type="button" onClick={() => void open(t.title, { topic: t.slug })}>
              <span className="topic-name">{t.title}</span>
              <span className="topic-meta muted">
                {plural(t.count)}
                {all.data && ` · ${rightOf(questions.filter((q) => q.topic === t.slug))} / ${t.count} right`}
              </span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            disabled={bank.critical_count === 0}
            onClick={() => void open('Critical questions', { critical: true })}
          >
            <span className="topic-name">Critical questions</span>
            <span className="topic-meta muted">
              {plural(bank.critical_count)}
              {all.data && ` · ${rightOf(critical)} / ${bank.critical_count} right`}
            </span>
          </button>
        </li>
        <li>
          <button type="button" disabled={!all.data || wrong === 0} onClick={() => void open('Got wrong', { wrong: true })}>
            <span className="topic-name">Got wrong</span>
            <span className="topic-meta muted">{all.data ? plural(wrong) : ''}</span>
          </button>
        </li>
      </ul>
      <History bank={bank} />
    </>
  )
}

function History({ bank }: { bank: Bank }) {
  const exams = useQuery({ queryKey: queryKeys.bankExams(bank.id), queryFn: () => api.bankExams(bank.id) })
  return (
    <>
      <h3>Past tests</h3>
      {exams.isError && <p className="error">Could not load your tests.</p>}
      {exams.data && exams.data.length === 0 && <p className="muted">No tests yet.</p>}
      {exams.data && exams.data.length > 0 && (
        <ul className="exam-history" aria-label="Past tests">
          {exams.data.map((e) => (
            <li key={e.id}>
              <a href={`#/exam/${e.id}`}>
                <time dateTime={e.started_at}>{new Date(e.started_at).toLocaleString()}</time>
                {e.submitted_at === null ? (
                  <span className="muted">In progress</span>
                ) : (
                  <>
                    <span>
                      {e.score}/{e.total}
                    </span>
                    <span className={e.passed ? 'result-pass' : 'result-fail'}>{e.passed ? 'Passed' : 'Failed'}</span>
                  </>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** One question at a time; Check records the answer and shows the right option and the explanation. */
function QuestionFlow({ mode, onBack }: { mode: Mode; onBack: () => void }) {
  const [index, setIndex] = useState(0)
  const [choices, setChoices] = useState<Record<string, number>>({})
  const [results, setResults] = useState<Record<string, AnswerResult>>({})
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const question = mode.questions[index]
  const result = results[question.id]
  const choice = choices[question.id] ?? null

  const check = async () => {
    if (choice === null) return
    setChecking(true)
    setError(null)
    try {
      const answer = await api.answerQuestion(question.id, choice)
      setResults((r) => ({ ...r, [question.id]: answer }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check the answer.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="question-flow">
      <div className="flow-bar">
        <button type="button" onClick={onBack}>
          Back to topics
        </button>
        <span className="muted" aria-live="polite">
          {mode.title}: {index + 1} of {mode.questions.length}
        </span>
      </div>
      <QuestionCard
        key={question.id}
        question={question}
        label={question.number}
        choice={choice}
        onChoose={(c) => setChoices((m) => ({ ...m, [question.id]: c }))}
        locked={!!result}
        correct={result?.answer ?? null}
        explanation={result?.explanation}
      />
      {result && (
        <p role="status" className={result.correct ? 'verdict result-pass' : 'verdict result-fail'}>
          {result.correct ? 'Right' : 'Wrong'}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="flow-nav">
        <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          Previous
        </button>
        <button type="button" className="primary" disabled={choice === null || !!result || checking} onClick={() => void check()}>
          Check
        </button>
        <button type="button" disabled={index === mode.questions.length - 1} onClick={() => setIndex(index + 1)}>
          Next
        </button>
      </div>
    </div>
  )
}
