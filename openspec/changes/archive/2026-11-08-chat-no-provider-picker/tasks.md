## 1. Frontend

- [x] 1.1 Remove the provider select from the composer, the override from the chat request, and the `learninghub.agent` storage
- [x] 1.2 Vitest: no "Provider" control; the request carries no `provider_id`; existing tests that used the select move to assignments

## 2. E2E

- [x] 2.1 Update e2e tests that used the "Provider" select (override test via the API; error-row Retry via Settings → Agents or another failing setup); loop until the suite passes
