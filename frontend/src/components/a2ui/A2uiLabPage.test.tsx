/** Spec: a2ui-lab - editor, samples, inspector, draft, small screens. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys, type Me } from '../../api'
import { resetScreenClass, setScreenClass } from '../../test/screenClass'
import A2uiLabPage from './A2uiLabPage'

const me: Me = {
  id: 'u1',
  role: 'admin',
  email: 'ada@example.com',
  email_verified: true,
  display_name: 'Ada',
  bio: null,
  avatar_url: null,
  has_password: true,
  linked: [],
}

const HELLO = [
  {
    version: 'v0.9',
    createSurface: { surfaceId: 'hello', catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json' },
  },
  {
    version: 'v0.9',
    updateComponents: { surfaceId: 'hello', components: [{ id: 'root', component: 'Text', text: { path: '/title' } }] },
  },
  { version: 'v0.9', updateDataModel: { surfaceId: 'hello', path: '/title', value: 'Hello' } },
]

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.me, me)
  const user = userEvent.setup()
  const view = render(
    <QueryClientProvider client={client}>
      <A2uiLabPage />
    </QueryClientProvider>,
  )
  return { user, ...view }
}

const editor = () => screen.getByRole('textbox', { name: 'A2UI messages', hidden: true }) as HTMLTextAreaElement
const type = (value: string) => fireEvent.change(editor(), { target: { value } })
const KEY = 'lh.a2uiLab.draft.u1'

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  resetScreenClass()
  vi.restoreAllMocks()
})

describe('A2UI Lab page', () => {
  it('shows the editor, an empty preview and the inspector', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'A2UI Lab' })).toBeInTheDocument()
    expect(editor()).toBeInTheDocument()
    expect(screen.getByText(/local playground with no agent/, { selector: '.a2ui-empty' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Log' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Data model' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Errors' })).toBeInTheDocument()
  })

  it('disables Send while the editor is empty or only whitespace', () => {
    mount()
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()
    type('   \n  ')
    expect(send).toBeDisabled()
    type('{}')
    expect(send).toBeEnabled()
  })

  it('shows a JSON error with its position and processes nothing', async () => {
    const { user } = mount()
    type('{"version": "v0.9",')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/Invalid JSON/)
    expect(alert).toHaveTextContent(/line \d+, column \d+/)
    expect(screen.getByText(/local playground with no agent/, { selector: '.a2ui-empty' })).toBeInTheDocument()
    expect(screen.getByText('The log is empty.')).toBeInTheDocument()
  })

  it('sends messages, logs them in order with their direction, and shows the data model', async () => {
    const { user } = mount()
    type(JSON.stringify(HELLO))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'hello' })).toBeInTheDocument())
    const entries = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(entries).toHaveLength(3)
    expect(entries[0]).toHaveTextContent('agent→renderer')
    expect(entries[0]).toHaveTextContent('editor')
    expect(entries[0]).toHaveTextContent('"createSurface"')
    expect(entries[2]).toHaveTextContent('"updateDataModel"')
    await user.click(screen.getByRole('tab', { name: 'Data model' }))
    expect(screen.getByText('hello', { selector: 'h3' })).toBeInTheDocument()
    expect(screen.getByText(/"title": "Hello"/)).toBeInTheDocument()
  })

  it('names the message index in the Errors tab and counts errors in its label', async () => {
    const { user } = mount()
    type(
      JSON.stringify([
        HELLO[0],
        {
          version: 'v0.9',
          updateComponents: { surfaceId: 'hello', components: [{ id: 'root', component: 'Carousel' }] },
        },
      ]),
    )
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await user.click(await screen.findByRole('tab', { name: /^Errors \(\d+\)$/ }))
    expect(screen.getByText(/Message 2:/)).toHaveTextContent(/Message 2: .*Carousel/)
  })

  it('Next step advances the counter and the editor, and is disabled after the last step', async () => {
    const { user } = mount()
    await user.selectOptions(screen.getByLabelText('Sample'), 'hello')
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument()
    expect(editor().value).toContain('createSurface')
    await user.click(screen.getByRole('button', { name: 'Next step' }))
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument()
    expect(editor().value).toContain('updateComponents')
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Next step' }))
    await user.click(screen.getByRole('button', { name: 'Next step' }))
    expect(screen.getByText('Sample done (3 steps)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next step' })).toBeDisabled()
  })

  it('writes "1 step" in the singular when a sample has one step', async () => {
    const { user } = mount()
    await user.selectOptions(screen.getByLabelText('Sample'), 'form')
    expect(screen.getByText('Step 1 of 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next step' }))
    expect(screen.getByText('Sample done (1 step)')).toBeInTheDocument()
  })

  it('asks before replacing a changed draft with a sample, and Cancel keeps the text', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = mount()
    type('my own draft')
    await user.selectOptions(screen.getByLabelText('Sample'), 'form')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(editor().value).toBe('my own draft')
    expect(screen.getByText('No sample loaded')).toBeInTheDocument()
    confirm.mockReturnValue(true)
    await user.selectOptions(screen.getByLabelText('Sample'), 'form')
    expect(editor().value).toContain('createSurface')
  })

  it('does not ask when the text is unchanged since the last load', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = mount()
    await user.selectOptions(screen.getByLabelText('Sample'), 'hello')
    await user.selectOptions(screen.getByLabelText('Sample'), 'list')
    expect(confirm).not.toHaveBeenCalled()
    expect(editor().value).toContain('"list"')
  })

  it('Reset clears the log and surfaces but keeps the editor text', async () => {
    const { user } = mount()
    type(JSON.stringify(HELLO))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByRole('heading', { name: 'hello' })
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.queryByRole('heading', { name: 'hello' })).not.toBeInTheDocument()
    expect(screen.getByText('The log is empty.')).toBeInTheDocument()
    expect(editor().value).toBe(JSON.stringify(HELLO))
  })

  it('restores the draft for the user after a remount', async () => {
    const first = mount()
    type('draft text')
    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBe('draft text'))
    first.unmount()
    mount()
    expect(editor().value).toBe('draft text')
    expect(screen.getByText(/local playground with no agent/, { selector: '.a2ui-empty' })).toBeInTheDocument()
  })

  it('keeps working when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { user, unmount } = mount()
    expect(editor().value).toBe('')
    type(JSON.stringify(HELLO))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByRole('heading', { name: 'hello' })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500))
    })
    expect(() => unmount()).not.toThrow()
  })

  it('on a phone shows Editor / Preview / Inspector tabs with one pane, and Send opens Preview', async () => {
    setScreenClass('phone')
    const { user } = mount()
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs.slice(0, 3)).toEqual(['Editor', 'Preview', 'Inspector'])
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true')
    expect(editor()).toBeVisible()
    expect(screen.getByText(/local playground with no agent/, { selector: '.a2ui-empty' })).not.toBeVisible()
    type(JSON.stringify(HELLO))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
    expect(editor()).not.toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Inspector' }))
    expect(screen.getByRole('tab', { name: 'Log' })).toBeVisible()
  })

  it('on a phone Next step switches to Preview', async () => {
    setScreenClass('phone')
    const { user } = mount()
    await user.selectOptions(screen.getByLabelText('Sample'), 'hello')
    await user.click(screen.getByRole('button', { name: 'Next step' }))
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
  })
})
