/**
 * Skills: message templates the composer offers as `/commands`. They live only in the frontend;
 * the message sent is the skill's instruction followed by what the user typed after the command.
 */
export interface Skill {
  cmd: string
  description: string
  prompt: string
}

export const SKILLS: Skill[] = [
  {
    cmd: '/summarize',
    description: 'Short summary of a note or file',
    prompt:
      'Summarize the following in a few short bullet points, keeping the key terms. Use my notes or the attached file where they help.',
  },
  {
    cmd: '/explain',
    description: 'Explain a concept step by step',
    prompt: 'Explain the following step by step, from the basics up, with one small example. Use my notes where they help.',
  },
  {
    cmd: '/quiz',
    description: '5 questions to test yourself',
    prompt:
      'Quiz me: write 5 questions that test my understanding of the following topic, based on my notes where possible. Put the answers after all the questions.',
  },
  {
    cmd: '/rewrite',
    description: 'Rewrite text clearer or shorter',
    prompt: 'Rewrite the following so it is clearer and shorter, keeping its meaning. Return only the rewritten text.',
  },
  {
    cmd: '/mindmap',
    description: 'Outline the topic as a mind map',
    prompt: 'Outline the following topic as a mind map: a nested Markdown list with the main idea at the top.',
  },
  {
    cmd: '/flashcards',
    description: 'Turn a note into flashcards',
    prompt: 'Turn the following into flashcards: a Markdown table with the columns Question and Answer.',
  },
]

const COMMAND = /^(\/\S+)(?:\s+([\s\S]*))?$/

/** The message to send: the skill's instruction plus the rest of the text, or the text unchanged. */
export function expandSkill(text: string): string {
  const trimmed = text.trim()
  const match = COMMAND.exec(trimmed)
  const skill = match ? SKILLS.find((s) => s.cmd === match[1].toLowerCase()) : undefined
  if (!match || !skill) return text
  const rest = (match[2] ?? '').trim()
  return rest ? `${skill.prompt}\n\n${rest}` : skill.prompt
}

/**
 * The skills to suggest while the draft is a bare command being typed (`/qu`), filtered by prefix;
 * null when the draft is not one.
 */
export function suggestSkills(draft: string): Skill[] | null {
  if (!draft.startsWith('/') || /\s/.test(draft)) return null
  const query = draft.slice(1).toLowerCase()
  return SKILLS.filter((s) => s.cmd.slice(1).startsWith(query))
}
