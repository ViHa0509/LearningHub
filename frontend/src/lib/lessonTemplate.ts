/** Pure helpers of the lesson template (see components/LessonBody.tsx). */

const WORDS_PER_MINUTE = 200

export interface Section {
  title: string | null
  body: string
}

/** Splits the text at `## ` headings (outside code fences); text before the first one is the intro. */
export function splitSections(text: string): Section[] {
  const sections: Section[] = [{ title: null, body: '' }]
  let fenced = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const heading = !fenced && /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) sections.push({ title: heading[1], body: '' })
    else sections[sections.length - 1].body += `${line}\n`
  }
  return sections.filter((s) => s.title !== null || s.body.trim() !== '')
}

export const readingMinutes = (text: string) =>
  Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / WORDS_PER_MINUTE))
