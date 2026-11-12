import type { Me } from '../api'
import type { Theme } from '../lib/theme'
import type { ScreenClass } from '../lib/useScreenClass'
import { AccountMenu } from './AccountMenu'
import { Icon, type IconName } from './Icon'
import { AGENT_OPENER_ID, LEARNED_OPENER_ID } from './PanelFrame'

interface Props {
  theme: Theme
  onThemeChange: (theme: Theme) => void
  /** The signed-in Owner: the avatar menu (with Settings) replaces the Settings link. */
  user?: Me | null
  /** Phone only: the buttons that open the learned list and agent drawers (task 3.1 restyles them). */
  screenClass?: ScreenClass
  leftOpen?: boolean
  rightOpen?: boolean
  onToggleLeft?: () => void
  onToggleRight?: () => void
  /** Ids of the two drawers, for `aria-controls`. */
  leftPanelId?: string
  rightPanelId?: string
}

const THEMES: { value: Theme; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System', icon: 'system' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
]

export function TopBar({
  theme,
  onThemeChange,
  user = null,
  screenClass = 'desktop',
  leftOpen = false,
  rightOpen = false,
  onToggleLeft,
  onToggleRight,
  leftPanelId,
  rightPanelId,
}: Props) {
  const phone = screenClass === 'phone'
  const current = THEMES.findIndex((t) => t.value === theme)
  const currentTheme = THEMES[current < 0 ? 0 : current]
  const nextTheme = THEMES[(current + 1) % THEMES.length]
  return (
    <header className="top-bar">
      {phone && (
        <button
          type="button"
          className="top-icon-button"
          id={LEARNED_OPENER_ID}
          aria-label="Learned"
          aria-expanded={leftOpen}
          aria-controls={leftPanelId}
          onClick={onToggleLeft}
        >
          <Icon name="sidebar" size={20} />
        </button>
      )}
      <a className="brand" href="#/">
        <img className="brand-mark for-dark" src="/brand/logo-mark-small.svg" alt="" width="28" height="28" />
        <img className="brand-mark for-light" src="/brand/logo-mark-small-light.svg" alt="" width="28" height="28" />
        <span className="brand-title">Learning Hub</span>
      </a>
      <nav className="top-actions" aria-label="App">
        <a href="#/news">
          <Icon name="news" />
          <span className="top-label">News</span>
        </a>
        {!user && (
          <a href="#/settings">
            <Icon name="settings" />
            <span className="top-label">Settings</span>
          </a>
        )}
      </nav>
      {phone ? (
        <button
          type="button"
          className="top-icon-button"
          aria-label={`Theme: ${currentTheme.label}. Change theme`}
          onClick={() => onThemeChange(nextTheme.value)}
        >
          <Icon name={currentTheme.icon} size={20} />
        </button>
      ) : (
        <div className="theme-switch" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={theme === t.value}
              onClick={() => onThemeChange(t.value)}
            >
              <Icon name={t.icon} />
              <span className="theme-label">{t.label}</span>
            </button>
          ))}
        </div>
      )}
      {phone && (
        <button
          type="button"
          className="top-icon-button"
          id={AGENT_OPENER_ID}
          aria-label="Agent"
          aria-expanded={rightOpen}
          aria-controls={rightPanelId}
          onClick={onToggleRight}
        >
          <Icon name="agent" size={20} />
        </button>
      )}
      {user && <AccountMenu user={user} />}
    </header>
  )
}
