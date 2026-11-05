import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { AppShell } from './components/AppShell'

export default function App({ client }: { client?: QueryClient }) {
  const [queryClient] = useState(
    () => client ?? new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  )
}
