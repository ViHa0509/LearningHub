/** Spec: ai-providers (configuration page, validation, test connection, models, info, safe delete). */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderIn, TestStatus } from '../api'
import { installFakeApi, makeProvider, twoProviders, type FakeState } from '../test/fakeApi'
import { renderApp } from '../test/render'

const page = () => screen.findByRole('region', { name: 'Provider configuration' })
const posted = (state: FakeState, method: string, url: string) =>
  state.calls.filter((c) => c.method === method && c.url === url).at(-1)?.body as ProviderIn & Record<string, unknown>

describe('create a provider', () => {
  it('walks from the list to a saved configuration', async () => {
    const state = installFakeApi()
    const { user } = renderApp('#/settings')
    await user.click(await screen.findByRole('link', { name: 'Add provider' }))
    const form = await page()
    expect(screen.getByRole('heading', { name: 'New provider' })).toBeInTheDocument()

    await user.click(within(form).getByRole('radio', { name: 'Anthropic' }))
    expect(within(form).getByLabelText('Model')).toHaveValue('claude-sonnet-5-5')
    await user.type(within(form).getByLabelText('Name'), 'Claude main')
    await user.type(within(form).getByLabelText(/^API key/), 'sk-ant-api03-abcd1234')
    await user.click(within(form).getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(window.location.hash).toBe('#/settings/providers/p1'))
    expect(await screen.findByRole('heading', { name: 'Claude main' })).toBeInTheDocument()
    expect(posted(state, 'POST', '/api/ai-providers')).toEqual({
      name: 'Claude main',
      provider_type: 'anthropic',
      model_name: 'claude-sonnet-5-5',
      api_key: 'sk-ant-api03-abcd1234',
      is_active: true,
      config: {},
    })
    // The saved page shows only the key hint, never the key.
    expect(await screen.findByLabelText(/^API key/)).toHaveAttribute('placeholder', 'Saved key (…1234), type to replace')
  })

  // Spec: ai-providers - Anthropic accepts an API key or a Claude setup token (Kind of key is shown).
  it('asks Anthropic for an API key or a setup token and says which kind is saved', async () => {
    installFakeApi()
    const { user } = renderApp('#/settings/providers/new')
    const form = await page()
    await user.click(within(form).getByRole('radio', { name: 'Anthropic' }))
    const key = within(form).getByLabelText('API key or setup token')
    expect(key).toHaveAccessibleDescription(/claude setup-token/)
    await user.type(within(form).getByLabelText('Name'), 'Claude sub')
    await user.type(key, 'sk-ant-oat01-tokenwxyz')
    await user.click(within(form).getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(window.location.hash).toBe('#/settings/providers/p1'))
    expect(await screen.findByLabelText('API key or setup token')).toHaveAttribute(
      'placeholder',
      'Saved setup token (…wxyz), type to replace',
    )

    await user.click(screen.getByRole('link', { name: /Back to providers/ }))
    await user.click(await screen.findByRole('link', { name: 'Add provider' }))
    await user.click(within(await page()).getByRole('radio', { name: 'OpenAI' }))
    expect(within(await page()).getByLabelText('API key')).toBeInTheDocument()
  })

  it('offers the types as a radio group and prefills the base URL of the chosen type', async () => {
    installFakeApi()
    const { user } = renderApp('#/settings/providers/new')
    const form = await page()
    const group = within(form).getByRole('radiogroup', { name: 'Provider type' })
    expect(within(group).getAllByRole('radio')).toHaveLength(6)
    expect(within(group).getByRole('radio', { name: 'OpenAI' })).toBeChecked()
    expect(within(form).getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1')
    await user.click(within(group).getByRole('radio', { name: 'Local (Ollama, LM Studio)' }))
    expect(within(form).getByLabelText('Base URL')).toHaveValue('http://localhost:11434/v1')
    expect(within(form).getByLabelText('Model')).toHaveValue('gemma3')
  })

  it('shows server field errors under the field', async () => {
    installFakeApi()
    const { user } = renderApp('#/settings/providers/new')
    const form = await page()
    await user.type(within(form).getByLabelText('Name'), 'OpenAI main')
    await user.click(within(form).getByRole('button', { name: 'Save Changes' }))
    const key = within(form).getByLabelText(/^API key/)
    expect(await within(form).findByText('An API key is required')).toBeInTheDocument()
    expect(key).toHaveAttribute('aria-invalid', 'true')
    expect(key).toHaveAccessibleDescription('An API key is required')

    await user.type(key, 'sk-test-abcd1234')
    await user.type(within(form).getByLabelText('Temperature'), '3')
    await user.click(within(form).getByRole('button', { name: 'Save Changes' }))
    expect(await within(form).findByText('Temperature must be between 0 and 2')).toBeInTheDocument()
    expect(within(form).queryByText('An API key is required')).toBeNull()
  })

  it('says the name is taken', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const { user } = renderApp('#/settings/providers/new')
    const form = await page()
    await user.click(within(form).getByRole('radio', { name: 'Anthropic' }))
    await user.type(within(form).getByLabelText('Name'), 'Claude main')
    await user.type(within(form).getByLabelText(/^API key/), 'sk-test-abcd1234')
    await user.click(within(form).getByRole('button', { name: 'Save Changes' }))
    expect(await within(form).findByText(/already taken/)).toBeInTheDocument()
  })

  it('shows the SSRF message under Base URL', async () => {
    installFakeApi()
    const { user } = renderApp('#/settings/providers/new')
    const form = await page()
    await user.click(within(form).getByRole('radio', { name: 'Custom (OpenAI-compatible)' }))
    await user.type(within(form).getByLabelText('Name'), 'Odd')
    await user.type(within(form).getByLabelText('Model'), 'm')
    await user.type(within(form).getByLabelText('Base URL'), 'http://169.254.169.254/v1')
    await user.click(within(form).getByRole('button', { name: 'Save Changes' }))
    expect(await within(form).findByText(/only allowed for Local/)).toBeInTheDocument()
  })
})

// Spec: ai-providers - Claude Code (subscription) provider type.
describe('Claude Code provider', () => {
  const pick = async () => {
    const state = installFakeApi()
    const view = renderApp('#/settings/providers/new')
    const form = await page()
    await view.user.click(within(form).getByRole('radio', { name: 'Claude Code (subscription)' }))
    return { state, form, user: view.user }
  }

  it('saves without a key and lists the provider with its type label', async () => {
    const { state, form, user } = await pick()
    expect(within(form).getByText('Uses Claude Code on this machine')).toBeInTheDocument()
    expect(within(form).getByLabelText('Model')).toHaveValue('sonnet')
    await user.type(within(form).getByLabelText('Name'), 'Claude sub')
    await user.click(within(form).getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(window.location.hash).toBe('#/settings/providers/p1'))
    expect(posted(state, 'POST', '/api/ai-providers')).toEqual({
      name: 'Claude sub',
      provider_type: 'claude-code',
      model_name: 'sonnet',
      is_active: true,
      config: {},
    })
    await user.click(await screen.findByRole('link', { name: /Back to providers/ }))
    const row = (await screen.findByRole('heading', { name: 'Claude sub' })).closest('li, article, div') as HTMLElement
    expect(await within(row.parentElement ?? row).findByText(/Claude Code \(subscription\)/)).toBeInTheDocument()
  })

  it('hides the base URL and the sampling and advanced fields, keeping the timeout', async () => {
    const { form } = await pick()
    expect(within(form).queryByLabelText('Base URL')).toBeNull()
    for (const label of ['Temperature', 'Max tokens', 'Top p', 'Context window (tokens)', 'Frequency penalty', 'Top k']) {
      expect(within(form).queryByLabelText(label)).toBeNull()
    }
    expect(within(form).queryByText('Advanced parameters')).toBeNull()
    expect(within(form).getByLabelText('Timeout (seconds)')).toBeInTheDocument()
  })

  it('labels the key "Setup token (optional)" and explains it', async () => {
    const { form } = await pick()
    const key = within(form).getByLabelText('Setup token (optional)')
    expect(key).toHaveAccessibleDescription(/Optional: a token from `claude setup-token`\. Without it, the machine's Claude Code login is used\./)
  })

  it('shows the refusal of a key that is not a setup token under the key field', async () => {
    const { form, user } = await pick()
    await user.type(within(form).getByLabelText('Name'), 'Claude sub')
    const key = within(form).getByLabelText('Setup token (optional)')
    await user.type(key, 'sk-ant-api03-notatoken')
    await user.click(within(form).getByRole('button', { name: 'Save Changes' }))
    expect(await within(form).findByText('only a Claude setup token can be used here')).toBeInTheDocument()
    expect(key).toHaveAttribute('aria-invalid', 'true')
    expect(key).toHaveAccessibleDescription(/only a Claude setup token can be used here/)
  })
})

describe('edit a provider', () => {
  it('keeps the stored key when the key field is left empty', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const { user } = renderApp('#/settings/providers/p1')
    const form = await page()
    expect(await within(form).findByDisplayValue('Claude main')).toBeInTheDocument()
    await user.type(within(form).getByLabelText('Temperature'), '0.2')
    await user.click(within(form).getByRole('button', { name: 'Save Changes' }))
    expect(await within(form).findByText('Saved.')).toBeInTheDocument()
    const sent = posted(state, 'PUT', '/api/ai-providers/p1')
    expect(sent.config).toEqual({ temperature: 0.2 })
    expect(sent).not.toHaveProperty('api_key')
    expect(state.providers[0].config.temperature).toBe(0.2)
  })

  it('switches a provider off with the Active switch', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const { user } = renderApp('#/settings/providers/p1')
    const form = await page()
    await within(form).findByDisplayValue('Claude main')
    await user.click(within(form).getByRole('checkbox', { name: 'Active' }))
    await user.click(within(form).getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(state.providers[0].is_active).toBe(false))
    expect(posted(state, 'PUT', '/api/ai-providers/p1').is_active).toBe(false)
  })

  it('shows and hides the key', async () => {
    installFakeApi()
    const { user } = renderApp('#/settings/providers/new')
    const form = await page()
    const key = within(form).getByLabelText(/^API key/)
    await user.type(key, 'sk-secret')
    expect(key).toHaveAttribute('type', 'password')
    await user.click(within(form).getByRole('button', { name: 'Show' }))
    expect(key).toHaveAttribute('type', 'text')
    await user.click(within(form).getByRole('button', { name: 'Hide' }))
    expect(key).toHaveAttribute('type', 'password')
  })

  it('keeps the temperature number and slider in step', async () => {
    installFakeApi()
    const { user } = renderApp('#/settings/providers/new')
    const form = await page()
    const number = within(form).getByLabelText('Temperature')
    const slider = within(form).getByRole('slider', { name: 'Temperature slider' })
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '2')
    await user.type(number, '0.7')
    expect(slider).toHaveValue('0.7')
  })
})

describe('advanced parameters', () => {
  it('shows only the parameters of the selected type', async () => {
    installFakeApi()
    const { user } = renderApp('#/settings/providers/new')
    const form = await page()
    const advanced = within(form).getByText('Advanced parameters').closest('details') as HTMLElement
    expect(within(advanced).getByLabelText('Frequency penalty')).toBeInTheDocument()
    expect(within(advanced).queryByLabelText('Top k')).toBeNull()
    await user.click(within(form).getByRole('radio', { name: 'Anthropic' }))
    expect(within(advanced).getByLabelText('Top k')).toBeInTheDocument()
    expect(within(advanced).queryByLabelText('Frequency penalty')).toBeNull()
    expect(within(advanced).queryByLabelText('Seed')).toBeNull()
  })

  it('sends the provider-specific JSON object and refuses anything else', async () => {
    const state = installFakeApi()
    const { user } = renderApp('#/settings/providers/new')
    const form = await page()
    await user.type(within(form).getByLabelText('Name'), 'OpenAI main')
    await user.type(within(form).getByLabelText(/^API key/), 'sk-test-abcd1234')
    const extra = within(form).getByLabelText('Provider-specific parameters (JSON)')

    await user.type(extra, '{[}1, 2]')
    await user.click(within(form).getByRole('button', { name: 'Save Changes' }))
    expect(await within(form).findByText(/must be a JSON object/)).toBeInTheDocument()
    expect(state.calls.some((c) => c.method === 'POST' && c.url === '/api/ai-providers')).toBe(false)

    await user.clear(extra)
    await user.click(extra)
    await user.paste('{"reasoning_effort": "low"}')
    await user.click(within(form).getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(posted(state, 'POST', '/api/ai-providers')).toBeDefined())
    expect(posted(state, 'POST', '/api/ai-providers').config).toEqual({ extra: { reasoning_effort: 'low' } })
  })
})

describe('test connection', () => {
  it('shows a loading state, then the result with its latency', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    let release: () => void = () => {}
    state.test = () =>
      new Promise((resolve) => {
        release = () => resolve({ status: 'ok', ok: true, message: 'OK', latency_ms: 420 })
      })
    const { user } = renderApp('#/settings/providers/p1')
    const form = await page()
    await within(form).findByDisplayValue('Claude main')
    await user.click(within(form).getByRole('button', { name: 'Test Connection' }))
    expect(await within(form).findByRole('button', { name: 'Testing…' })).toBeDisabled()
    release()
    const result = await within(form).findByText(/Connection successful/)
    expect(result.closest('[data-status]')).toHaveTextContent('Latency: 420 ms')
    expect(within(form).getByRole('button', { name: 'Test Connection' })).toBeEnabled()
    // Nothing was changed, so the stored configuration was tested and its result recorded.
    expect(state.calls.some((c) => c.url === '/api/ai-providers/p1/test')).toBe(true)
    expect(state.providers[0].last_success_at).not.toBeNull()
  })

  it.each<[TestStatus, RegExp]>([
    ['auth_failed', /rejected the API key/],
    ['invalid_model', /does not know this model/],
    ['unavailable', /could not be reached/],
    ['timeout', /did not answer in time/],
    ['rate_limited', /limiting requests/],
    ['invalid_config', /not valid for this provider/],
  ])('explains %s in plain words', async (status, words) => {
    const state = installFakeApi()
    state.providers = twoProviders()
    state.test = () => ({ status, ok: false, message: 'provider said no', latency_ms: 90 })
    const { user } = renderApp('#/settings/providers/p1')
    const form = await page()
    await within(form).findByDisplayValue('Claude main')
    await user.click(within(form).getByRole('button', { name: 'Test Connection' }))
    const result = (await within(form).findByText(words)).closest('[data-status]')
    expect(result).toHaveAttribute('data-status', status)
    expect(result).toHaveTextContent('provider said no')
    expect(result).toHaveTextContent('Latency: 90 ms')
  })

  it('tests unsaved settings without saving, reusing the stored key', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const { user } = renderApp('#/settings/providers/p1')
    const form = await page()
    await within(form).findByDisplayValue('Claude main')
    await user.type(within(form).getByLabelText('Temperature'), '0.5')
    await user.click(within(form).getByRole('button', { name: 'Test Connection' }))
    await within(form).findByText(/Connection successful/)
    const sent = posted(state, 'POST', '/api/ai-providers/test') as unknown as ProviderIn & { provider_id: string }
    expect(sent.provider_id).toBe('p1')
    expect(sent).not.toHaveProperty('api_key')
    expect(sent.config.temperature).toBe(0.5)
    expect(state.calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('shows field errors found while testing', async () => {
    installFakeApi()
    const { user } = renderApp('#/settings/providers/new')
    const form = await page()
    await user.click(within(form).getByRole('button', { name: 'Test Connection' }))
    expect(await within(form).findByText('An API key is required')).toBeInTheDocument()
  })
})

describe('models and information', () => {
  it('loads the models the provider offers into the model field', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const { user } = renderApp('#/settings/providers/p1')
    const form = await page()
    await within(form).findByDisplayValue('Claude main')
    await user.click(within(form).getByRole('button', { name: 'Load models' }))
    await within(form).findByText(/Loaded 2 models/)
    const list = within(form).getByLabelText('Model').getAttribute('list') as string
    const options = [...(document.getElementById(list) as HTMLDataListElement).options].map((o) => o.value)
    expect(options).toEqual(expect.arrayContaining(['claude-sonnet-5-5', 'gpt-5.5', 'gpt-5.5-mini']))
  })

  it('offers no Load models before the provider is saved, and reports a provider error', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    state.models = { status: 502, detail: 'The provider answered 401' }
    const first = renderApp('#/settings/providers/new')
    expect(within(await page()).queryByRole('button', { name: 'Load models' })).toBeNull()
    first.unmount()

    const { user } = renderApp('#/settings/providers/p1')
    const form = await page()
    await within(form).findByDisplayValue('Claude main')
    await user.click(within(form).getByRole('button', { name: 'Load models' }))
    expect(await within(form).findByText(/The provider answered 401/)).toBeInTheDocument()
  })

  it('shows the information panel, with "Not tested yet" for a configuration never tested', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    renderApp('#/settings/providers/p1')
    const info = await screen.findByRole('region', { name: 'Provider information' })
    await within(info).findByText('Claude main')
    const terms = Object.fromEntries(
      [...info.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]),
    )
    expect(terms).toMatchObject({
      Name: 'Claude main',
      Type: 'Anthropic',
      Model: 'claude-sonnet-5-5',
      'Context window': '200,000 tokens',
      'Max output': '64,000 tokens',
      Capabilities: 'Chat, Tool use',
      Status: 'Unknown',
      'Last successful test': 'Not tested yet',
    })
  })

  it('shows the status of the last test', async () => {
    const state = installFakeApi()
    state.providers = [
      makeProvider('Claude main', 'anthropic', 'claude-sonnet-5-5', {
        last_success_at: '2026-11-07T10:00:00Z',
        last_test: { status: 'ok', message: 'OK', latency_ms: 300, at: '2026-11-07T10:00:00Z' },
      }),
    ]
    renderApp('#/settings/providers/p1')
    const info = await screen.findByRole('region', { name: 'Provider information' })
    expect(await within(info).findByText('Connected')).toBeInTheDocument()
    expect(within(info).queryByText('Not tested yet')).toBeNull()
  })
})

describe('delete', () => {
  it('refuses to delete a provider an agent uses and names the agent', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    state.assignments.assistant = { primary: 'p1', fallback: null }
    const { user } = renderApp('#/settings/providers/p1')
    const form = await page()
    await within(form).findByDisplayValue('Claude main')
    await user.click(within(form).getByRole('button', { name: 'Delete' }))
    await user.click(within(form).getByRole('button', { name: 'Yes, delete' }))
    expect(await within(form).findByText(/used by Learning assistant \(primary\)/)).toBeInTheDocument()
    expect(state.providers).toHaveLength(2)
  })

  it('deletes an unused provider and returns to the list', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const { user } = renderApp('#/settings/providers/p2')
    const form = await page()
    await within(form).findByDisplayValue('Local qwen')
    expect(screen.queryByRole('button', { name: 'Yes, delete' })).toBeNull()
    await user.click(within(form).getByRole('button', { name: 'Delete' }))
    await user.click(within(form).getByRole('button', { name: 'Yes, delete' }))
    expect(await screen.findByRole('region', { name: 'Settings' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/settings')
    expect(state.providers.map((p) => p.name)).toEqual(['Claude main'])
    // Nothing asks for the deleted provider again.
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(state.calls.filter((c) => c.method === 'GET' && c.url === '/api/ai-providers/p2')).toHaveLength(1)
    expect(state.calls.some((c) => c.url === '/api/ai-providers/p2/test' || c.url === '/api/ai-providers/p2/models')).toBe(false)
  })

  it('has no Delete button on a new configuration', async () => {
    installFakeApi()
    renderApp('#/settings/providers/new')
    expect(within(await page()).queryByRole('button', { name: 'Delete' })).toBeNull()
  })
})

describe('unsaved changes', () => {
  const beforeUnload = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('warns on reload only while there are unsaved changes', async () => {
    installFakeApi()
    const { user } = renderApp('#/settings/providers/new')
    const form = await page()
    expect(beforeUnload()).toBe(false)
    await user.type(within(form).getByLabelText('Name'), 'x')
    expect(await within(form).findByText('You have unsaved changes.')).toBeInTheDocument()
    expect(beforeUnload()).toBe(true)
  })

  it('asks before leaving in the app, and stays when the user cancels', async () => {
    installFakeApi()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = renderApp('#/settings/providers/new')
    const form = await page()
    await user.type(within(form).getByLabelText('Name'), 'x')
    await user.click(screen.getByRole('link', { name: 'Settings' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(window.location.hash).toBe('#/settings/providers/new')
    expect(screen.getByRole('region', { name: 'Provider configuration' })).toBeInTheDocument()
    expect(within(form).getByLabelText('Name')).toHaveValue('x')
    confirm.mockRestore()
  })

  it('leaves when the user agrees, and does not ask when nothing changed', async () => {
    installFakeApi()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = renderApp('#/settings/providers/new')
    await page()
    await user.click(screen.getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('region', { name: 'Settings' })).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('link', { name: 'Add provider' }))
    const form = await page()
    await user.type(within(form).getByLabelText('Name'), 'x')
    await user.click(screen.getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('region', { name: 'Settings' })).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(1)
    confirm.mockRestore()
  })
})

describe('request header', () => {
  it('sends X-LearningHub on every request', async () => {
    const state = installFakeApi()
    state.providers = twoProviders()
    const { user } = renderApp('#/settings/providers/p1')
    const form = await page()
    await within(form).findByDisplayValue('Claude main')
    await user.click(within(form).getByRole('button', { name: 'Save Changes' }))
    await within(form).findByText('Saved.')
    expect(state.headers.length).toBe(state.calls.length)
    expect(state.headers.length).toBeGreaterThan(3)
    expect(state.headers.every((h) => h['X-LearningHub'] === '1')).toBe(true)
  })
})
