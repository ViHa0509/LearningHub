/** Spec: app-search - Search box in the top bar; Opening a search result; Search on a phone. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchResult } from '../api'
import { setLeaveGuard } from '../lib/route'
import { installFakeApi, type FakeState } from '../test/fakeApi'
import { TopSearch } from './TopSearch'

const found: SearchResult = {
  query: 'cach',
  topics: [{ node_id: 'backend/caching', title: 'Caching', domain_title: 'Backend' }],
  lessons: [
    {
      node_id: 'backend/redis',
      title: 'Redis',
      domain_title: 'Backend',
      source: 'user',
      snippet: '…use a TTL so stale entries expire…',
    },
  ],
  notes: [{ id: 'note-7', title: 'Cache notes', node_id: null, snippet: '…write-through…' }],
}

let fake: FakeState

const searchCalls = () => fake.calls.filter((c) => c.url.startsWith('/api/search'))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function setup(props: Parameters<typeof TopSearch>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TopSearch {...props} />
    </QueryClientProvider>,
  )
  return { user: userEvent.setup(), box: screen.getByRole('combobox') }
}

beforeEach(() => {
  window.location.hash = '#/'
  setLeaveGuard(null)
  fake = installFakeApi()
  fake.search = (q) => ({ ...found, query: q })
})

afterEach(() => {
  vi.unstubAllGlobals()
  setLeaveGuard(null)
})

describe('TopSearch requests', () => {
  it('sends no request for fewer than 2 characters and shows no dropdown', async () => {
    const { user, box } = setup()
    await user.type(box, 'a')
    await sleep(400)
    expect(searchCalls()).toHaveLength(0)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(box).toHaveAttribute('aria-expanded', 'false')
  })

  it('waits for the typing to pause: one request with the whole text', async () => {
    const { user, box } = setup()
    await user.type(box, 'cach')
    expect(searchCalls()).toHaveLength(0)
    await screen.findByRole('listbox')
    expect(searchCalls().map((c) => c.url)).toEqual(['/api/search?q=cach'])
  })

  it('trims the text and encodes it', async () => {
    const { user, box } = setup()
    await user.type(box, '  a&b ')
    await screen.findByRole('listbox')
    expect(searchCalls().map((c) => c.url)).toEqual(['/api/search?q=a%26b'])
  })
})

describe('TopSearch dropdown', () => {
  it('shows Topics, Lessons and Notes as one listbox with the combobox pattern', async () => {
    const { user, box } = setup()
    await user.type(box, 'cach')
    const list = await screen.findByRole('listbox')
    expect(box).toHaveAttribute('aria-expanded', 'true')
    expect(box).toHaveAttribute('aria-controls', list.id)
    for (const heading of ['Topics', 'Lessons', 'Notes']) expect(within(list).getByText(heading)).toBeInTheDocument()
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'CachingBackend',
      'RedisBackend…use a TTL so stale entries expire…',
      'Cache notes…write-through…',
    ])
  })

  it('leaves out the headings of empty groups', async () => {
    fake.search = (q) => ({ query: q, topics: [], lessons: [], notes: found.notes })
    const { user, box } = setup()
    await user.type(box, 'cach')
    const list = await screen.findByRole('listbox')
    expect(within(list).getByText('Notes')).toBeInTheDocument()
    expect(within(list).queryByText('Topics')).not.toBeInTheDocument()
    expect(within(list).queryByText('Lessons')).not.toBeInTheDocument()
  })

  it('says "No results for “qqzzxx”" when every group is empty', async () => {
    fake.search = (q) => ({ query: q, topics: [], lessons: [], notes: [] })
    const { user, box } = setup()
    await user.type(box, 'qqzzxx')
    expect(await screen.findByText('No results for “qqzzxx”')).toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('shows a markup title as text and creates no image', async () => {
    const title = '<img src=x onerror=alert(1)>'
    fake.search = (q) => ({
      query: q,
      topics: [],
      lessons: [],
      notes: [{ id: 'note-9', title, node_id: null, snippet: '<b>bold</b> **star**' }],
    })
    const { user, box } = setup()
    await user.type(box, 'img')
    const list = await screen.findByRole('listbox')
    expect(within(list).getByText(title)).toBeInTheDocument()
    expect(within(list).getByText('<b>bold</b> **star**')).toBeInTheDocument()
    expect(list.querySelector('img')).toBeNull()
    expect(list.querySelector('b')).toBeNull()
  })
})

describe('TopSearch keyboard', () => {
  it('moves the highlight across the groups with Arrow Down and Up, and wraps', async () => {
    const { user, box } = setup()
    await user.type(box, 'cach')
    await screen.findByRole('listbox')
    const options = screen.getAllByRole('option')
    await user.keyboard('{ArrowDown}')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(box).toHaveAttribute('aria-activedescendant', options[0].id)
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(options[2]).toHaveAttribute('aria-selected', 'true')
    expect(box).toHaveAttribute('aria-activedescendant', options[2].id)
    await user.keyboard('{ArrowDown}')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowUp}')
    expect(options[2]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowUp}')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('opens the highlighted note with Enter and clears and closes the box', async () => {
    const { user, box } = setup()
    await user.type(box, 'cach')
    await screen.findByRole('listbox')
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')
    expect(window.location.hash).toBe('#/note/note-7')
    expect(box).toHaveValue('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('does nothing on Enter while no result is highlighted', async () => {
    const { user, box } = setup()
    await user.type(box, 'cach')
    await screen.findByRole('listbox')
    await user.keyboard('{Enter}')
    expect(window.location.hash).toBe('#/')
    expect(box).toHaveValue('cach')
  })

  it('closes with Escape, keeps the text and the page', async () => {
    const { user, box } = setup()
    await user.type(box, 'cach')
    await screen.findByRole('listbox')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(box).toHaveValue('cach')
    expect(window.location.hash).toBe('#/')
  })

  it('closes on a click outside', async () => {
    const { user, box } = setup()
    await user.type(box, 'cach')
    await screen.findByRole('listbox')
    await user.click(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(box).toHaveValue('cach')
  })
})

describe('TopSearch opening a result', () => {
  it('opens a topic on its lesson page', async () => {
    const { user, box } = setup()
    await user.type(box, 'cach')
    await user.click(await screen.findByRole('option', { name: /^Caching/ }))
    expect(window.location.hash).toBe('#/lesson/backend/caching')
    expect(box).toHaveValue('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens a lesson result on its lesson page', async () => {
    const { user, box } = setup()
    await user.type(box, 'cach')
    await user.click(await screen.findByRole('option', { name: /^Redis/ }))
    expect(window.location.hash).toBe('#/lesson/backend/redis')
    expect(box).toHaveValue('')
  })

  it('opens a note result on its note page', async () => {
    const { user, box } = setup()
    await user.type(box, 'cach')
    await user.click(await screen.findByRole('option', { name: /^Cache notes/ }))
    expect(window.location.hash).toBe('#/note/note-7')
    expect(box).toHaveValue('')
  })

  it('keeps the box when the open page asks to stay (unsaved changes)', async () => {
    setLeaveGuard(() => false)
    const { user, box } = setup()
    await user.type(box, 'cach')
    await user.click(await screen.findByRole('option', { name: /^Cache notes/ }))
    expect(window.location.hash).toBe('#/')
    expect(box).toHaveValue('cach')
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument())
  })
})

describe('TopSearch phone row', () => {
  it('focuses the input, and the close button and Escape on an empty field call onClose', async () => {
    const onClose = vi.fn()
    const { user, box } = setup({ autoFocus: true, onClose })
    expect(box).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Close search' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('does not hide the row on Escape while the field holds text', async () => {
    const onClose = vi.fn()
    const { user, box } = setup({ autoFocus: true, onClose })
    await user.type(box, 'cach')
    await screen.findByRole('listbox')
    await user.keyboard('{Escape}')
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('hides the row after a result opens', async () => {
    const onClose = vi.fn()
    const { user, box } = setup({ autoFocus: true, onClose })
    await user.type(box, 'cach')
    await user.click(await screen.findByRole('option', { name: /^Caching/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
