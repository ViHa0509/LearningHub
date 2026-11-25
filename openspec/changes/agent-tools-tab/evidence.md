# Evidence: agent-tools-tab

- qc-e2e: `frontend/e2e/agent-tools-tab.e2e.ts` (7 tests) with `responsive.e2e.ts` and `kh-connector.e2e.ts`: 82 passed, 23 skipped; again after the touch-size fix: 82 passed. `kh-connector.e2e.ts` now opens the card on `#/settings/agents/connections`. Full suite: run by the push gate.
- Full backend pytest: pass (run twice: main session and verifier).
- qc-ui: one major fixed (Remove buttons, tool dropdown and Add were ~32 px on phone; now 40 px in the coarse-pointer block, also the settings nav items). Open minors: the Connections title-to-intro gap is larger than on Tools; disabled Save/Add are pale (disabled state); no phone screenshot below the fold (Add/Save/Cancel) or of a connected KH card.
- Not e2e-testable (covered by pytest): both layers, Claude Code MCP list, tutor keeps its content tool, another user, backup round trip, reconnect notice link.
