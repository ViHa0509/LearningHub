# Design: loading indicator while the app starts

1. **One look, two places.** A class `app-loading` in `index.css`: fixed to the viewport, centered, `var(--bg)` behind it, the existing `.spinner` followed by the text "Loading…" in the muted color. Both places use the same markup, so nothing moves when React takes over:
   `<p class="app-loading muted" role="status"><span class="spinner" aria-hidden="true"></span>Loading…</p>`
2. **Static copy in `index.html`**, inside `<div id="root">`. `createRoot(...).render` replaces it. The built page links the stylesheet in `<head>`, so the indicator is styled at first paint. No inline script and no inline style: nothing new for a content security policy. In development the stylesheet arrives with the JavaScript, so the text may show unstyled for a moment; that is accepted.
3. **`AppShell` loading branch**: `<main className="auth-page" aria-busy="true">` now holds that indicator. `aria-label="Loading"` on `main` goes, since the status text says it.
4. **Unchanged**: the service-unavailable page still wins over the indicator, auth pages still wait only for the status, and no data is requested before the session is known.
5. The theme the user chose in the app is applied by JavaScript, as today; until then the indicator follows the operating system theme.
