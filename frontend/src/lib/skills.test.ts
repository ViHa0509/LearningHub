/** Spec: agent-chat - Skills in the composer. */
import { describe, expect, it } from 'vitest'
import { SKILLS, expandSkill, suggestSkills } from './skills'

const prompt = (cmd: string) => SKILLS.find((s) => s.cmd === cmd)!.prompt

describe('skills', () => {
  it('offers the six skills', () => {
    expect(SKILLS.map((s) => s.cmd)).toEqual(['/summarize', '/explain', '/quiz', '/rewrite', '/mindmap', '/flashcards'])
    for (const s of SKILLS) {
      expect(s.description).not.toBe('')
      expect(s.prompt).not.toBe('')
    }
  })

  it('expands a skill message into the instruction followed by the rest', () => {
    expect(expandSkill('/quiz JWT')).toBe(`${prompt('/quiz')}\n\nJWT`)
    expect(expandSkill('  /explain   Redis eviction\nwith examples ')).toBe(
      `${prompt('/explain')}\n\nRedis eviction\nwith examples`,
    )
    expect(expandSkill('/QUIZ jwt')).toBe(`${prompt('/quiz')}\n\njwt`)
  })

  it('sends a bare command as the instruction alone', () => {
    expect(expandSkill('/summarize')).toBe(prompt('/summarize'))
  })

  it('leaves other text unchanged', () => {
    expect(expandSkill('what about /quiz?')).toBe('what about /quiz?')
    expect(expandSkill('/unknown thing')).toBe('/unknown thing')
    expect(expandSkill('/quizzes JWT')).toBe('/quizzes JWT')
    expect(expandSkill('plain question')).toBe('plain question')
  })

  it('suggests skills by prefix while a bare command is typed', () => {
    expect(suggestSkills('/qu')?.map((s) => s.cmd)).toEqual(['/quiz'])
    expect(suggestSkills('/')).toHaveLength(6)
    expect(suggestSkills('/R')?.map((s) => s.cmd)).toEqual(['/rewrite'])
    expect(suggestSkills('/zzz')).toEqual([])
    expect(suggestSkills('/quiz JWT')).toBeNull()
    expect(suggestSkills('quiz')).toBeNull()
    expect(suggestSkills('')).toBeNull()
  })
})
