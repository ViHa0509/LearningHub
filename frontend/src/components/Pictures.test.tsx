/** Spec: practice-exams - Import a question bank (Questions first, pictures after). */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { installFakeApi, makeBank, makeField } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

const MB = 1024 * 1024
const picture = (name: string, bytes: number) => new File([new Uint8Array(bytes)], name, { type: 'image/png' })
const content = () => within(screen.getByRole('main', { name: 'Content' }))

function setup(opts: { mine?: boolean; names?: string[] } = {}) {
  const state = installFakeApi()
  state.fields.push(
    makeField('Driving', [{ slug: 'driving-b', title: 'Driving B', topics: [{ slug: 't1', title: 'Chapter 1' }] }], {
      mine: opts.mine ?? true,
      published: true,
    }),
  )
  const names = opts.names ?? ['a.png', 'b.png', 'c.png']
  state.banks.push(makeBank('driving-b', 'Class B theory', names.map((image) => ({ topic: 't1', image }))))
  return state
}

/** Holds each picture upload until the test lets it go, to see the progress line in between. */
function gateUploads(count: number) {
  const original = globalThis.fetch
  const releases: (() => void)[] = []
  const gates = Array.from({ length: count }, () => new Promise<void>((resolve) => releases.push(resolve)))
  let next = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/images')) await gates[next++]
      return original(input, init)
    }),
  )
  return releases
}

describe('adding pictures to a bank', () => {
  it('sends 3 files of 1.5 MB in 2 requests (3.5 MB at most each), shows the progress, then added and still missing', async () => {
    const state = setup({ names: ['a.png', 'b.png', 'c.png', 'd.png'] })
    const { user } = await renderAppReady('#/practice/driving-b')
    expect(await screen.findByText(/4 pictures missing/)).toBeInTheDocument()
    const release = gateUploads(2)

    await user.upload(screen.getByLabelText('Picture files'), [
      picture('a.png', 1.5 * MB),
      picture('b.png', 1.5 * MB),
      picture('c.png', 1.5 * MB),
    ])
    expect(await screen.findByText('Uploading 2 of 3…')).toBeInTheDocument()
    release[0]()
    expect(await screen.findByText('Uploading 3 of 3…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add pictures' })).toBeDisabled()
    release[1]()
    expect(await content().findByText(/Added 3 pictures\. 1 still missing\./)).toBeInTheDocument()
    expect(state.pictureRequests).toHaveLength(2)
    expect(state.pictureRequests.map((r) => r.length)).toEqual([2, 1])
    expect(await screen.findByText(/1 picture missing/)).toBeInTheDocument()
  })

  it('names the files that match no question', async () => {
    setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    await screen.findByText(/3 pictures missing/)
    await user.upload(screen.getByLabelText('Picture files'), [picture('a.png', 1000), picture('zzz.png', 1000)])
    expect(await content().findByText(/Added 1 picture\. 1 did not match a question: zzz\.png\. 2 still missing\./)).toBeInTheDocument()
  })

  it('sends a file over 3.5 MB alone and shows the answer of the server', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/practice/driving-b')
    await screen.findByText(/3 pictures missing/)
    await user.upload(screen.getByLabelText('Picture files'), [picture('a.png', 1 * MB), picture('b.png', 5 * MB), picture('c.png', 1 * MB)])
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('b.png: the request is too large')
    expect(state.pictureRequests.map((r) => r.join(','))).toEqual(['a.png', 'b.png', 'c.png'])
    expect(await content().findByText(/Added 2 pictures\./)).toBeInTheDocument()
  })

  it('accepts several image files and zips', async () => {
    setup()
    await renderAppReady('#/practice/driving-b')
    const input = await screen.findByLabelText('Picture files')
    expect(input).toHaveAttribute('multiple')
    expect(input).toHaveAttribute('accept', expect.stringContaining('.zip'))
    expect(input).toHaveAttribute('accept', expect.stringContaining('image/png'))
  })

  it('shows a question without its picture as text only, and the picture once added', async () => {
    const state = setup({ names: ['a.png'] })
    const { user } = await renderAppReady('#/practice/driving-b')
    await user.click(await screen.findByRole('tab', { name: /Chapter 1/ }))
    expect(await screen.findByRole('heading', { name: /Question 1/ })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /picture/ })).not.toBeInTheDocument()

    await user.upload(await screen.findByLabelText('Picture files'), picture('a.png', 1000))
    expect(await content().findByText(/Added 1 picture\. 0 still missing\./)).toBeInTheDocument()
    expect(await screen.findByText(/No pictures missing/)).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Question 1 picture' })).toHaveAttribute(
      'src',
      `/api/questions/${state.banks[0].questions[0].id}/image`,
    )
  })

  it('offers the missing pictures only to the owner, on the area page and the practice page', async () => {
    setup()
    const owner = await renderAppReady('#/roadmap/driving-b')
    expect(await screen.findByText(/3 pictures missing/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add pictures' })).toBeInTheDocument()
    owner.unmount()
    await renderAppReady('#/practice/driving-b')
    expect(await screen.findByText(/3 pictures missing/)).toBeInTheDocument()
  })

  it('does not show the prompt to someone who does not own the area', async () => {
    setup({ mine: false })
    const area = await renderAppReady('#/roadmap/driving-b')
    await screen.findByRole('link', { name: 'Practice' })
    expect(screen.queryByText(/pictures missing/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add pictures' })).not.toBeInTheDocument()
    area.unmount()
    await renderAppReady('#/practice/driving-b')
    await screen.findByRole('heading', { name: 'Class B theory' })
    expect(screen.queryByText(/pictures missing/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Picture files')).not.toBeInTheDocument()
  })

  it('says after a JSON import with missing pictures to use Add pictures', async () => {
    const state = installFakeApi()
    state.fields.push(
      makeField('Driving', [{ slug: 'driving-b', title: 'Driving B', topics: [{ slug: 't1', title: 'Chapter 1' }] }]),
    )
    const { user } = await renderAppReady('#/roadmap/driving-b')
    const json = {
      title: 'Questions only',
      rules: { questions: 2, minutes: 5, pass_mark: 1, critical_fails: false, min_critical: 0, per_topic: {} },
      questions: [
        { number: 1, topic: 't1', text: 'One?', options: ['a', 'b'], answer: 1, image: 'q1.png' },
        { number: 2, topic: 't1', text: 'Two?', options: ['a', 'b'], answer: 2, image: 'q2.png' },
      ],
    }
    await screen.findByRole('button', { name: 'Import questions' })
    expect(screen.getByLabelText('Question bank file')).toHaveAttribute('accept', expect.stringContaining('.json'))
    await user.upload(
      screen.getByLabelText('Question bank file'),
      new File([JSON.stringify(json)], 'bank.json', { type: 'application/json' }),
    )
    expect(await content().findByText(/2 pictures are missing: use Add pictures/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add pictures' })).toBeInTheDocument())
    expect(screen.getByText(/2 pictures missing/)).toBeInTheDocument()
  })
})
