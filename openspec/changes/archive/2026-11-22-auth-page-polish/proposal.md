# Proposal

## Why

The login page shows Continue with GitHub and Continue with Google as greyed-out buttons with "Not configured on this server" under each when the server has no OAuth app for them, which is the case on the hosted copy. The owner asked for a cleaner sign-in page in the style of common SSO pages: provider buttons with their logos, and a Sign up button at the top (2026-11-14).

## What Changes

- Only the sign-in methods the server has are offered: a provider without a client ID and secret is not shown at all, and the "or" divider goes with it when none is configured.
- Continue with GitHub and Continue with Google carry the provider's logo.
- On the first visit (Create the admin account), when no provider is configured, a short note says GitHub and Google sign-in can be added later in Settings -> Sign-in.
- The login page has a **Sign up** button at the top right of the page, the Sign up page a **Log in** button; the links at the bottom of the card stay.

Not in this change: email-first login, passkeys, SAML, new providers.

## Capabilities

### New Capabilities

### Modified Capabilities
- `auth`: "Sign in with GitHub or Google" - a provider that is not configured is not offered (instead of shown disabled); the "Remove a provider" scenario of "Sign-in settings" follows.

## Impact

- Frontend only: `components/AuthPages.tsx`, `index.css`.
- Tests: `Auth.test.tsx`, `e2e/auth.e2e.ts`, `e2e/owner.setup.ts`, `e2e/signin-settings.e2e.ts`, `e2e/signup.e2e.ts`.
