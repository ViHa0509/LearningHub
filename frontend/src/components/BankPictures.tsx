import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { api, queryKeys, type Bank } from '../api'
import { batchFiles } from '../lib/pictures'

interface Summary {
  added: number
  unknown: string[]
  missing: number | null
  errors: string[]
}

/** For the owner: how many pictures a bank still lacks, and a control that uploads them in small batches. */
export function BankPictures({ bank, area }: { bank: Bank; area: string }) {
  const client = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)

  const upload = async (files: File[]) => {
    const total = files.length
    const result: Summary = { added: 0, unknown: [], missing: null, errors: [] }
    setSummary(null)
    let done = 0
    for (const batch of batchFiles(files)) {
      done += batch.length
      setProgress({ done, total })
      try {
        const answer = await api.addBankPictures(bank.id, batch)
        result.added += answer.added.length
        result.unknown.push(...answer.unknown)
        result.missing = answer.missing
      } catch (e) {
        const names = batch.map((f) => f.name).join(', ')
        result.errors.push(`${names}: ${e instanceof Error ? e.message : 'the upload failed'}`)
      }
    }
    setProgress(null)
    setSummary(result)
    // The question lists carry has_image: the browser must fetch them again.
    void client.invalidateQueries({ queryKey: queryKeys.bankQuestions(bank.id) })
    await client.invalidateQueries({ queryKey: queryKeys.banks(area) })
  }

  const uploading = progress !== null
  return (
    <div className="bank-pictures" aria-label={`Pictures of ${bank.title}`} role="group">
      <p>
        <strong>
          {bank.images_missing === 0
            ? 'No pictures missing'
            : `${bank.images_missing} ${bank.images_missing === 1 ? 'picture' : 'pictures'} missing`}
        </strong>{' '}
        from {bank.title}.
      </p>
      <input
        ref={input}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp,.zip,application/zip"
        aria-label="Picture files"
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          // Cleared, so the same files can be picked again.
          e.target.value = ''
          if (files.length > 0) void upload(files)
        }}
      />
      <button type="button" disabled={uploading} onClick={() => input.current?.click()}>
        Add pictures
      </button>
      {progress && (
        <p role="status" className="muted">
          Uploading {progress.done} of {progress.total}…
        </p>
      )}
      {summary && (
        <div role="status">
          <p>
            Added {summary.added} {summary.added === 1 ? 'picture' : 'pictures'}.
            {summary.unknown.length > 0 && ` ${summary.unknown.length} did not match a question: ${summary.unknown.join(', ')}.`}
            {summary.missing !== null && ` ${summary.missing} still missing.`}
          </p>
        </div>
      )}
      {summary && summary.errors.length > 0 && (
        <ul className="picture-list error" role="alert">
          {summary.errors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
