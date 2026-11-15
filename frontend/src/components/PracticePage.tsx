import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, queryKeys, type AnswerResult, type Bank, type Question, type QuestionFilters } from '../api'
import { useDomains } from '../hooks'
import { navigate } from '../lib/route'
import { useBanksLackingPictures } from '../lib/pictures'
import { BankPictures } from './BankPictures'
import { ImportBank } from './ImportBank'
import { QuestionCard } from './QuestionCard'

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
        {owner && (
          <div className="practice-links">
            <ImportBank area={area} />
          </div>
        )}
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

/** The sets of the browser: a tab key and the filters the server needs for it. */
type SetKey = 'all' | 'critical' | 'wrong' | 'bookmarked' | `topic:${string}`

const filtersOf = (key: SetKey): QuestionFilters => {
  if (key === 'all') return {}
  if (key.startsWith('topic:')) return { topic: key.slice('topic:'.length) }
  return { [key]: true }
}

/** Fisher-Yates: a new array in a random order. */
function shuffled<T>(list: T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function patchQuestion(client: ReturnType<typeof useQueryClient>, bank: string, id: string, patch: Partial<Question>) {
  client.setQueriesData<Question[]>({ queryKey: queryKeys.bankQuestions(bank) }, (list) =>
    Array.isArray(list) ? list.map((q) => (q.id === id ? { ...q, ...patch } : q)) : list,
  )
}

function BankPractice({ bank }: { bank: Bank }) {
  const client = useQueryClient()
  const all = useQuery({
    queryKey: queryKeys.bankQuestions(bank.id),
    queryFn: () => api.bankQuestions(bank.id),
  })
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

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
      {all.data && <Browser bank={bank} questions={all.data} />}
      <History bank={bank} />
    </>
  )
}

/** Set tabs, the number grid and one question card; `questions` is every question of the bank with the user's state. */
function Browser({ bank, questions }: { bank: Bank; questions: Question[] }) {
  const client = useQueryClient()
  const [setKey, setSetKey] = useState<SetKey>('all')
  // The ids of the set as they were when it opened (or after Shuffle): the list does not shift under the user.
  const [frozen, setFrozen] = useState<{ key: SetKey; ids: string[] } | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [choices, setChoices] = useState<Record<string, number>>({})
  const [results, setResults] = useState<Record<string, AnswerResult>>({})
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const setQuery = useQuery({
    queryKey: queryKeys.bankSet(bank.id, filtersOf(setKey)),
    queryFn: () => api.bankQuestions(bank.id, filtersOf(setKey)),
    enabled: setKey !== 'all',
    gcTime: 0,
  })
  const setIds = setKey === 'all' ? questions.map((q) => q.id) : setQuery.data?.map((q) => q.id)
  if (setIds && frozen?.key !== setKey) setFrozen({ key: setKey, ids: setIds })

  const byId = new Map(questions.map((q) => [q.id, q]))
  const list = (frozen?.key === setKey ? frozen.ids : [])
    .map((id) => byId.get(id))
    .filter((q): q is Question => q !== undefined)
  const index = Math.max(
    0,
    list.findIndex((q) => q.id === currentId),
  )
  const question = list[index]

  const wrongCount = questions.filter((q) => q.last_correct === false).length
  const tabs: { key: SetKey; title: string; count: number }[] = [
    { key: 'all', title: 'All', count: bank.question_count },
    ...bank.topics.map((t) => ({ key: `topic:${t.slug}` as SetKey, title: t.title, count: t.count })),
    { key: 'critical', title: 'Critical', count: bank.critical_count },
    { key: 'wrong', title: 'Got wrong', count: wrongCount },
    { key: 'bookmarked', title: 'Bookmarked', count: bank.bookmarked_count },
  ]
  const choose = (key: SetKey) => {
    setSetKey(key)
    setCurrentId(null)
    setError(null)
  }
  const shuffle = () => {
    const ids = shuffled(list.map((q) => q.id))
    setFrozen({ key: setKey, ids })
    setCurrentId(ids[0] ?? null)
  }
  const go = (i: number) => setCurrentId(list[i]?.id ?? null)

  const choice = question ? (choices[question.id] ?? question.last_choice) : null
  const result = question ? results[question.id] : undefined

  const check = async () => {
    if (!question || choice === null) return
    setChecking(true)
    setError(null)
    try {
      const answer = await api.answerQuestion(question.id, choice)
      setResults((r) => ({ ...r, [question.id]: answer }))
      patchQuestion(client, bank.id, question.id, { last_correct: answer.correct, last_choice: choice })
      void client.invalidateQueries({ queryKey: queryKeys.bankQuestions(bank.id) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check the answer.')
    } finally {
      setChecking(false)
    }
  }
  const bookmark = async () => {
    if (!question) return
    const next = !question.bookmarked
    setError(null)
    patchQuestion(client, bank.id, question.id, { bookmarked: next })
    try {
      await api.setBookmark(question.id, next)
    } catch (e) {
      patchQuestion(client, bank.id, question.id, { bookmarked: !next })
      setError(e instanceof Error ? e.message : 'Could not save the bookmark.')
    } finally {
      void client.invalidateQueries({ queryKey: queryKeys.banks(bank.area) })
    }
  }

  const stateWords = (q: Question) =>
    [q.last_correct === true ? 'right' : q.last_correct === false ? 'wrong' : null, q.critical ? 'critical' : null].filter(
      Boolean,
    )

  return (
    <div className="question-browser">
      <div role="tablist" aria-label="Sets" className="set-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={setKey === t.key}
            disabled={t.count === 0 && setKey !== t.key}
            onClick={() => choose(t.key)}
          >
            {t.title} <span className="muted">{t.count}</span>
          </button>
        ))}
      </div>
      {setQuery.isError && <p className="error">Could not load the questions.</p>}
      {frozen?.key === setKey && list.length === 0 && <p className="muted">There are no questions here yet.</p>}
      {question && (
        <div className="browser-body">
          <nav aria-label="Questions" className="question-grid">
            {list.map((q) => {
              const classes = [
                q.last_correct === true ? 'right' : q.last_correct === false ? 'wrong' : '',
                q.critical ? 'critical' : '',
                q.id === question.id ? 'current' : '',
              ].filter(Boolean)
              return (
                <button
                  key={q.id}
                  type="button"
                  className={classes.join(' ') || undefined}
                  aria-current={q.id === question.id ? 'true' : undefined}
                  aria-label={[`Question ${q.number}`, ...stateWords(q)].join(', ')}
                  onClick={() => setCurrentId(q.id)}
                >
                  {q.number}
                </button>
              )
            })}
          </nav>
          <div className="browser-card">
            <QuestionCard
              key={question.id}
              question={question}
              label={question.number}
              choice={choice}
              onChoose={(c) => {
                setChoices((m) => ({ ...m, [question.id]: c }))
                // A new pick starts a new answer: the earlier verdict no longer fits the selection.
                setResults((r) => {
                  const { [question.id]: _gone, ...rest } = r
                  return rest
                })
              }}
              correct={result?.answer ?? null}
              explanation={result?.explanation}
              saved={
                question.last_choice !== null && question.last_correct !== null
                  ? { choice: question.last_choice, correct: question.last_correct }
                  : null
              }
              bookmarked={question.bookmarked}
              onBookmark={() => void bookmark()}
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
              <button type="button" disabled={index === 0} onClick={() => go(index - 1)}>
                Previous
              </button>
              <button type="button" className="primary" disabled={choice === null || checking} onClick={() => void check()}>
                Check
              </button>
              <button type="button" disabled={index === list.length - 1} onClick={() => go(index + 1)}>
                Next
              </button>
              <button type="button" disabled={list.length < 2} onClick={shuffle}>
                Shuffle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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
