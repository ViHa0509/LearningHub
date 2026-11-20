/** Spec: agent-chat - Chat pet shows the agent's state; Pet text is fixed; Pet never gets in the way. */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import css from '../../index.css?raw'
import { PET_LINES } from '../../lib/pet'
import { ChatPet } from './ChatPet'

describe('ChatPet', () => {
  it('draws an idle pet with the greeting, hidden from assistive technology', () => {
    const { container } = render(<ChatPet busy={false} entries={[]} />)
    const pet = container.querySelector('.chat-pet')!
    expect(pet).toHaveAttribute('data-pose', 'idle')
    expect(pet).toHaveAttribute('aria-hidden', 'true')
    expect(pet.querySelector('.chat-pet-bubble')).toHaveTextContent(PET_LINES.greeting)
    const svg = pet.querySelector('svg')!
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
    expect(svg.querySelectorAll('rect').length).toBeGreaterThan(20)
    // Never focusable.
    expect(pet.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0)
  })

  it('shows the thinking pose with three dots and the thinking line', () => {
    const { container } = render(<ChatPet busy entries={[{}]} />)
    expect(container.querySelector('.chat-pet')).toHaveAttribute('data-pose', 'thinking')
    expect(container.querySelector('.chat-pet-bubble')).toHaveTextContent(PET_LINES.thinking)
    expect(container.querySelectorAll('.pet-dot')).toHaveLength(3)
  })

  it('shows done, then error with fixed lines only', () => {
    const { container, rerender } = render(<ChatPet busy entries={[{}]} />)
    rerender(<ChatPet busy={false} entries={[{}, {}]} />)
    expect(container.querySelector('.chat-pet')).toHaveAttribute('data-pose', 'done')
    expect(container.querySelector('.chat-pet-bubble')).toHaveTextContent(PET_LINES.done)
    rerender(<ChatPet busy entries={[{}]} />)
    rerender(<ChatPet busy={false} entries={[{ error: 'Provider said: BOOM' }]} />)
    expect(container.querySelector('.chat-pet')).toHaveAttribute('data-pose', 'error')
    expect(container.querySelector('.chat-pet-bubble')).toHaveTextContent(PET_LINES.error)
    expect(container).not.toHaveTextContent('BOOM')
  })

  // Scenario: Reduced motion, Dark theme (CSS contract)
  it('moves only under no-preference and uses theme colors only', () => {
    const rules = css.split('/* Chat pet')[1].split('@keyframes pet-bubble')[0]
    const outside = rules.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/, '')
    expect(rules).toContain('@media (prefers-reduced-motion: no-preference)')
    expect(outside).not.toMatch(/animation\s*:|transition\s*:/)
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/)
    expect(rules).toContain('var(--accent)')
    expect(rules).toContain('var(--surface)')
    expect(rules).toContain('pointer-events: none')
  })
})
