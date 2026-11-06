import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

/** Renders the whole app at a page address (`#/` = home). */
export function renderApp(hash = '#/') {
  window.history.replaceState(null, '', hash)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  const user = userEvent.setup()
  return { user, ...render(<App client={client} />) }
}
