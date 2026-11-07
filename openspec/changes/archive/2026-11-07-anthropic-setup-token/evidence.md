# Evidence log: anthropic-setup-token

Built on 2026-11-07 by the main session (opus; key handling is security-sensitive under the routing table), after the owner reported problems saving a token from `claude setup-token`.

## Problems the owner reported, in order

| Report | Cause | Fix |
|---|---|---|
| "the key must be one word of at most 500 characters" | The terminal wraps the token, so the pasted value contained line breaks | Whitespace is removed before the key is checked (task 1.1) |
| Same error again after the fix | The dev backend's `--reload` hung on Windows: the old worker kept serving the old code | Restarted the backend; the dev backend now runs without `--reload` and is restarted after each backend change |
| 401 "Invalid bearer token" | The pasted value did not start with `sk-ant-oat` after whitespace was removed (quotes, a label, or an invisible character), so it was sent as an API key | `normalize_key` also drops format characters and surrounding quotes, and takes the single `sk-ant-…` token out of a longer paste; a rejected key says how it was sent |
| 401 "OAuth access token is invalid" | The token was now sent the right way, and Anthropic rejected the token itself: probably truncated in the copy, or expired or revoked | No app defect. The message now also gives the length and last four characters, so the owner can compare with the original |

## Checks

| Check | Result |
|---|---|
| Backend tests | 271 passed (verifier run), plus the message test after the last edit |
| Backend lint, format, types | pass |
| Frontend tests, lint, build | 129 passed, pass, pass |
| Frontend e2e | 44 passed; `providers.e2e.ts` placeholders updated to "Saved key (…1234)" |
| Verifier | **pass**; finding 1 (no route-level test for an `export X=` paste) is covered at unit level |

## Not done on purpose

The app does not pretend to be Claude Code, for example with a system prompt that claims to be Claude Code, to get past limits Anthropic puts on subscription tokens. A setup token is sent as-is, and the API's answer is shown. An Anthropic Console API key is the supported route.

## Not verified

No real setup token or API key was tested by the main session. The only live call used a made-up token, and Anthropic answered `authentication_error`, "OAuth access token is invalid". That confirms the OAuth path is used.
