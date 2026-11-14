import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, api, queryKeys, type AuthStatus, type InvitationInfo, type OAuthProvider } from '../api'
import { authErrorMessage, useSignedIn } from '../lib/auth'
import { dropQuery, type AuthRoute } from '../lib/authRoute'
import { DotPattern } from './magicui/dot-pattern'
import { ShimmerButton } from './magicui/shimmer-button'

const MIN_PASSWORD = 10
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const OUTBOX_NOTE = 'Email is not configured: the link was written to storage/outbox on the server.'
const USED_LINK = 'This link has expired or was already used.'

/** Readable text for the `?error=` code an OAuth callback redirects with. */
const OAUTH_ERRORS: Record<string, string> = {
  state_mismatch: 'The sign-in could not be confirmed (it was started in another browser or took too long). Try again.',
  access_denied: 'The sign-in was cancelled at the provider.',
  owner_exists: 'This app has an owner already',
  not_invited: 'You need an invitation to join.',
  account_unverified:
    'An account with this email exists but its email is not verified yet. Log in with its password, or verify the email first.',
  not_configured: 'This sign-in method is not configured on this server.',
  provider_error: 'The provider did not answer as expected. Try again.',
}

const oauthErrorMessage = (code: string) => OAUTH_ERRORS[code] ?? 'The sign-in did not work. Try again.'

interface Props {
  route: AuthRoute
  status: AuthStatus | undefined
  /** The app page to land on after signing in (the OAuth `next`). */
  next: string
}

/** The auth pages: a centered card on the app background. */
export function AuthPages({ route, status, next }: Props) {
  const token = route.params.get('token')
  const noOwner = status?.has_owner === false
  switch (route.page) {
    case 'signup':
      return <CreateAccountPage status={status} next={next} admin={noOwner} />
    case 'login':
    case 'create':
      return noOwner ? (
        <CreateAccountPage status={status} next={next} admin />
      ) : (
        <LoginPage status={status} next={next} error={route.page === 'login' ? route.params.get('error') : null} />
      )
    case 'forgot':
      return <ForgotPage status={status} />
    case 'reset':
      return <ResetPage token={token} />
    case 'magic':
      return token ? <MagicOpenPage token={token} status={status} /> : <MagicRequestPage status={status} />
    case 'verify':
      return <VerifyPage token={token} />
    case 'invite':
      return <InvitePage token={token} status={status} next={next} />
  }
}

function Card({ title, children, corner }: { title: string; children: ReactNode; corner?: { href: string; label: string } }) {
  return (
    <main className="auth-page" aria-label={title}>
      <DotPattern glow />
      {corner && (
        <a className="button-link auth-corner" href={corner.href}>
          {corner.label}
        </a>
      )}
      <section className="auth-card">
        <img className="auth-mark for-dark" src="/brand/logo-mark.svg" alt="" width="56" height="56" />
        <img className="auth-mark for-light" src="/brand/logo-mark-light.svg" alt="" width="56" height="56" />
        <p className="auth-brand">Learning Hub</p>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  )
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p className="auth-message error" role="alert">
      {text}
    </p>
  ) : null
}

function Sent({ text, status }: { text: string; status: AuthStatus | undefined }) {
  return (
    <div className="auth-sent" role="status">
      <p>{text}</p>
      {status?.mail.mode === 'outbox' && <p className="muted">{OUTBOX_NOTE}</p>}
    </div>
  )
}

function Field(props: {
  label: string
  type: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  autoFocus?: boolean
}) {
  return (
    <label className="auth-field">
      <span>{props.label}</span>
      <input
        type={props.type}
        value={props.value}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  )
}

const PROVIDERS: { id: OAuthProvider; label: string }[] = [
  { id: 'github', label: 'Continue with GitHub' },
  { id: 'google', label: 'Continue with Google' },
]

/** The provider's mark, in its own colours (Google) or the text colour (GitHub). */
function ProviderLogo({ id }: { id: OAuthProvider }) {
  return id === 'github' ? (
    <svg className="auth-provider-logo" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.17a11 11 0 0 1 5.77 0c2.2-1.48 3.17-1.17 3.17-1.17.63 1.58.23 2.75.11 3.04.74.8 1.19 1.82 1.19 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"
      />
    </svg>
  ) : (
    <svg className="auth-provider-logo" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.65Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.93-2.91l-3.87-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.29v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.29a12 12 0 0 0 0 10.78l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.43-3.43A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.61l4 3.1C6.23 6.86 8.88 4.75 12 4.75Z" />
    </svg>
  )
}

/** The configured providers only (with the "or" line above them); none configured: nothing, or
 * on the first visit a note that they can be added in Settings. */
function ProviderButtons({ status, next, firstVisit = false }: { status: AuthStatus | undefined; next: string; firstVisit?: boolean }) {
  const offered = PROVIDERS.filter(({ id }) => status?.providers[id]?.configured)
  if (offered.length === 0) {
    return firstVisit && status ? (
      <p className="muted auth-hint auth-providers-later">GitHub and Google sign-in can be added later in Settings → Sign-in.</p>
    ) : null
  }
  return (
    <>
      <p className="auth-or muted">or</p>
      <div className="auth-providers">
        {offered.map(({ id, label }) => (
          <a key={id} className="button-link auth-provider" href={api.oauthStartUrl(id, next)}>
            <ProviderLogo id={id} />
            {label}
          </a>
        ))}
      </div>
    </>
  )
}

/** Runs a token request once, even when React runs the effect twice (StrictMode). */
const running = new Map<string, Promise<unknown>>()

function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  let promise = running.get(key) as Promise<T> | undefined
  if (!promise) {
    promise = run()
    running.set(key, promise)
    const forget = () => running.delete(key)
    promise.then(forget, forget)
  }
  return promise
}

function LoginPage({ status, next, error }: { status: AuthStatus | undefined; next: string; error: string | null }) {
  const signedIn = useSignedIn()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<string | null>(() => (error ? oauthErrorMessage(error) : null))
  const [busy, setBusy] = useState(false)

  // The error code came from an OAuth redirect: shown once, then gone from the address bar.
  useEffect(() => {
    if (error) dropQuery('login')
  }, [error])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!email.trim() || !password) {
      setProblem('Enter your email and password.')
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      signedIn(await api.login(email.trim(), password))
    } catch (failure) {
      setProblem(authErrorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <Card title="Log in" corner={{ href: '#/auth/signup', label: 'Sign up' }}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <Problem text={problem} />
        <ShimmerButton type="submit" className="primary" borderRadius="6px" disabled={busy}>
          Log in
        </ShimmerButton>
      </form>
      <p className="auth-links">
        <a href="#/auth/forgot">Forgot password?</a>
        <a href="#/auth/magic">Email me a sign-in link</a>
      </p>
      <ProviderButtons status={status} next={next} />
      <p className="auth-switch muted">
        New here? <a href="#/auth/signup">Create an account</a>
      </p>
    </Card>
  )
}

/** The first account (the admin), or a member's own account once the admin exists (open sign-up). */
function CreateAccountPage({ status, next, admin }: { status: AuthStatus | undefined; next: string; admin: boolean }) {
  const signedIn = useSignedIn()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const address = email.trim()
    const check = !EMAIL.test(address)
      ? 'Enter a valid email address.'
      : password.length < MIN_PASSWORD
        ? `Use at least ${MIN_PASSWORD} characters for the password.`
        : password !== confirm
          ? 'The passwords do not match.'
          : null
    setProblem(check)
    if (check) return
    setBusy(true)
    try {
      const displayName = name.trim()
      signedIn(await api.signup({ email: address, password, ...(displayName ? { display_name: displayName } : {}) }))
    } catch (failure) {
      setProblem(authErrorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <Card title={admin ? 'Create the admin account' : 'Sign up'} corner={admin ? undefined : { href: '#/auth/login', label: 'Log in' }}>
      <p className="muted auth-lead">
        {admin
          ? 'The first account is the admin, who invites everyone else. Create it to start.'
          : 'Create your own account. Your notes, lessons, chats and AI providers are yours only.'}
      </p>
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label="Display name (optional)" type="text" value={name} onChange={setName} autoComplete="name" autoFocus />
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
        <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <p className="muted auth-hint">At least {MIN_PASSWORD} characters.</p>
        <Problem text={problem} />
        <ShimmerButton type="submit" className="primary" borderRadius="6px" disabled={busy}>
          Create account
        </ShimmerButton>
      </form>
      <ProviderButtons status={status} next={next} firstVisit={admin} />
      {!admin && (
        <p className="auth-switch muted">
          Already have an account? <a href="#/auth/login">Log in</a>
        </p>
      )}
    </Card>
  )
}

/** An email form that always answers the same message (forgot password, magic link). */
function EmailRequest(props: {
  lead: string
  action: string
  status: AuthStatus | undefined
  send: (email: string) => Promise<{ message: string }>
}) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!EMAIL.test(email.trim())) {
      setProblem('Enter a valid email address.')
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      setSent((await props.send(email.trim())).message)
    } catch (failure) {
      setProblem(authErrorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="muted auth-lead">{props.lead}</p>
      {sent ? (
        <Sent text={sent} status={props.status} />
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
          <Problem text={problem} />
          <ShimmerButton type="submit" className="primary" borderRadius="6px" disabled={busy}>
            {props.action}
          </ShimmerButton>
        </form>
      )}
    </>
  )
}

function ForgotPage({ status }: { status: AuthStatus | undefined }) {
  return (
    <Card title="Reset your password">
      <EmailRequest
        lead="Enter the owner's email and we will send a link to set a new password."
        action="Send reset link"
        status={status}
        send={api.forgotPassword}
      />
      <p className="auth-links">
        <a href="#/auth/login">Back to log in</a>
      </p>
    </Card>
  )
}

function MagicRequestPage({ status }: { status: AuthStatus | undefined }) {
  return (
    <Card title="Sign in with an email link">
      <EmailRequest
        lead="Enter the owner's email and we will send a link that signs you in once."
        action="Send sign-in link"
        status={status}
        send={api.requestMagicLink}
      />
      <p className="auth-links">
        <a href="#/auth/login">Back to log in</a>
      </p>
    </Card>
  )
}

/** A 400 from a token route means the link is used up; other failures keep their message. */
const linkProblem = (failure: unknown) =>
  failure instanceof ApiError && failure.status === 400 ? USED_LINK : authErrorMessage(failure)

function MagicOpenPage({ token, status }: { token: string; status: AuthStatus | undefined }) {
  const signedIn = useSignedIn()
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    once(`magic:${token}`, () => api.consumeMagicLink(token)).then(
      (user) => {
        dropQuery('magic')
        if (live) signedIn(user)
      },
      (failure: unknown) => {
        dropQuery('magic')
        if (live) setProblem(linkProblem(failure))
      },
    )
    return () => {
      live = false
    }
  }, [token, signedIn])

  if (!problem) {
    return (
      <Card title="Signing you in">
        <p className="muted" role="status">
          Checking your sign-in link…
        </p>
      </Card>
    )
  }
  return (
    <Card title="Sign-in link not accepted">
      <Problem text={problem} />
      <EmailRequest
        lead="Ask for a new link:"
        action="Send sign-in link"
        status={status}
        send={api.requestMagicLink}
      />
      <p className="auth-links">
        <a href="#/auth/login">Back to log in</a>
      </p>
    </Card>
  )
}

function ResetPage({ token }: { token: string | null }) {
  const signedIn = useSignedIn()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!token) {
    return (
      <Card title="Set a new password">
        <Problem text="This link is incomplete. Ask for a new one." />
        <p className="auth-links">
          <a href="#/auth/forgot">Ask for a new link</a>
        </p>
      </Card>
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const check =
      password.length < MIN_PASSWORD
        ? `Use at least ${MIN_PASSWORD} characters for the password.`
        : password !== confirm
          ? 'The passwords do not match.'
          : null
    setProblem(check)
    if (check) return
    setBusy(true)
    try {
      const user = await api.resetPassword(token, password)
      dropQuery('reset')
      signedIn(user)
    } catch (failure) {
      setProblem(authErrorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <Card title="Set a new password">
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
        <Field label="Confirm new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <p className="muted auth-hint">At least {MIN_PASSWORD} characters. Other sessions are logged out.</p>
        <Problem text={problem} />
        <ShimmerButton type="submit" className="primary" borderRadius="6px" disabled={busy}>
          Set new password
        </ShimmerButton>
      </form>
      <p className="auth-links">
        <a href="#/auth/forgot">Ask for a new link</a>
      </p>
    </Card>
  )
}

const INVITE_GONE = 'This invitation has expired or was already used.'

function InvitePage({ token, status, next }: { token: string | null; status: AuthStatus | undefined; next: string }) {
  const signedIn = useSignedIn()
  const [info, setInfo] = useState<InvitationInfo | null>(null)
  const [gone, setGone] = useState(!token)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    let live = true
    once(`invite:${token}`, () => api.invitation(token)).then(
      (found) => {
        dropQuery('invite')
        if (live) setInfo(found)
      },
      () => {
        dropQuery('invite')
        if (live) setGone(true)
      },
    )
    return () => {
      live = false
    }
  }, [token])

  if (gone) {
    return (
      <Card title="Invitation not accepted">
        <Problem text={INVITE_GONE} />
        <p className="auth-links">
          <a href="#/auth/login">Back to log in</a>
        </p>
      </Card>
    )
  }
  if (!info || !token) {
    return (
      <Card title="Join Learning Hub">
        <p className="muted" role="status">
          Checking your invitation…
        </p>
      </Card>
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const check =
      password.length < MIN_PASSWORD
        ? `Use at least ${MIN_PASSWORD} characters for the password.`
        : password !== confirm
          ? 'The passwords do not match.'
          : null
    setProblem(check)
    if (check) return
    setBusy(true)
    try {
      const displayName = name.trim()
      signedIn(await api.acceptInvitation({ token, password, ...(displayName ? { display_name: displayName } : {}) }))
    } catch (failure) {
      if (failure instanceof ApiError && (failure.status === 404 || failure.status === 410)) setGone(true)
      else setProblem(authErrorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <Card title="Join Learning Hub">
      <p className="muted auth-lead">You were invited as {info.email}</p>
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label="Display name (optional)" type="text" value={name} onChange={setName} autoComplete="name" autoFocus />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
        <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <p className="muted auth-hint">At least {MIN_PASSWORD} characters.</p>
        <Problem text={problem} />
        <ShimmerButton type="submit" className="primary" borderRadius="6px" disabled={busy}>
          Create account
        </ShimmerButton>
      </form>
      {(status?.providers.github?.configured || status?.providers.google?.configured) && (
        <>
          <ProviderButtons status={status} next={next} />
          <p className="muted auth-hint">Use an account whose verified email is {info.email}.</p>
        </>
      )}
    </Card>
  )
}

function VerifyPage({ token }: { token: string | null }) {
  const client = useQueryClient()
  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed')
  const [problem, setProblem] = useState<string | null>(token ? null : 'This link is incomplete. Ask for a new one.')

  useEffect(() => {
    if (!token) return
    let live = true
    once(`verify:${token}`, () => api.verifyEmail(token)).then(
      () => {
        dropQuery('verify')
        void client.invalidateQueries({ queryKey: queryKeys.me })
        if (live) setState('done')
      },
      (failure: unknown) => {
        dropQuery('verify')
        if (!live) return
        setProblem(linkProblem(failure))
        setState('failed')
      },
    )
    return () => {
      live = false
    }
  }, [token, client])

  if (state === 'working') {
    return (
      <Card title="Verifying your email">
        <p className="muted" role="status">
          Checking your verification link…
        </p>
      </Card>
    )
  }
  if (state === 'done') {
    return (
      <Card title="Your email is verified">
        <p className="muted">You can now sign in with an email link.</p>
        <p className="auth-links">
          <a href="#/">Open Learning Hub</a>
        </p>
      </Card>
    )
  }
  return (
    <Card title="Email not verified">
      <Problem text={problem} />
      <p className="muted">Signed in, you can ask for a new link from the account menu.</p>
      <p className="auth-links">
        <a href="#/">Open Learning Hub</a>
      </p>
    </Card>
  )
}
