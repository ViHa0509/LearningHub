/** Spec: data-sync (Download a backup, Restore a backup, Sync to another Learning Hub), as the page shows them. */
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeApi } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

afterEach(() => vi.restoreAllMocks())

const open = async () => {
  const rendered = await renderAppReady('#/settings/data')
  await screen.findByRole('region', { name: 'Data & sync' })
  return rendered
}
const card = (name: string) => screen.findByRole('article', { name })
const zip = () => new File(['PK'], 'learninghub-backup.zip', { type: 'application/zip' })

describe('backup', () => {
  it('offers the download and says what is not included', async () => {
    installFakeApi()
    await open()
    const backup = await card('Backup')
    const link = within(backup).getByRole('link', { name: 'Download backup' })
    expect(link).toHaveAttribute('href', '/api/data/backup')
    expect(link).toHaveAttribute('download')
    expect(backup).toHaveTextContent(/API keys, passwords and sign-in secrets are not included/)
  })
})

describe('restore', () => {
  // Scenario: Restore replaces the data (the typed confirmation)
  it('is enabled only with a file and exactly REPLACE', async () => {
    const state = installFakeApi()
    const { user } = await open()
    const restore = await card('Restore')
    const button = within(restore).getByRole('button', { name: 'Restore' })
    expect(within(restore).getByLabelText('Backup file')).toHaveAttribute('accept', '.zip')
    expect(button).toBeDisabled()

    await user.type(within(restore).getByLabelText('Type REPLACE to confirm'), 'REPLACE')
    expect(button).toBeDisabled()
    await user.upload(within(restore).getByLabelText('Backup file'), zip())
    expect(button).toBeEnabled()

    await user.clear(within(restore).getByLabelText('Type REPLACE to confirm'))
    await user.type(within(restore).getByLabelText('Type REPLACE to confirm'), 'replace')
    expect(button).toBeDisabled()
    expect(state.calls.some((c) => c.url === '/api/data/restore')).toBe(false)
  })

  // Scenario: Provider keys entered again
  it('restores, shows the counts and the providers that need a key', async () => {
    const state = installFakeApi()
    state.data.restore = {
      counts: { notes: 2, files: 2, lessons: 1, providers: 2 },
      providers_needing_key: ['Claude main', 'Gemini'],
    }
    const { user } = await open()
    const restore = await card('Restore')
    await user.upload(within(restore).getByLabelText('Backup file'), zip())
    await user.type(within(restore).getByLabelText('Type REPLACE to confirm'), 'REPLACE')
    await user.click(within(restore).getByRole('button', { name: 'Restore' }))

    expect(await within(restore).findByText(/Restored: 2 notes, 2 files, 1 lessons, 2 providers/)).toBeInTheDocument()
    expect(within(restore).getByText(/Enter the key again for: Claude main, Gemini/)).toBeInTheDocument()
    expect(within(restore).getByRole('link', { name: 'Open AI providers' })).toHaveAttribute('href', '#/settings')
    expect(state.data.restored).toEqual([{ name: 'learninghub-backup.zip', confirm: 'REPLACE' }])
    const index = state.calls.findIndex((c) => c.url === '/api/data/restore')
    expect(state.headers[index]['X-LearningHub']).toBe('1')
  })

  it('shows the refusal inline and leaves the page usable', async () => {
    const state = installFakeApi()
    state.data.restore = { status: 422, detail: 'the backup is from a newer version' }
    const { user } = await open()
    const restore = await card('Restore')
    await user.upload(within(restore).getByLabelText('Backup file'), zip())
    await user.type(within(restore).getByLabelText('Type REPLACE to confirm'), 'REPLACE')
    await user.click(within(restore).getByRole('button', { name: 'Restore' }))
    expect(await within(restore).findByRole('alert')).toHaveTextContent('the backup is from a newer version')
    expect(within(restore).queryByText(/Restored/)).not.toBeInTheDocument()
  })

  it('shows Restoring… while it runs', async () => {
    const state = installFakeApi()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const base = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/data/restore' ? gate.then(() => base(input, init)) : base(input, init),
    )
    const { user } = await open()
    const restore = await card('Restore')
    await user.upload(within(restore).getByLabelText('Backup file'), zip())
    await user.type(within(restore).getByLabelText('Type REPLACE to confirm'), 'REPLACE')
    await user.click(within(restore).getByRole('button', { name: 'Restore' }))
    expect(await within(restore).findByText('Restoring…')).toBeInTheDocument()
    expect(within(restore).getByRole('button', { name: 'Restore' })).toBeDisabled()
    release()
    expect(await within(restore).findByText(/Restored:/)).toBeInTheDocument()
    expect(state.data.restored).toHaveLength(1)
  })
})

describe('sync key (receive)', () => {
  it('shows the key once, then only the expiry after a reload', async () => {
    const state = installFakeApi()
    const { user, unmount } = await open()
    const receive = await card('Receive')
    expect(await within(receive).findByText('No sync key is active.')).toBeInTheDocument()
    expect(within(receive).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()

    await user.click(within(receive).getByRole('button', { name: 'Create sync key' }))
    expect(await within(receive).findByDisplayValue('sync-key-abc123')).toHaveAttribute('readonly')
    expect(within(receive).getByText(/Valid until .*; creating a new key replaces this one\./)).toBeInTheDocument()
    await user.click(within(receive).getByRole('button', { name: 'Copy' }))
    expect(await within(receive).findByText('Copied')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe('sync-key-abc123')
    expect(state.headers[state.calls.findIndex((c) => c.method === 'POST' && c.url === '/api/data/sync-key')]['X-LearningHub']).toBe('1')

    unmount()
    await open()
    const again = await card('Receive')
    expect(await within(again).findByText(/A sync key is active until/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('sync-key-abc123')
    expect(within(again).queryByDisplayValue('sync-key-abc123')).not.toBeInTheDocument()
  })

  it('revokes the key after confirming', async () => {
    const state = installFakeApi()
    state.data.syncKey = { key: 'hidden', expires_at: '2026-11-10T12:00:00Z' }
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { user } = await open()
    const receive = await card('Receive')
    await user.click(await within(receive).findByRole('button', { name: 'Revoke' }))
    expect(state.calls.some((c) => c.method === 'DELETE' && c.url === '/api/data/sync-key')).toBe(false)
    await user.click(within(receive).getByRole('button', { name: 'Revoke' }))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(await within(receive).findByText('No sync key is active.')).toBeInTheDocument()
    expect(state.data.syncKey).toBeNull()
  })
})

describe('sync send', () => {
  const fill = async (user: Awaited<ReturnType<typeof open>>['user'], send: HTMLElement) => {
    await user.type(within(send).getByLabelText('Target address'), 'https://hub.example.com')
    await user.type(within(send).getByLabelText('Sync key'), 'the-key')
  }

  // Scenario: Send Local to Deploy
  it('sends, shows what was copied and clears the key', async () => {
    const state = installFakeApi()
    state.data.sync = { counts: { notes: 3, files: 3, lessons: 1, providers: 1 }, providers_needing_key: ['Claude main'] }
    const { user } = await open()
    const send = await card('Send')
    const button = within(send).getByRole('button', { name: 'Send' })
    expect(within(send).getByLabelText('Target address')).toHaveAttribute('placeholder', 'https://hub.example.com')
    expect(within(send).getByLabelText('Sync key')).toHaveAttribute('type', 'password')
    expect(button).toBeDisabled()
    await user.type(within(send).getByLabelText('Target address'), 'https://hub.example.com')
    expect(button).toBeDisabled()
    await user.type(within(send).getByLabelText('Sync key'), 'the-key')
    expect(button).toBeEnabled()
    await user.click(button)

    expect(await within(send).findByText(/Sent: 3 notes, 3 files, 1 lessons, 1 providers/)).toBeInTheDocument()
    expect(within(send).getByText(/Enter the key again for: Claude main/)).toBeInTheDocument()
    const post = state.calls.find((c) => c.url === '/api/data/sync')
    expect(post?.body).toEqual({ target_url: 'https://hub.example.com', key: 'the-key' })
    expect(within(send).getByLabelText('Sync key')).toHaveValue('')
  })

  it('shows Sending… while it runs', async () => {
    installFakeApi()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const base = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/data/sync' ? gate.then(() => base(input, init)) : base(input, init),
    )
    const { user } = await open()
    const send = await card('Send')
    await fill(user, send)
    await user.click(within(send).getByRole('button', { name: 'Send' }))
    expect(await within(send).findByText('Sending… this can take a while for large backups')).toBeInTheDocument()
    release()
    expect(await within(send).findByText(/Sent:/)).toBeInTheDocument()
  })

  // Scenario: Wrong or expired key
  it('shows the wrong or expired key message inline', async () => {
    const state = installFakeApi()
    state.data.sync = { status: 401, detail: 'the sync key is wrong or expired' }
    const { user } = await open()
    const send = await card('Send')
    await fill(user, send)
    await user.click(within(send).getByRole('button', { name: 'Send' }))
    expect(await within(send).findByRole('alert')).toHaveTextContent('the sync key is wrong or expired')
    await waitFor(() => expect(within(send).getByLabelText('Sync key')).toHaveValue(''))
    expect(within(send).getByLabelText('Target address')).toHaveValue('https://hub.example.com')
  })
})
