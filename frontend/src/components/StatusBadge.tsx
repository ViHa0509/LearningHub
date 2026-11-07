import type { TestStatus } from '../api'
import { STATUS_LABEL } from '../lib/providers'

export function StatusBadge({ status }: { status: TestStatus | null | undefined }) {
  return (
    <span className={`status-badge ${status ?? 'untested'}`} data-status={status ?? 'untested'}>
      {status ? STATUS_LABEL[status] : 'Not tested yet'}
    </span>
  )
}
