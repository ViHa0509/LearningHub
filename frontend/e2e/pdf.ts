/**
 * A tiny valid PDF builder for the e2e checks (a port of `make_pdf` in
 * backend/tests/test_lesson_pdf.py): one Helvetica text line per entry on each page.
 * Lines are Latin-1 strings; the WinAnsi bullet is BULLET (byte 0x95). A page with no lines
 * has no text layer (like a scanned page).
 */

export const BULLET = '\x95'

export function makePdf(pages: string[][], options: { encrypted?: boolean } = {}): Buffer {
  const objects: string[] = []
  const pageIds = pages.map((_, i) => 3 + 2 * i)
  const fontId = 3 + 2 * pages.length
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  pages.forEach((lines, i) => {
    const content = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((line) => `(${line}) Tj T* `).join('')}ET`
    objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`,
    )
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  })
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  // Latin-1 throughout: one character is one byte, so string lengths are byte offsets.
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(out.length)
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  let trailer = `<< /Size ${objects.length + 1} /Root 1 0 R`
  if (options.encrypted) trailer += ' /Encrypt << /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>'
  out += `trailer\n${trailer} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
