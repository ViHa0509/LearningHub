## Why

The user wants one page that keeps up with the latest AI news from several trusted sources (for example MIT News on artificial intelligence), next to their learning, so they can read and ask the agent about it.

## What Changes

- **Sources:** a new `news/sources.yaml` lists the feeds (id, name, homepage, RSS/Atom URL) and is validated at startup. The first set, each checked to answer as RSS on 2026-11-08:
  - MIT News (AI): https://news.mit.edu/rss/topic/artificial-intelligence2
  - Google AI blog: https://blog.google/technology/ai/rss/
  - OpenAI News: https://openai.com/news/rss.xml
  - Hugging Face blog: https://huggingface.co/blog/feed.xml
  - MIT Technology Review (AI): https://www.technologyreview.com/topic/artificial-intelligence/feed
  - Berkeley AI Research blog: https://bair.berkeley.edu/blog/feed.xml
  - Apple Machine Learning Research: https://machinelearning.apple.com/rss.xml
  - AWS Machine Learning blog: https://aws.amazon.com/blogs/machine-learning/feed/
- **Fetch:**
  - **Triggers:** `POST /api/news/refresh` (`X-LearningHub: 1`) starts a background job that reads every feed, 4 at a time. It also starts by itself when the News page opens and the last refresh is older than 1 hour. `GET /api/news/refresh` returns the job status, with a result for each source.
  - **Safe fetch:** the feeds are read with the same rules as reference pages. Only global addresses are allowed, on every redirect, over a pinned connection. The limits are 2 MB, 10 s, and RSS/Atom/XML content types.
  - **Parsing:** RSS 2.0 and Atom feeds are parsed with the standard library. Feeds that declare a DTD or entities are refused.
- **Storage:** a new table `news_items` (Alembic `0008`): source, title, url (unique), published_at, summary, fetched_at.
  - The summary is plain text from the feed's own description, with HTML removed and cut to 400 characters.
  - Full articles are never stored; the page links to the original.
  - Items older than 90 days are removed at refresh.
- **API:** `GET /api/news?source=&q=&limit=&before=` returns items newest first, with filtering and paging. It also returns the sources and their last fetch result.
- **Page:** a "News" link in the top bar opens `#/news`:
  - source filter chips with counts, a text filter, and items grouped by day ("Today", "Yesterday", dates)
  - each item shows its source, time, title linking to the original in a new tab with `noopener noreferrer`, and the summary
  - "Ask the agent" puts "Explain this news for me: <title> (<url>)" in the chat
  - "Refresh" shows progress and which sources failed. Without any items yet, an empty state offers Refresh.
- Feed text is untrusted: it is shown as plain text, never as HTML. When the agent is asked about an item it gets only the title and the URL.

## Capabilities

### New Capabilities
- `ai-news`: sources, fetching, storage, API and the News page.

### Modified Capabilities

## Impact

- Backend:
  - `news/sources.yaml`
  - `app/news/` (sources, feed parser, refresh job)
  - `app/resources/fetch.py` (a feed fetch with XML content types, same safety rules)
  - `app/routes/news.py`, `app/db.py`, migration `0008`, tests with a fake feed server
- Frontend: `NewsPage.tsx`, a route `#/news`, the top bar link, `api.ts`, hooks, the fake API, CSS on tokens, Vitest.
- E2E: a fake feed server; the News page shows grouped items, filters, refresh with a failing source, Ask the agent.
