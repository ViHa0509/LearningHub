import type { ProfileSection } from '../lib/route'
import { ProfileGeneral } from './ProfileGeneral'
import { ProfilePreferences } from './ProfilePreferences'
import { ProfileSecurity } from './ProfileSecurity'

const TITLES: Record<ProfileSection, string> = { general: 'General', security: 'Security', preferences: 'Preferences' }

/** The Profile page: the section picked in the left column. */
export function ProfilePage({ section }: { section: ProfileSection }) {
  return (
    <section className="settings-page" aria-label="Profile">
      <div className="settings-header">
        <h1>{TITLES[section]}</h1>
      </div>
      {section === 'general' && <ProfileGeneral />}
      {section === 'security' && <ProfileSecurity />}
      {section === 'preferences' && <ProfilePreferences />}
    </section>
  )
}
