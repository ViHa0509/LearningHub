/** Spec: responsive-layout - Compact top bar. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Me } from '../api'
import type { Theme } from '../lib/theme'
import type { ScreenClass } from '../lib/useScreenClass'
import { TopBar } from './TopBar'

const owner: Me = {
  id: 'u1',
  role: 'admin',
  email: 'ada@example.com',
  email_verified: true,
  display_name: 'Ada',
  bio: null,
  avatar_url: null,
  has_password: true,
  linked: [],
}

function Harness({ screenClass, user = null, ...rest }: { screenClass: ScreenClass; user?: Me | null } & Partial<Parameters<typeof TopBar>[0]>) {
  const [theme, setTheme] = useState<Theme>('system')
  const [client] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={client}>
      <TopBar theme={theme} onThemeChange={setTheme} screenClass={screenClass} user={user} {...rest} />
    </QueryClientProvider>
  )
}

describe('TopBar on a phone', () => {
  it('steps the theme System -> Light -> Dark -> System and the name follows', async () => {
    const user = userEvent.setup()
    render(<Harness screenClass="phone" />)
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    const button = () => screen.getByRole('button', { name: /^Theme: / })
    expect(button()).toHaveAccessibleName('Theme: System. Change theme')
    await user.click(button())
    expect(button()).toHaveAccessibleName('Theme: Light. Change theme')
    await user.click(button())
    expect(button()).toHaveAccessibleName('Theme: Dark. Change theme')
    await user.click(button())
    expect(button()).toHaveAccessibleName('Theme: System. Change theme')
  })

  it('has icon drawer buttons that call their handlers and reflect aria-expanded', async () => {
    const user = userEvent.setup()
    const onToggleLeft = vi.fn()
    const onToggleRight = vi.fn()
    render(
      <Harness
        screenClass="phone"
        leftOpen
        rightOpen={false}
        onToggleLeft={onToggleLeft}
        onToggleRight={onToggleRight}
        leftPanelId="learned-panel"
        rightPanelId="agent-panel"
      />,
    )
    const learned = screen.getByRole('button', { name: 'Learned' })
    const agent = screen.getByRole('button', { name: 'Agent' })
    expect(learned).toHaveAttribute('aria-expanded', 'true')
    expect(learned).toHaveAttribute('aria-controls', 'learned-panel')
    expect(agent).toHaveAttribute('aria-expanded', 'false')
    expect(agent).toHaveAttribute('aria-controls', 'agent-panel')
    await user.click(learned)
    await user.click(agent)
    expect(onToggleLeft).toHaveBeenCalledTimes(1)
    expect(onToggleRight).toHaveBeenCalledTimes(1)
  })

  it('puts Learned first, then the brand, News, theme, Agent', () => {
    render(<Harness screenClass="phone" />)
    const order = screen
      .getAllByRole('link')
      .map((el) => el.textContent)
      .join('|')
    expect(order).toContain('Learning Hub')
    const names = ['Learned', 'Learning Hub', 'News', /^Theme: /, 'Agent'].map((name) =>
      screen.getByRole(name === 'Learning Hub' || name === 'News' ? 'link' : 'button', { name }),
    )
    for (let i = 1; i < names.length; i += 1) {
      expect(names[i - 1].compareDocumentPosition(names[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('keeps accessible names on the brand and News links and Settings when signed out', () => {
    render(<Harness screenClass="phone" />)
    expect(screen.getByRole('link', { name: 'Learning Hub' })).toHaveAttribute('href', '#/')
    expect(screen.getByRole('link', { name: 'News' })).toHaveAttribute('href', '#/news')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings')
  })

  it('shows the avatar menu button for a signed-in user, named after them', () => {
    render(<Harness screenClass="phone" user={owner} />)
    expect(screen.getByRole('button', { name: 'Account menu: Ada' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
  })
})

describe('TopBar on a tablet', () => {
  it('keeps the radiogroup with all three names and no drawer buttons', async () => {
    const user = userEvent.setup()
    render(<Harness screenClass="tablet" />)
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
    for (const name of ['System', 'Light', 'Dark']) expect(screen.getByRole('radio', { name })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Learned' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agent' })).not.toBeInTheDocument()
  })
})

describe('TopBar on a desktop', () => {
  it('is unchanged: radiogroup with visible labels, no drawer buttons', () => {
    render(<Harness screenClass="desktop" />)
    const group = screen.getByRole('radiogroup', { name: 'Theme' })
    expect(group).toHaveTextContent('SystemLightDark')
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveTextContent('Light')
    expect(screen.queryByRole('button', { name: 'Learned' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Theme: / })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'News' })).toHaveTextContent('News')
  })
})
