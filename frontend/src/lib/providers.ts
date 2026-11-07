import type { ProviderTypeInfo, TestStatus } from '../api'

/** Short badge text per connection status; `null` means the provider was never tested. */
export const STATUS_LABEL: Record<TestStatus, string> = {
  ok: 'Connected',
  auth_failed: 'Key rejected',
  invalid_model: 'Unknown model',
  unavailable: 'Unavailable',
  timeout: 'Timed out',
  rate_limited: 'Rate limited',
  invalid_config: 'Invalid settings',
}

/** Plain-language explanation of each Test Connection outcome. */
export const TEST_MESSAGE: Record<TestStatus, string> = {
  ok: 'Connection successful. The provider accepted the key and answered.',
  auth_failed: 'The provider rejected the API key. Check the key and try again.',
  invalid_model: 'The provider does not know this model. Check the model id, or press Load models.',
  unavailable: 'The provider could not be reached or is having problems. Check the base URL and try again later.',
  timeout: 'The provider did not answer in time. Try again, or raise the timeout in the advanced parameters.',
  rate_limited: 'The provider is limiting requests. Wait a moment and try again.',
  invalid_config: 'These settings are not valid for this provider. Check the fields and try again.',
}

export function typeLabel(types: ProviderTypeInfo[] | undefined, type: string): string {
  return types?.find((t) => t.type === type)?.label ?? type
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

/** "Claude main · claude-sonnet-5-5", the way answers and pickers name a provider. */
export function providerLabel(p: { name: string; model_name: string }): string {
  return `${p.name} · ${p.model_name}`
}
