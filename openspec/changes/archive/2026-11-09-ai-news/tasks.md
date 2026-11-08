## 1. Backend

- [x] 1.1 `news/sources.yaml` and `app/news/sources.py` (validated at startup)
- [x] 1.2 Feed fetch in `app/resources/fetch.py` (same safety rules, XML content types, raw text) with tests
- [x] 1.3 Feed parser `app/news/feeds.py` (RSS 2.0 and Atom, no DTD or entities, plain-text summary up to 400 characters, dates) with tests on synthetic feeds
- [x] 1.4 `NewsItem` model and migration `0008_news_items` (up and down tested)
- [x] 1.5 Refresh job (4 at a time, per-source result, one source failing does not stop others, dedupe by URL, 90-day cleanup) and routes `POST/GET /api/news/refresh`, `GET /api/news`; tests with a fake feed server

## 2. Frontend

- [x] 2.1 `api.ts`, hooks and fake API for news
- [x] 2.2 `#/news` route, top bar "News" link, News page (day groups, source chips with counts, text filter, links with noopener noreferrer, Ask the agent, Refresh with progress and failed sources, auto-refresh when stale or empty); CSS on tokens
- [x] 2.3 Vitest for the page scenarios

## 3. E2E

- [x] 3.1 qc-e2e with a fake feed server (synthetic items only): first visit refresh, grouped items, filters, a failing source, Ask the agent; loop until the suite passes
