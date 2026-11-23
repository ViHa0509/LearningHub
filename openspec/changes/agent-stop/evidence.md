# Evidence: agent-stop

qc-ui (2026-11-23) inspected agent-stop-stopped-light/dark, agent-stop-history-light and agent-stop-retried-light: pass, no open defect. No screenshot shows the Stop button mid-run; the e2e test asserts it (`agent-stop.e2e.ts:90`).

## Accepted cosmetic

- agent-stop-stopped-*.png: the chat pet's "Done!" bubble also shows after a stopped turn. Existing chat-pet behaviour, no spec impact. Accepted; a follow-up can give the pet a stopped pose.
- agent-stop-stopped-dark.png: the small "Stopped" pill text is low contrast on dark but readable. Accepted.
