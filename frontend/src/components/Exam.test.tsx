/** Spec: practice-exams - Mock exam by the bank's rules, Test history and access. */
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeApi, makeBank, makeField, type FakeExam } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

const topics = [
  { slug: 't1', title: 'Chapter 1' },
  { slug: 't2', title: 'Chapter 2' },
]

/**
 * Four questions, drawn critical first: Q1 (critical, right = "Q1 A"), then Q2, Q3, Q4.
 * Right options: Q1 A, Q2 B, Q3 A, Q4 B. Pass mark 3 and a critical question fails the test.
 */
function setup(rules: Parameters<typeof makeBank>[3] = {}) {
  const state = installFakeApi()
  state.fields.push(makeField('Driving', [{ slug: 'driving-b', title: 'Driving B', topics }], { published: true }))
  const q = (n: number, answer: number, extra = {}) => ({
    topic: n < 3 ? 't1' : 't2',
    text: `Text of Q${n}`,
    options: [`Q${n} A`, `Q${n} B`],
    answer,
    explanation: `Because Q${n}.`,
    ...extra,
  })
  state.banks.push(
    makeBank('driving-b', 'Class B theory', [q(1, 1, { critical: true }), q(2, 2), q(3, 1), q(4, 2), q(5, 1)], {
      questions: 4,
      minutes: 20,
      pass_mark: 3,
      ...rules,
    }),
  )
  return state
}

const start = async () => {
  const rendered = await renderAppReady('#/practice/driving-b')
  await rendered.user.click(await screen.findByRole('button', { name: 'Start a test' }))
  await screen.findByRole('navigation', { name: 'Questions' })
  return rendered
}

type User = Awaited<ReturnType<typeof start>>['user']

/** Picks an option of the question that is shown, then moves on with Next (not on the last). */
const answerShown = async (user: User, option: string) => {
  await user.click(screen.getByRole('radio', { name: option }))
}
const palette = () => within(screen.getByRole('navigation', { name: 'Questions' }))
const goTo = async (user: User, n: number) => user.click(palette().getByRole('button', { name: new RegExp(`^Question ${n}`) }))

const submit = async (user: User) => {
  await user.click(screen.getByRole('button', { name: 'Submit test' }))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Yes, submit' }))
}

/** Answers questions 1 to 4 of the test with the given options (the options of the drawn order). */
const answerAll = async (user: User, options: string[]) => {
  for (let i = 0; i < options.length; i++) {
    await goTo(user, i + 1)
    await answerShown(user, options[i])
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('mock exam', () => {
  it('shows the drawn questions in a palette, a countdown, and never an answer', async () => {
    const state = setup()
    await start()
    expect(palette().getAllByRole('button')).toHaveLength(4)
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent(/^(19:5\d|20:00)$/)
    expect(screen.getByRole('heading', { name: /Question 1/ })).toHaveTextContent('of 4')
    // The first drawn question is the critical one, and no option is marked right before submitting.
    expect(screen.getByText('Critical')).toBeInTheDocument()
    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument()
    expect(document.querySelector('.option.right')).toBeNull()
    expect(state.exams[0].question_ids).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument()
  })

  it('passes: 3 of 4 right with the critical question right', async () => {
    setup()
    const { user } = await start()
    await answerAll(user, ['Q1 A', 'Q2 B', 'Q3 A', 'Q4 A'])
    await submit(user)
    expect(await screen.findByRole('heading', { name: 'Passed' })).toBeInTheDocument()
    expect(screen.getByText('3/4')).toBeInTheDocument()
    expect(screen.queryByText(/critical question/i)).not.toBeInTheDocument()
  })

  it('fails on a critical question even with a score above the pass mark, naming it', async () => {
    setup()
    const { user } = await start()
    await answerAll(user, ['Q1 B', 'Q2 B', 'Q3 A', 'Q4 B'])
    await submit(user)
    expect(await screen.findByRole('heading', { name: 'Failed' })).toBeInTheDocument()
    expect(screen.getByText('3/4')).toBeInTheDocument()
    expect(screen.getByText('Failed because critical question 1 was answered wrong.')).toBeInTheDocument()
  })

  it('fails by the pass mark without a critical line', async () => {
    setup()
    const { user } = await start()
    await answerAll(user, ['Q1 A', 'Q2 A'])
    await submit(user)
    expect(await screen.findByRole('heading', { name: 'Failed' })).toBeInTheDocument()
    expect(screen.getByText('1/4')).toBeInTheDocument()
    expect(screen.queryByText(/critical question/i)).not.toBeInTheDocument()
  })

  it('fails by score alone when the critical rule is off: no critical line', async () => {
    setup({ critical_fails: false })
    const { user } = await start()
    // The critical question wrong, one more wrong: 2 of 4 is under the pass mark of 3.
    await answerAll(user, ['Q1 B', 'Q2 A', 'Q3 A', 'Q4 B'])
    await submit(user)
    expect(await screen.findByRole('heading', { name: 'Failed' })).toBeInTheDocument()
    expect(screen.getByText('2/4')).toBeInTheDocument()
    expect(screen.queryByText(/critical question/i)).not.toBeInTheDocument()
  })

  it('passes with a wrong critical question when the critical rule is off', async () => {
    setup({ critical_fails: false })
    const { user } = await start()
    await answerAll(user, ['Q1 B', 'Q2 B', 'Q3 A', 'Q4 B'])
    await submit(user)
    expect(await screen.findByRole('heading', { name: 'Passed' })).toBeInTheDocument()
    expect(screen.queryByText(/critical question/i)).not.toBeInTheDocument()
  })

  it('asks before submitting and says how many questions are unanswered', async () => {
    const state = setup()
    const { user } = await start()
    await answerAll(user, ['Q1 A', 'Q2 B'])
    await user.click(screen.getByRole('button', { name: 'Submit test' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('2 unanswered questions')
    await user.click(within(dialog).getByRole('button', { name: 'Keep going' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(state.exams[0].submitted_at).toBeNull()
    await submit(user)
    expect(await screen.findByRole('heading', { name: 'Failed' })).toBeInTheDocument()
    expect(state.exams[0].submitted_at).not.toBeNull()
  })

  it('marks answered questions in the palette and jumps with a click', async () => {
    setup()
    const { user } = await start()
    await goTo(user, 3)
    expect(screen.getByRole('heading', { name: /Question 3/ })).toHaveTextContent('of 4')
    expect(screen.getByText('Text of Q3')).toBeInTheDocument()
    await answerShown(user, 'Q3 A')
    expect(palette().getByRole('button', { name: 'Question 3, answered' })).toBeInTheDocument()
    expect(palette().getByRole('button', { name: 'Question 1' })).toBeInTheDocument()
    expect(palette().getByRole('button', { name: 'Question 3, answered' })).toHaveAttribute('aria-current', 'step')
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getByRole('heading', { name: /Question 2/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('radio', { name: 'Q3 A' })).toBeChecked()
  })

  it('saves answers as they are chosen so a reload keeps them', async () => {
    const state = setup()
    const first = await start()
    await goTo(first.user, 2)
    await answerShown(first.user, 'Q2 B')
    await waitFor(() => expect(state.exams[0].answers).toEqual({ [state.banks[0].questions[1].id]: 2 }))
    const put = state.calls.find((c) => c.method === 'PUT' && c.url === '/api/exams/exam-1/answers')
    expect(put?.body).toEqual({ answers: { [state.banks[0].questions[1].id]: 2 } })
    first.unmount()

    const second = await renderAppReady('#/exam/exam-1')
    await screen.findByRole('navigation', { name: 'Questions' })
    expect(palette().getByRole('button', { name: 'Question 2, answered' })).toBeInTheDocument()
    await goTo(second.user, 2)
    expect(screen.getByRole('radio', { name: 'Q2 B' })).toBeChecked()
  })

  it('chooses options with the keyboard', async () => {
    setup()
    const { user } = await start()
    const first = screen.getByRole('radio', { name: 'Q1 A' })
    first.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: 'Q1 B' })).toBeChecked()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('radio', { name: 'Q1 A' })).toBeChecked()
    screen.getByRole('button', { name: 'Submit test' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('3 unanswered questions')
  })

  it('shows the result and a review of every question with the chosen and correct option', async () => {
    setup()
    const { user } = await start()
    await answerAll(user, ['Q1 A', 'Q2 A', 'Q3 A'])
    await submit(user)
    const review = await screen.findByRole('list', { name: 'Review' })
    const items = within(review).getAllByRole('listitem', { name: '' }).filter((li) => li.classList.contains('review-item'))
    expect(items).toHaveLength(4)
    // Question 2: chose A, correct B, with the explanation.
    const q2 = items[1]
    expect(within(q2).getByText('Wrong')).toBeInTheDocument()
    expect(within(q2).getByText('Q2 A').parentElement).toHaveTextContent('Your answer')
    expect(within(q2).getByText('Q2 B').parentElement).toHaveTextContent('Correct answer')
    expect(within(q2).getByText(/Because Q2\./)).toBeInTheDocument()
    // Question 4 was not answered.
    expect(within(items[3]).getByText('Not answered')).toBeInTheDocument()
    expect(within(items[0]).getByText('Critical')).toBeInTheDocument()
  })

  it('shows the result of a finished test on reload', async () => {
    const state = setup()
    const { user, unmount } = await start()
    await answerAll(user, ['Q1 A', 'Q2 B', 'Q3 A', 'Q4 B'])
    await submit(user)
    await screen.findByRole('heading', { name: 'Passed' })
    unmount()
    expect(state.exams[0].passed).toBe(true)
    await renderAppReady('#/exam/exam-1')
    expect(await screen.findByRole('heading', { name: 'Passed' })).toBeInTheDocument()
    expect(screen.getByText('4/4')).toBeInTheDocument()
  })

  it('answers not found for the test of another user', async () => {
    const state = setup()
    const other: FakeExam = {
      id: 'theirs',
      bank_id: state.banks[0].id,
      mine: false,
      question_ids: [],
      answers: {},
      started_at: '2026-11-10T09:00:00Z',
      deadline: '2026-11-10T09:20:00Z',
      submitted_at: null,
      score: null,
      passed: null,
      failed_on_critical: [],
    }
    state.exams.push(other)
    await renderAppReady('#/exam/theirs')
    expect(await screen.findByRole('heading', { name: 'Test not found' })).toBeInTheDocument()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  })

  it('submits by itself when the countdown ends, scoring the answers given', async () => {
    const state = setup({ minutes: 1 })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = await start()
    await answerAll(user, ['Q1 A', 'Q2 B'])
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent(/^0[01]:\d\d$/)
    expect(state.exams[0].submitted_at).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000)
    })
    expect(await screen.findByRole('heading', { name: 'Failed' })).toBeInTheDocument()
    // Two right of four: unanswered questions count as wrong.
    expect(screen.getByText('2/4')).toBeInTheDocument()
    expect(state.exams[0].submitted_at).not.toBeNull()
    expect(state.exams[0].score).toBe(2)
    expect(screen.getAllByText('Not answered')).toHaveLength(2)
    // The answers given reached the server with the submit.
    const submits = state.calls.filter((c) => c.url === '/api/exams/exam-1/submit')
    expect(submits).toHaveLength(1)
  })
})
