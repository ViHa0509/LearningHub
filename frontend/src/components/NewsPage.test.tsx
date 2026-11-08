/** Spec: ai-news - News page (Read and open, Ask the agent, First visit), Refresh the news. All items are synthetic. */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NEWS_PAGE_SIZE } from '../hooks'
import { installFakeApi, makeNewsItem, twoProviders } from '../test/fakeApi'
import { renderApp } from '../test/render'

const page = () => screen.findByRole('region', { name: 'AI news' })
// The refresh status is read every 1.5 s while running.
const POLL_WAIT = { timeout: 4000 }

/** Local times: today just after midnight, yesterday at noon, and a fixed older date. */
function days() {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 30)
  const todayLater = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 45)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12)
  const older = new Date(2025, 10, 5, 9)
  return { today, todayLater, yesterday, older }
}

const newsCalls = (state: ReturnType<typeof installFakeApi>) =>
  state.calls.filter((c) => c.method === 'GET' && (c.url === '/api/news' || c.url.startsWith('/api/news?')))

describe('news page', () => {
  it('is reached from the top bar', async () => {
    installFakeApi()
    const { user } = renderApp()
    const link = await screen.findByRole('link', { name: 'News' })
    expect(link).toHaveAttribute('href', '#/news')
    await user.click(link)
    expect(await page()).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'AI news' })).toBeInTheDocument()
  })

  // Scenario: Read and open
  it('groups items by day, newest first, with safe links in a new tab', async () => {
    const state = installFakeApi()
    const { today, todayLater, yesterday, older } = days()
    state.news = [
      makeNewsItem('Synthetic older story', 'mit-news', older, 'Old summary.'),
      makeNewsItem('Synthetic morning story', 'openai-news', today, 'Morning summary.'),
      makeNewsItem('Synthetic yesterday story', 'mit-news', yesterday),
      makeNewsItem('Synthetic later story', 'mit-news', todayLater),
    ]
    renderApp('#/news')
    const region = await page()
    await within(region).findByRole('link', { name: 'Synthetic later story' })

    expect(within(region).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Today',
      'Yesterday',
      'Nov 5, 2025',
    ])
    const todayGroup = within(region).getByRole('region', { name: 'Today' })
    expect(within(todayGroup).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Synthetic later story',
      'Synthetic morning story',
    ])
    for (const link of within(region).getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
    const morning = within(todayGroup).getAllByRole('listitem')[1]
    expect(morning).toHaveTextContent('OpenAI News')
    expect(morning).toHaveTextContent('12:30 AM')
    expect(morning).toHaveTextContent('Morning summary.')
    expect(within(morning).getByRole('link')).toHaveAttribute('href', state.news[1].url)
    // Not stale and items stored: no refresh starts by itself.
    expect(state.calls.some((c) => c.method === 'POST' && c.url === '/api/news/refresh')).toBe(false)
  })

  it('shows titles and summaries as text, never as HTML', async () => {
    const state = installFakeApi()
    state.news = [
      makeNewsItem('<img src=x onerror="window.__news=1">Bold', 'mit-news', days().today, '<b>not bold</b>'),
    ]
    renderApp('#/news')
    const region = await page()
    await within(region).findByRole('link', { name: /Bold/ })
    expect(region.querySelector('img')).toBeNull()
    expect(region.querySelector('b')).toBeNull()
    expect(within(region).getByText('<b>not bold</b>')).toBeInTheDocument()
    expect((window as unknown as { __news?: number }).__news).toBeUndefined()
  })

  it('filters by source chip and by text, asking the server', async () => {
    const state = installFakeApi()
    const { today, yesterday } = days()
    state.news = [
      makeNewsItem('Synthetic robot arm', 'mit-news', today),
      makeNewsItem('Synthetic model release', 'openai-news', today),
      makeNewsItem('Synthetic lab tour', 'mit-news', yesterday),
    ]
    const { user } = renderApp('#/news')
    const region = await page()
    const chips = await within(region).findByRole('group', { name: 'Sources' })
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'All 3',
      'OpenAI News 1',
      'MIT News 2',
    ])
    expect(within(chips).getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(chips).getByRole('button', { name: 'MIT News 2' }))
    await waitFor(() => expect(within(region).queryByRole('link', { name: 'Synthetic model release' })).toBeNull())
    expect(within(chips).getByRole('button', { name: 'MIT News 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(chips).getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'false')
    const bySource = new URL(newsCalls(state).at(-1)!.url, 'http://x').searchParams
    expect(bySource.get('source')).toBe('mit-news')
    expect(bySource.get('q')).toBeNull()

    await user.type(within(region).getByRole('searchbox', { name: 'Filter news' }), 'robot')
    await waitFor(() => expect(within(region).queryByRole('link', { name: 'Synthetic lab tour' })).toBeNull())
    expect(within(region).getByRole('link', { name: 'Synthetic robot arm' })).toBeInTheDocument()
    const both = new URL(newsCalls(state).at(-1)!.url, 'http://x').searchParams
    expect(both.get('source')).toBe('mit-news')
    expect(both.get('q')).toBe('robot')
  })

  // Scenario: First visit
  it('refreshes by itself on a first visit, shows progress, then the items without a reload', async () => {
    const state = installFakeApi()
    state.newsStale = true
    state.newsLastRefreshAt = null
    state.newsRefreshOutcome = {
      items: [
        makeNewsItem('Synthetic fresh headline', 'openai-news', days().today),
        makeNewsItem('Synthetic campus news', 'mit-news', days().today),
      ],
    }
    renderApp('#/news')
    const region = await page()
    expect(await within(region).findByText('No news yet.')).toBeInTheDocument()
    expect(await within(region).findByRole('status')).toHaveTextContent('Refreshing news… (0 of 2 sources)')
    expect(within(region).getByRole('button', { name: 'Refresh' })).toBeDisabled()
    const post = state.calls.findIndex((c) => c.method === 'POST' && c.url === '/api/news/refresh')
    expect(post).toBeGreaterThan(-1)
    expect(state.headers[post]['X-LearningHub']).toBe('1')

    expect(await within(region).findByRole('link', { name: 'Synthetic fresh headline' }, POLL_WAIT)).toBeInTheDocument()
    expect(within(region).getByRole('link', { name: 'Synthetic campus news' })).toBeInTheDocument()
    expect(within(region).queryByRole('status')).not.toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Refresh' })).toBeEnabled()
    expect(within(region).getByText(/^Last refreshed/)).toBeInTheDocument()
    // Once per visit.
    expect(state.calls.filter((c) => c.method === 'POST' && c.url === '/api/news/refresh')).toHaveLength(1)
  })

  // Scenario: Refresh with one failing source
  it('names the failed source and its reason after a refresh', async () => {
    const state = installFakeApi()
    state.news = [makeNewsItem('Synthetic stored item', 'mit-news', days().yesterday)]
    state.newsRefreshOutcome = {
      items: [makeNewsItem('Synthetic new campus item', 'mit-news', days().today)],
      failures: { 'openai-news': 'the source answered 500' },
    }
    const { user } = renderApp('#/news')
    const region = await page()
    await within(region).findByRole('link', { name: 'Synthetic stored item' })

    await user.click(within(region).getByRole('button', { name: 'Refresh' }))
    expect(await within(region).findByRole('status')).toHaveTextContent('Refreshing news…')
    expect(await within(region).findByRole('link', { name: 'Synthetic new campus item' }, POLL_WAIT)).toBeInTheDocument()
    const failed = within(region).getByRole('list', { name: 'Failed sources' })
    expect(failed).toHaveTextContent('OpenAI News: the source answered 500')
    expect(within(failed).getAllByRole('listitem')).toHaveLength(1)
    expect(within(region).getByText('Some sources could not be read:')).toBeInTheDocument()
    expect(within(region).queryByRole('alert')).not.toBeInTheDocument()
  })

  // Scenario: Ask the agent
  it('puts the item in the chat input without sending it', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const item = makeNewsItem('Synthetic agent story', 'openai-news', days().today)
    state.news = [item]
    const { user } = renderApp('#/news')
    const region = await page()
    const card = (await within(region).findByRole('link', { name: 'Synthetic agent story' })).closest('li')!
    const agent = screen.getByRole('complementary', { name: 'Agent' })
    const input = await within(agent).findByRole('textbox', { name: 'Message the agent' })

    await user.click(within(card).getByRole('button', { name: 'Ask the agent' }))
    await waitFor(() =>
      expect(input).toHaveValue(`Explain this news for me: Synthetic agent story (${item.url})`),
    )
    expect(input).toHaveFocus()
    expect(state.calls.some((c) => c.url === '/api/agent/chat')).toBe(false)
  })

  it('loads more items before the last one shown', async () => {
    const state = installFakeApi()
    const base = days().today.getTime()
    // One full page and one more, a minute apart, newest first by index.
    state.news = Array.from({ length: NEWS_PAGE_SIZE + 1 }, (_, i) =>
      makeNewsItem(`Synthetic item ${i}`, 'mit-news', new Date(base - i * 60_000)),
    )
    const { user } = renderApp('#/news')
    const region = await page()
    await within(region).findByRole('link', { name: 'Synthetic item 0' })
    expect(within(region).queryByRole('link', { name: `Synthetic item ${NEWS_PAGE_SIZE}` })).toBeNull()

    await user.click(within(region).getByRole('button', { name: 'Load more' }))
    expect(
      await within(region).findByRole('link', { name: `Synthetic item ${NEWS_PAGE_SIZE}` }),
    ).toBeInTheDocument()
    const params = new URL(newsCalls(state).at(-1)!.url, 'http://x').searchParams
    expect(params.get('before')).toBe(state.news[NEWS_PAGE_SIZE - 1].published_at)
    expect(params.get('limit')).toBe(String(NEWS_PAGE_SIZE))
    expect(within(region).getAllByRole('link')).toHaveLength(NEWS_PAGE_SIZE + 1)
    // The last page was not full: nothing more to load.
    await waitFor(() => expect(within(region).queryByRole('button', { name: 'Load more' })).toBeNull())
  })
})
