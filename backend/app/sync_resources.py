"""Sync a domain's reference links from roadmap.sh.

Usage: ``python -m app.sync_resources --domain frontend [--commit sha]``.
"""

import argparse
import sys

from app.config import get_settings
from app.db import make_engine, make_session_factory
from app.resources.mapping import load_mappings
from app.resources.sync import SyncError, sync_domain
from app.roadmaps import RoadmapCatalog


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync reference links from roadmap.sh.")
    parser.add_argument("--domain", required=True, help="domain id, e.g. frontend")
    parser.add_argument("--commit", help="commit to read instead of the mapping's pinned one")
    args = parser.parse_args(argv)

    settings = get_settings()
    catalog = RoadmapCatalog.load(settings.roadmaps_dir)
    mapping = load_mappings(settings.roadmaps_dir, catalog).get(args.domain)
    if mapping is None:
        print(f"no resource mapping for domain '{args.domain}'", file=sys.stderr)
        return 2
    engine = make_engine(settings.database_url)
    try:
        result = sync_domain(mapping, settings, make_session_factory(engine), args.commit)
    except SyncError as exc:
        print(f"sync failed: {exc}", file=sys.stderr)
        return 1
    finally:
        engine.dispose()
    print(f"{args.domain}: {result.links} links on {result.nodes} nodes at {result.commit}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
