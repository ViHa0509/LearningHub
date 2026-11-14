# Proposal

## Why

Learning Hub is invite-only: after the admin exists, an account is created only from an invitation the admin sends. The owner wants people to be able to sign up by themselves (decided 2026-11-13: open sign-up, no approval step).

## What Changes

- **Sign up** is open: anyone can create a member account with email and password on a new Sign up page, linked from the login page. The account is signed in at once and gets a verification mail, as the admin account does today.
- Continue with GitHub or Google creates a member account for a verified provider email that has no account yet, instead of refusing it.
- An email that already has an account is refused with "An account with this email already exists" (log in or reset the password instead). A GitHub or Google sign-in with the email of an account that is not verified yet stays refused, now with its own message, so an unverified account cannot be taken over.
- Invitations keep working as before (an invited email is verified on accept). The first account is still the admin; every later one is a member. Members see only their own data, as today.
- Sign-up keeps its rate limit and the password rules.

Not in this change: an approval step, a switch to close sign-up again, CAPTCHA, blocking unverified members from using the app.

## Capabilities

### New Capabilities

### Modified Capabilities
- `accounts`: "Invite only" becomes "Open sign-up and invitations".

## Impact

- Backend: `app/routes/auth.py` (`signup`, `user_for`).
- Frontend: `components/AuthPages.tsx` (Sign up page and link, messages), `lib/route.ts` if the page needs a route.
- Tests that expected the refusal: `test_accounts.py`, `test_auth_email.py`, `test_auth_oauth.py`, `e2e/auth.e2e.ts`, `e2e/members.e2e.ts`, `Users.test.tsx`; new cases for the open sign-up.
- Risk: anyone on the internet can create accounts on the hosted copy. Their data is separate; agent use needs their own AI provider key.
