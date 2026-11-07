/** Spec: provider-settings (UI); agent-chat - chosen model is the chat default. */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeApi, PROVIDERS } from '../test/fakeApi'
import { renderApp } from '../test/render'

const card = (name: string) => screen.findByRole('article', { name })
const panel = () => screen.getByRole('complementary', { name: 'Agent' })

describe('settings page', () => {
  it('is reachable from the top bar and from the agent panel', async () => {
    installFakeApi()
    const { user } = renderApp()
    expect(await within(panel()).findByRole('link', { name: 'Open settings' })).toHaveAttribute('href', '#/settings')
    await user.click(screen.getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('region', { name: 'Settings' })).toBeInTheDocument()
    expect(await card('Anthropic (Claude)')).toBeInTheDocument()
    expect(within(await card('Anthropic (Claude)')).getByRole('status')).toHaveTextContent('Not configured')
  })

  it('pastes a key, saves, and the chat appears at once', async () => {
    const state = installFakeApi()
    const { user } = renderApp('#/settings')
    const anthropic = await card('Anthropic (Claude)')
    const key = within(anthropic).getByLabelText('API key')
    expect(key).toHaveAttribute('type', 'password')
    await user.type(key, 'sk-ant-api03-abcd1234')
    await user.click(within(anthropic).getByRole('button', { name: 'Save' }))

    expect(await within(anthropic).findByText('Saved.')).toBeInTheDocument()
    expect(within(anthropic).getByRole('status')).toHaveTextContent('Saved in app · key …1234')
    expect(key).toHaveValue('')
    expect(state.calls).toContainEqual({
      method: 'PUT',
      url: '/api/agent/providers/anthropic',
      body: { api_key: 'sk-ant-api03-abcd1234', model: '' },
    })
    expect(await within(panel()).findByRole('textbox', { name: 'Message the agent' })).toBeInTheDocument()
  })

  it('saves a custom model id, which becomes the chat default', async () => {
    const state = installFakeApi()
    const { user } = renderApp('#/settings')
    const anthropic = await card('Anthropic (Claude)')
    await user.type(within(anthropic).getByLabelText('API key'), 'sk-key-0000')
    await user.selectOptions(within(anthropic).getByLabelText('Model'), 'Other model id…')
    await user.type(within(anthropic).getByLabelText('Model id'), 'claude-sonnet-5-5-preview')
    await user.click(within(anthropic).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(state.calls.at(-1)?.body).toEqual({ api_key: 'sk-key-0000', model: 'claude-sonnet-5-5-preview' }),
    )
    const model = await within(panel()).findByRole('combobox', { name: 'Model' })
    await waitFor(() => expect(model).toHaveValue('claude-sonnet-5-5-preview'))
  })

  it('shows the validation message for a bad Ollama URL', async () => {
    installFakeApi()
    const { user } = renderApp('#/settings')
    const ollama = await card('Local (Ollama, Gemma)')
    await user.type(within(ollama).getByLabelText('Server URL'), 'localhost:11434')
    await user.click(within(ollama).getByRole('button', { name: 'Save' }))
    expect(await within(ollama).findByRole('alert')).toHaveTextContent('the URL must start with http:// or https://')
  })

  it('tests a configured provider and shows the result', async () => {
    const state = installFakeApi()
    state.providers = PROVIDERS.map((p) => ({ ...p }))
    const { user } = renderApp('#/settings')
    const anthropic = await card('Anthropic (Claude)')
    await user.click(within(anthropic).getByRole('button', { name: 'Test' }))
    expect(await within(anthropic).findByRole('alert')).toHaveTextContent(
      'Test passed: claude-sonnet-5-5 answered in 420 ms.',
    )

    state.test = { ok: false, model: 'x', latency_ms: 90, message: 'invalid x-api-key' }
    await user.click(within(anthropic).getByRole('button', { name: 'Test' }))
    expect(await within(anthropic).findByText(/Test failed .*invalid x-api-key/)).toBeInTheDocument()
  })

  it('switches a provider off and removes a key', async () => {
    const state = installFakeApi()
    state.providers = PROVIDERS.map((p) => ({ ...p }))
    const { user } = renderApp('#/settings')
    const anthropic = await card('Anthropic (Claude)')
    await user.click(within(anthropic).getByRole('checkbox', { name: 'On' }))
    await waitFor(() => expect(within(anthropic).getByRole('status')).toHaveTextContent('switched off'))
    expect(state.calls.at(-1)?.body).toEqual({ enabled: false })
    // The chat no longer offers Anthropic.
    const provider = await within(panel()).findByRole('combobox', { name: 'Provider' })
    await waitFor(() => expect(within(provider).queryByRole('option', { name: 'Anthropic (Claude)' })).toBeNull())

    await user.click(within(anthropic).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(within(anthropic).getByRole('status')).toHaveTextContent('Not configured'))
    expect(state.calls.at(-1)?.method).toBe('DELETE')
  })

  it('says when a key comes from backend/.env and when the app overrides it', async () => {
    const state = installFakeApi()
    state.providers = [
      { ...PROVIDERS[0], source: 'env', key_hint: '…9999' },
      { ...PROVIDERS[1], overrides_env: true, key_hint: '…5555' },
    ]
    renderApp('#/settings')
    expect(within(await card('Anthropic (Claude)')).getByRole('status')).toHaveTextContent('From backend/.env · key …9999')
    expect(within(await card('OpenAI')).getByRole('status')).toHaveTextContent(
      'Saved in app (overrides backend/.env) · key …5555',
    )
    expect(within(await card('Anthropic (Claude)')).queryByRole('button', { name: 'Remove' })).toBeNull()
  })
})
