import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { forgetReturn } from '../lib/authRoute'
import { forgetPages } from '../lib/route'

/** Renders the whole app at a page address (`#/` = home). */
export function renderApp(hash = '#/') {
  window.history.replaceState(null, '', hash)
  forgetPages()
  forgetReturn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  const user = userEvent.setup()
  return { user, ...render(<App client={client} />) }
}

/** renderApp, then waits until the login check is done and the app (or a login page) shows. */
export async function renderAppReady(hash = '#/') {
  const rendered = renderApp(hash)
  await waitFor(() => expect(screen.queryByRole('main', { name: 'Loading' })).not.toBeInTheDocument())
  return rendered
}
