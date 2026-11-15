/** Spec: practice-exams - Import a question bank, Practice by topic, Test history. */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeApi, makeBank, makeField, type FakeExam, type FakeState } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

const topics = [
  { slug: 't1', title: 'Chapter 1' },
  { slug: 't2', title: 'Chapter 2' },
]

function setup(opts: { mine?: boolean; bank?: boolean } = {}) {
  const state = installFakeApi()
  state.fields.push(
    makeField('Driving', [{ slug: 'driving-b', title: 'Driving B', topics }], {
      mine: opts.mine ?? true,
      published: true,
    }),
  )
  if (opts.bank !== false) {
    state.banks.push(
      makeBank('driving-b', 'Class B theory', [
        { topic: 't1', text: 'What does a red light mean?', options: ['Go', 'Stop', 'Slow'], answer: 2, explanation: 'Red means stop.' },
        { topic: 't1', text: 'Critical one', options: ['Yes', 'No'], answer: 1, critical: true },
        { topic: 't2', text: 'Look at <b>this</b> sign', options: ['A', 'B'], answer: 1, hasImage: true },
      ]),
    )
  }
  return state
}

/** The page itself: the agent panel has a status line of its own. */
const content = () => within(screen.getByRole('main', { name: 'Content' }))

const file = (name: string, body: unknown) =>
  new File([typeof body === 'string' ? body : JSON.stringify(body)], name, { type: 'application/json' })

const bankFile = {
  title: 'Imported bank',
  rules: { questions: 2, minutes: 5, pass_mark: 1, critical_fails: true, min_critical: 0, per_topic: {} },
  questions: [
    { number: 1, topic: 't1', text: 'One?', options: ['a', 'b'], answer: 1 },
    { number: 2, topic: 't2', text: 'Two?', options: ['a', 'b', 'c'], answer: 3, image: 'q2.png' },
  ],
}

describe('import a question bank', () => {
  it('shows the owner Import questions, takes a .json or .zip, and shows the result', async () => {
    const state = setup({ bank: false })
    const { user } = await renderAppReady('#/roadmap/driving-b')
    await screen.findByRole('button', { name: 'Import questions' })
    expect(screen.queryByRole('link', { name: 'Practice' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Question bank file')).toHaveAttribute('accept', expect.stringContaining('.zip'))

    await user.upload(screen.getByLabelText('Question bank file'), file('bank.json', bankFile))
    expect(await content().findByRole('status')).toHaveTextContent('Imported Imported bank: 2 questions.')
    expect(state.bankImports).toEqual(['bank.json'])
    expect(await screen.findByRole('link', { name: 'Practice' })).toHaveAttribute('href', '#/practice/driving-b')
    expect(state.banks).toHaveLength(1)
  })

  it('lists every problem with the question number and stores nothing', async () => {
    const state = setup({ bank: false })
    const { user } = await renderAppReady('#/roadmap/driving-b')
    await screen.findByRole('button', { name: 'Import questions' })
    const bad = {
      ...bankFile,
      questions: [
        { number: 1, topic: 't1', text: 'One?', options: ['a', 'b', 'c', 'd'], answer: 5 },
        { number: 2, topic: 'nope', text: 'Two?', options: ['a', 'b'], answer: 1 },
      ],
    }
    await user.upload(screen.getByLabelText('Question bank file'), file('bad.json', bad))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/Question 1: answer 5/)).toBeInTheDocument()
    expect(within(alert).getByText(/Question 2: topic nope/)).toBeInTheDocument()
    expect(state.banks).toHaveLength(0)
    expect(screen.queryByRole('link', { name: 'Practice' })).not.toBeInTheDocument()
  })

  it('shows a problem of the file itself without a question number', async () => {
    setup({ bank: false })
    const { user } = await renderAppReady('#/roadmap/driving-b')
    await screen.findByRole('button', { name: 'Import questions' })
    await user.upload(screen.getByLabelText('Question bank file'), file('x.json', 'not json'))
    expect(await screen.findByText('the file is not valid JSON')).toBeInTheDocument()
  })

  it('shows Practice but no import to someone who does not own the area', async () => {
    setup({ mine: false })
    await renderAppReady('#/roadmap/driving-b')
    expect(await screen.findByRole('link', { name: 'Practice' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import questions' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Question bank file')).not.toBeInTheDocument()
  })
})

describe('practice page', () => {
  it('lists topics with counts and progress, Critical questions and Got wrong', async () => {
    const state = setup()
    const ids = state.banks[0].questions.map((q) => q.id)
    state.practice[ids[0]] = { last_correct: true, times_wrong: 0 }
    state.practice[ids[1]] = { last_correct: false, times_wrong: 1 }
    await renderAppReady('#/practice/driving-b')
    const sets = await screen.findByRole('list', { name: 'Practice sets' })
    expect(await within(sets).findByRole('button', { name: /Chapter 1.*2 questions.*1 \/ 2 right/ })).toBeInTheDocument()
    expect(within(sets).getByRole('button', { name: /Chapter 2.*1 question.*0 \/ 1 right/ })).toBeInTheDocument()
    expect(within(sets).getByRole('button', { name: /Critical questions.*1 question.*0 \/ 1 right/ })).toBeInTheDocument()
    expect(within(sets).getByRole('button', { name: /Got wrong.*1 question/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Start a test' })).toBeInTheDocument()
  })

  it('offers a bank picker only when the area has several banks', async () => {
    const state = setup()
    const first = await renderAppReady('#/practice/driving-b')
    await screen.findByRole('heading', { name: 'Class B theory' })
    expect(screen.queryByLabelText('Question bank')).not.toBeInTheDocument()
    first.unmount()

    state.banks.push(makeBank('driving-b', 'Second bank', [{ topic: 't1', text: 'Only one' }]))
    const second = await renderAppReady('#/practice/driving-b')
    await second.user.selectOptions(await screen.findByLabelText('Question bank'), 'Second bank')
    expect(await screen.findByRole('heading', { name: 'Second bank' })).toBeInTheDocument()
  })

  it('says when the area is not available', async () => {
    setup()
    await renderAppReady('#/practice/nothing-here')
    expect(await screen.findByRole('heading', { name: 'Practice not found' })).toBeInTheDocument()
  })

  it('a wrong answer shows the correct option and explanation, and the question appears in Got wrong', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    await user.click(await screen.findByRole('button', { name: /Chapter 1/ }))
    expect(await screen.findByText('What does a red light mean?')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Question 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: 'Go' }))
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(await content().findByRole('status')).toHaveTextContent('Wrong')
    expect(screen.getByText('Red means stop.')).toBeInTheDocument()
    const right = screen.getByRole('radio', { name: /Stop/ }).closest('label')!
    expect(right).toHaveClass('right')
    expect(within(right).getByText('Correct answer')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Go/ }).closest('label')).toHaveClass('wrong')
    expect(state.practice[state.banks[0].questions[0].id]).toEqual({ last_correct: false, times_wrong: 1 })

    await user.click(screen.getByRole('button', { name: 'Back to topics' }))
    const wrongSet = await screen.findByRole('button', { name: /Got wrong.*1 question/ })
    await waitFor(() => expect(wrongSet).toBeEnabled())
    await user.click(wrongSet)
    expect(await screen.findByText('What does a red light mean?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('shows Right for a right answer and moves with Next and Previous', async () => {
    setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    await user.click(await screen.findByRole('button', { name: /Chapter 1/ }))
    await user.click(await screen.findByRole('radio', { name: 'Stop' }))
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(await content().findByRole('status')).toHaveTextContent('Right')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Critical one')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    // The earlier answer is still shown.
    expect(content().getByRole('status')).toHaveTextContent('Right')
  })

  it('marks critical questions with a Critical badge', async () => {
    setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    await user.click(await screen.findByRole('button', { name: /Critical questions/ }))
    const card = await screen.findByRole('article', { name: 'Question 2' })
    expect(within(card).getByText('Critical')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to topics' }))
    await user.click(await screen.findByRole('button', { name: /Chapter 1/ }))
    // Question 1 is not critical.
    expect(screen.queryByText('Critical')).not.toBeInTheDocument()
  })

  it('shows the picture of a question and its text as plain text', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    await user.click(await screen.findByRole('button', { name: /Chapter 2/ }))
    const img = await screen.findByRole('img', { name: 'Question 3 picture' })
    expect(img).toHaveAttribute('src', `/api/questions/${state.banks[0].questions[2].id}/image`)
    expect(screen.getByText('Look at <b>this</b> sign')).toBeInTheDocument()
    expect(document.querySelector('.question-text b')).toBeNull()
  })

  it('works with the keyboard: arrows pick an option, Enter checks', async () => {
    setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    await user.click(await screen.findByRole('button', { name: /Chapter 1/ }))
    const first = await screen.findByRole('radio', { name: 'Go' })
    first.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: 'Stop' })).toBeChecked()
    screen.getByRole('button', { name: 'Check' }).focus()
    await user.keyboard('{Enter}')
    expect(await content().findByRole('status')).toHaveTextContent('Right')
  })
})

describe('start a test and the history', () => {
  const finished = (state: FakeState, extra: Partial<FakeExam>): FakeExam => ({
    id: 'old-1',
    bank_id: state.banks[0].id,
    mine: true,
    question_ids: state.banks[0].questions.map((q) => q.id),
    answers: {},
    started_at: '2026-11-10T09:00:00Z',
    deadline: '2026-11-10T09:20:00Z',
    submitted_at: '2026-11-10T09:15:00Z',
    score: 2,
    passed: false,
    failed_on_critical: [],
    ...extra,
  })

  it('lists past tests with score and result, linking to each', async () => {
    const state = setup()
    state.exams.push(
      finished(state, { id: 'old-1', score: 3, passed: true }),
      finished(state, { id: 'old-2', score: 1, passed: false, started_at: '2026-11-09T09:00:00Z' }),
    )
    await renderAppReady('#/practice/driving-b')
    const history = await screen.findByRole('list', { name: 'Past tests' })
    const links = within(history).getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveTextContent('3/3')
    expect(links[0]).toHaveTextContent('Passed')
    expect(links[0]).toHaveAttribute('href', '#/exam/old-1')
    expect(links[1]).toHaveTextContent('1/3')
    expect(links[1]).toHaveTextContent('Failed')
  })

  it('says there are no tests yet, and Start a test opens the test page', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    expect(await screen.findByText('No tests yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start a test' }))
    expect(await screen.findByRole('timer', { name: 'Time left' })).toBeInTheDocument()
    expect(window.location.hash).toBe(`#/exam/${state.exams[0].id}`)
  })
})
