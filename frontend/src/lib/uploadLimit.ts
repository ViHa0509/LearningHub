import { useQuery } from '@tanstack/react-query'
import { api, queryKeys } from '../api'

/** Used when the server does not report its limit (an older server). */
export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** The server's upload limit from GET /api/auth/status (the same cached query the session gate reads). */
export function useMaxUploadBytes(): number {
  const status = useQuery({
    queryKey: queryKeys.authStatus,
    queryFn: api.authStatus,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  return status.data?.max_upload_bytes ?? DEFAULT_MAX_UPLOAD_BYTES
}

/** "larger than N MB" (the server's wording) when the file is over the limit, else null. */
export function tooLargeReason(file: File, maxBytes: number): string | null {
  if (file.size <= maxBytes) return null
  return `larger than ${Math.max(1, Math.round(maxBytes / (1024 * 1024)))} MB`
}
