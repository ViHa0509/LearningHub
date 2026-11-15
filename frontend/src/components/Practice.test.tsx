/** Spec: practice-exams - Import a question bank, Practice by topic, Test history. */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
    expect(screen.getByRole('link', { name: 'Practice' })).toHaveAttribute('href', '#/practice/driving-b')
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

const grid = () => within(screen.getByRole('navigation', { name: 'Questions' }))
const cell = (n: number) => grid().getByRole('button', { name: new RegExp(`^Question ${n}(,|$)`) })

describe('practice page', () => {
  it('shows the sets as tabs with counts, and Got wrong and Bookmarked disabled while empty', async () => {
    const state = setup()
    const ids = state.banks[0].questions.map((q) => q.id)
    state.practice[ids[0]] = { last_correct: true, times_wrong: 0, last_choice: 2 }
    await renderAppReady('#/practice/driving-b')
    const tabs = await screen.findByRole('tablist', { name: 'Sets' })
    const names = within(tabs)
      .getAllByRole('tab')
      .map((t) => t.textContent)
    expect(names).toEqual(['All 3', 'Chapter 1 2', 'Chapter 2 1', 'Critical 1', 'Got wrong 0', 'Bookmarked 0'])
    expect(within(tabs).getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(tabs).getByRole('tab', { name: /Got wrong/ })).toBeDisabled()
    expect(within(tabs).getByRole('tab', { name: /Bookmarked/ })).toBeDisabled()
    expect(within(tabs).getByRole('tab', { name: /Critical/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Start a test' })).toBeInTheDocument()
  })

  it('colours the grid: right is green, wrong yellow, critical carries its mark, the current is outlined', async () => {
    const state = setup()
    const ids = state.banks[0].questions.map((q) => q.id)
    state.practice[ids[0]] = { last_correct: true, times_wrong: 0, last_choice: 2 }
    state.practice[ids[1]] = { last_correct: false, times_wrong: 1, last_choice: 2 }
    await renderAppReady('#/practice/driving-b')
    await screen.findByRole('navigation', { name: 'Questions' })
    expect(cell(1)).toHaveClass('right', 'current')
    expect(cell(1)).toHaveAttribute('aria-current', 'true')
    expect(cell(1)).toHaveAttribute('aria-label', 'Question 1, right')
    expect(cell(2)).toHaveClass('wrong', 'critical')
    expect(cell(2)).toHaveAttribute('aria-label', 'Question 2, wrong, critical')
    expect(cell(3).className).toBe('')
    expect(cell(3)).toHaveAttribute('aria-label', 'Question 3')
    expect(cell(3)).toHaveTextContent('3')
  })

  it('marks a critical question that was not answered', async () => {
    setup()
    await renderAppReady('#/practice/driving-b')
    await screen.findByRole('navigation', { name: 'Questions' })
    expect(cell(2)).toHaveClass('critical')
    expect(cell(2)).not.toHaveClass('right')
    expect(cell(2)).not.toHaveClass('wrong')
    expect(cell(2)).toHaveAttribute('aria-label', 'Question 2, critical')
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

  it('choosing a topic shows only its numbers; choosing a number opens that question', async () => {
    setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    await user.click(await screen.findByRole('tab', { name: /Chapter 2/ }))
    await waitFor(() => expect(grid().getAllByRole('button')).toHaveLength(1))
    expect(cell(3)).toBeInTheDocument()
    expect(await screen.findByText('Look at <b>this</b> sign')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /^All/ }))
    await user.click(await screen.findByRole('button', { name: 'Question 2, critical' }))
    expect(await screen.findByText('Critical one')).toBeInTheDocument()
    expect(cell(2)).toHaveClass('current')
    expect(cell(1)).not.toHaveClass('current')
  })

  it('a wrong answer shows the correct option, turns the number yellow and lists it in Got wrong', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/practice/driving-b')
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
    expect(state.practice[state.banks[0].questions[0].id]).toEqual({ last_correct: false, times_wrong: 1, last_choice: 1 })
    expect(cell(1)).toHaveClass('wrong')

    const wrongTab = await screen.findByRole('tab', { name: /Got wrong 1/ })
    await waitFor(() => expect(wrongTab).toBeEnabled())
    await user.click(wrongTab)
    await waitFor(() => expect(grid().getAllByRole('button')).toHaveLength(1))
    expect(cell(1)).toHaveClass('wrong')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('answering a wrong question right turns it green and takes it out of Got wrong', async () => {
    const state = setup()
    const id = state.banks[0].questions[0].id
    state.practice[id] = { last_correct: false, times_wrong: 1, last_choice: 1 }
    const { user } = await renderAppReady('#/practice/driving-b')
    await screen.findByRole('navigation', { name: 'Questions' })
    expect(cell(1)).toHaveClass('wrong')
    await user.click(screen.getByRole('radio', { name: /Stop/ }))
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(await content().findByRole('status')).toHaveTextContent('Right')
    expect(cell(1)).toHaveClass('right')
    expect(cell(1)).not.toHaveClass('wrong')
    expect(state.practice[id].last_choice).toBe(2)
    await waitFor(() => expect(screen.getByRole('tab', { name: /Got wrong/ })).toBeDisabled())
  })

  it('shows Right for a right answer and moves with Next and Previous', async () => {
    setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    await user.click(await screen.findByRole('radio', { name: 'Stop' }))
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(await content().findByRole('status')).toHaveTextContent('Right')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Critical one')).toBeInTheDocument()
    expect(cell(2)).toHaveClass('current')
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    // The saved answer is shown again, marked right.
    expect(screen.getByRole('radio', { name: /Stop/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Stop/ }).closest('label')).toHaveClass('right')
  })

  it('opens an answered question with its option selected and marked, without the correct option', async () => {
    const state = setup()
    const id = state.banks[0].questions[0].id
    state.practice[id] = { last_correct: false, times_wrong: 1, last_choice: 1 }
    const { user } = await renderAppReady('#/practice/driving-b')
    await screen.findByRole('navigation', { name: 'Questions' })
    const go = screen.getByRole('radio', { name: /Go/ })
    expect(go).toBeChecked()
    expect(go.closest('label')).toHaveClass('wrong')
    expect(screen.getByRole('radio', { name: /Stop/ }).closest('label')).not.toHaveClass('right')
    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument()
    expect(screen.queryByText('Red means stop.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check' })).toBeEnabled()
    // Check again with the same option: the correct option is shown now.
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('Red means stop.')).toBeInTheDocument()
  })

  it('shuffles the set once: every question stays, the grid keeps the bank numbers, and it starts at the first of the new order', async () => {
    setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    await screen.findByRole('navigation', { name: 'Questions' })
    // Math.random() = 0 makes the order 2, 3, 1.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    await user.click(screen.getByRole('button', { name: 'Shuffle' }))
    random.mockRestore()
    const numbers = grid()
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect([...numbers].sort()).toEqual(['1', '2', '3'])
    expect(numbers).not.toEqual(['1', '2', '3'])
    expect(grid().getAllByRole('button')[0]).toHaveClass('current')
    expect(screen.getByRole('heading', { name: `Question ${numbers[0]}` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  })

  it('marks critical questions with a Critical badge', async () => {
    setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    await user.click(await screen.findByRole('tab', { name: /Critical/ }))
    const card = await screen.findByRole('article', { name: 'Question 2' })
    expect(within(card).getByText('Critical')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /Chapter 2/ }))
    // Question 3 is not critical.
    const plain = await screen.findByRole('article', { name: 'Question 3' })
    expect(within(plain).queryByText('Critical')).not.toBeInTheDocument()
  })

  it('bookmarks a question, lists it in Bookmarked, and removing the bookmark empties the set', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    await user.click(await screen.findByRole('button', { name: 'Question 2, critical' }))
    const toggle = await screen.findByRole('button', { name: 'Bookmark' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(state.bookmarks.has(state.banks[0].questions[1].id)).toBe(true)

    const tab = await screen.findByRole('tab', { name: /Bookmarked 1/ })
    await waitFor(() => expect(tab).toBeEnabled())
    await user.click(tab)
    await waitFor(() => expect(grid().getAllByRole('button')).toHaveLength(1))
    expect(cell(2)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Bookmark' }))
    expect(state.bookmarks.size).toBe(0)
    await user.click(screen.getByRole('tab', { name: /^All/ }))
    await waitFor(() => expect(screen.getByRole('tab', { name: /Bookmarked 0/ })).toBeDisabled())
  })

  it('shows the picture of a question and its text as plain text', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    await user.click(await screen.findByRole('tab', { name: /Chapter 2/ }))
    const img = await screen.findByRole('img', { name: 'Question 3 picture' })
    expect(img).toHaveAttribute('src', `/api/questions/${state.banks[0].questions[2].id}/image`)
    expect(screen.getByText('Look at <b>this</b> sign')).toBeInTheDocument()
    expect(document.querySelector('.question-text b')).toBeNull()
  })

  it('works with the keyboard: arrows pick an option, Enter checks', async () => {
    setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    const first = await screen.findByRole('radio', { name: 'Go' })
    first.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: 'Stop' })).toBeChecked()
    screen.getByRole('button', { name: 'Check' }).focus()
    await user.keyboard('{Enter}')
    expect(await content().findByRole('status')).toHaveTextContent('Right')
  })
})

describe('area without a bank', () => {
  it('tells the owner there are no banks and offers Import questions that works', async () => {
    const state = setup({ bank: false })
    const { user } = await renderAppReady('#/practice/driving-b')
    expect(await screen.findByText('This area has no question banks yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import questions' })).toBeInTheDocument()
    await user.upload(screen.getByLabelText('Question bank file'), file('bank.json', bankFile))
    // The page turns into the browser of the new bank (the message goes with the import form).
    expect(await screen.findByRole('heading', { name: 'Imported bank' })).toBeInTheDocument()
    expect(state.bankImports).toEqual(['bank.json'])
    expect(await screen.findByRole('navigation', { name: 'Questions' })).toBeInTheDocument()
  })

  it('lists the problems of a bad file and stores nothing', async () => {
    const state = setup({ bank: false })
    const { user } = await renderAppReady('#/practice/driving-b')
    await screen.findByRole('button', { name: 'Import questions' })
    const bad = { ...bankFile, questions: [{ number: 1, topic: 'nope', text: 'One?', options: ['a', 'b'], answer: 1 }] }
    await user.upload(screen.getByLabelText('Question bank file'), file('bad.json', bad))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/Question 1: topic nope/)).toBeInTheDocument()
    expect(state.banks).toHaveLength(0)
  })

  it('shows a member the message without the import', async () => {
    setup({ bank: false, mine: false })
    await renderAppReady('#/practice/driving-b')
    expect(await screen.findByText('This area has no question banks yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import questions' })).not.toBeInTheDocument()
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
