import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { api, ApiError, queryKeys, type Bank, type BankProblem } from '../api'
import { Icon } from './Icon'

/** The Import questions button with its file input and the result or problem list; used on the area page and the practice page. */
export function ImportBank({ area }: { area: string }) {
  const client = useQueryClient()
  const file = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState<
    { kind: 'ok'; bank: Bank } | { kind: 'error'; problems: BankProblem[]; message: string } | null
  >(null)
  const importBank = async (picked: File) => {
    setImporting(true)
    setImported(null)
    try {
      const bank = await api.importBank(area, picked)
      setImported({ kind: 'ok', bank })
      await client.invalidateQueries({ queryKey: queryKeys.banks(area) })
    } catch (e) {
      const detail = e instanceof ApiError ? (e.body as { detail?: unknown } | undefined)?.detail : undefined
      const problems = Array.isArray(detail)
        ? (detail as BankProblem[]).filter((p) => p && typeof p.msg === 'string')
        : []
      setImported({
        kind: 'error',
        problems,
        message: e instanceof Error && problems.length === 0 ? e.message : 'The file was not imported.',
      })
    } finally {
      setImporting(false)
    }
  }
  return (
    <>
      <input
        ref={file}
        type="file"
        accept=".json,.zip,application/json,application/zip"
        aria-label="Question bank file"
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0]
          // Cleared, so the same file can be picked again.
          e.target.value = ''
          if (picked) void importBank(picked)
        }}
      />
      <button type="button" disabled={importing} onClick={() => file.current?.click()}>
        <Icon name="import" /> Import questions
      </button>
      {imported?.kind === 'ok' && (
        <p className="area-note import-result" role="status">
          Imported {imported.bank.title}: {imported.bank.question_count} questions.
          {imported.bank.images_missing > 0 &&
            ` ${imported.bank.images_missing} pictures are missing: use Add pictures to upload them.`}
        </p>
      )}
      {imported?.kind === 'error' && (
        <div className="area-note error import-result" role="alert">
          <p>{imported.message}</p>
          {imported.problems.length > 0 && (
            <ul className="import-problems">
              {imported.problems.map((p, i) => (
                <li key={i}>{p.question === null ? p.msg : `Question ${p.question}: ${p.msg}`}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}
