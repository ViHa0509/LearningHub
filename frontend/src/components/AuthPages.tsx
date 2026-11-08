import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, api, queryKeys, type AuthStatus, type OAuthProvider } from '../api'
import { authErrorMessage, useSignedIn } from '../lib/auth'
import { dropQuery, type AuthRoute } from '../lib/authRoute'

const MIN_PASSWORD = 10
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const OUTBOX_NOTE = 'Email is not configured: the link was written to storage/outbox on the server.'
const USED_LINK = 'This link has expired or was already used.'

/** Readable text for the `?error=` code an OAuth callback redirects with. */
const OAUTH_ERRORS: Record<string, string> = {
  state_mismatch: 'The sign-in could not be confirmed (it was started in another browser or took too long). Try again.',
  access_denied: 'The sign-in was cancelled at the provider.',
  owner_exists: 'This app has an owner already',
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
    case 'login':
    case 'create':
      return noOwner ? (
        <CreateOwnerPage status={status} next={next} />
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
  }
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-page" aria-label={title}>
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

function ProviderButtons({ status, next }: { status: AuthStatus | undefined; next: string }) {
  return (
    <div className="auth-providers">
      {PROVIDERS.map(({ id, label }) =>
        status?.providers[id]?.configured ? (
          <a key={id} className="button-link auth-provider" href={api.oauthStartUrl(id, next)}>
            {label}
          </a>
        ) : (
          <div key={id} className="auth-provider-off">
            <button type="button" className="auth-provider" disabled aria-describedby={`auth-${id}-off`}>
              {label}
            </button>
            <p id={`auth-${id}-off`} className="muted">
              Not configured on this server
            </p>
          </div>
        ),
      )}
    </div>
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
    <Card title="Log in">
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <Problem text={problem} />
        <button type="submit" className="primary" disabled={busy}>
          Log in
        </button>
      </form>
      <p className="auth-links">
        <a href="#/auth/forgot">Forgot password?</a>
        <a href="#/auth/magic">Email me a sign-in link</a>
      </p>
      <p className="auth-or muted">or</p>
      <ProviderButtons status={status} next={next} />
    </Card>
  )
}

function CreateOwnerPage({ status, next }: { status: AuthStatus | undefined; next: string }) {
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
    <Card title="Create the owner account">
      <p className="muted auth-lead">Learning Hub has one account, yours. Create it to start.</p>
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label="Display name (optional)" type="text" value={name} onChange={setName} autoComplete="name" autoFocus />
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
        <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <p className="muted auth-hint">At least {MIN_PASSWORD} characters.</p>
        <Problem text={problem} />
        <button type="submit" className="primary" disabled={busy}>
          Create account
        </button>
      </form>
      <p className="auth-or muted">or</p>
      <ProviderButtons status={status} next={next} />
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
          <button type="submit" className="primary" disabled={busy}>
            {props.action}
          </button>
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
        <button type="submit" className="primary" disabled={busy}>
          Set new password
        </button>
      </form>
      <p className="auth-links">
        <a href="#/auth/forgot">Ask for a new link</a>
      </p>
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
