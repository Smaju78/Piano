"""Refresh stored YouTube data so nothing is kept longer than 30 days without a refresh
(YouTube API Services Developer Policies).

- Re-fetches every kept video with videos.list (50 ids per call, 1 unit each): updates title,
  channel, duration, views and likes; removes videos that are deleted or no longer embeddable.
- Deletes the cached search candidates of works fetched more than 30 days ago.
- Records the run in cache/youtube/_refresh.json; with --if-older N it does nothing if the
  last refresh was less than N days ago (so it can be called from the daily task).

Usage: python3 scripts/refresh_stats.py [--if-older 28]
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from youtube_match import OUT, QuotaExceeded, api_key, call, iso_seconds, load_quota, save_quota  # noqa: E402

STAMP = OUT / "_refresh.json"
KEEP_CANDIDATES_DAYS = 30


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--if-older", type=int, default=0, help="skip unless the last refresh is at least N days old")
    a = ap.parse_args()
    now = datetime.now(timezone.utc)
    if a.if_older and STAMP.exists():
        last = datetime.fromisoformat(json.loads(STAMP.read_text())["last"])
        if now - last < timedelta(days=a.if_older):
            print(f"Refresh not due (last: {last.date()}).")
            return

    files = sorted(p for p in OUT.glob("*.json") if not p.name.startswith("_"))
    data = {p: json.loads(p.read_text(encoding="utf-8")) for p in files}
    ids = sorted({v["id"] for r in data.values() for v in r.get("videos", [])})
    print(f"Refreshing {len(ids)} videos from {len(files)} works ({-(-len(ids) // 50)} units).", flush=True)

    key, quota, fresh = api_key(), load_quota(), {}
    try:
        for i in range(0, len(ids), 50):
            res = call("videos", {"part": "snippet,contentDetails,statistics,status",
                                  "id": ",".join(ids[i:i + 50]), "key": key})
            quota["used"] += 1
            for it in res.get("items", []):
                sn, st = it["snippet"], it.get("statistics", {})
                fresh[it["id"]] = {
                    "title": sn["title"], "channel": sn["channelTitle"],
                    "views": int(st.get("viewCount", 0)), "likes": int(st.get("likeCount", 0)),
                    "seconds": iso_seconds(it["contentDetails"].get("duration")),
                    "embeddable": it.get("status", {}).get("embeddable", False),
                }
    except QuotaExceeded as e:
        save_quota(quota)
        sys.exit(f"Stopped: YouTube says {e}. Nothing was changed; run again tomorrow.")
    save_quota(quota)

    removed = pruned = 0
    cutoff = now - timedelta(days=KEEP_CANDIDATES_DAYS)
    for p, r in data.items():
        kept = []
        for v in r.get("videos", []):
            f = fresh.get(v["id"])
            if f and f["embeddable"]:
                kept.append({**v, **f})
            else:
                removed += 1
        kept.sort(key=lambda v: v["views"], reverse=True)
        r["videos"] = kept
        r["refreshed"] = now.isoformat(timespec="seconds")
        fetched = datetime.fromisoformat(r.get("fetched", now.isoformat()).replace("Z", "+00:00"))
        if r.get("candidates") and fetched < cutoff:
            r["candidates"] = []
            pruned += 1
        p.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
    STAMP.write_text(json.dumps({"last": now.isoformat(timespec="seconds")}))
    print(f"Done: {len(fresh)} videos refreshed, {removed} removed (deleted or not embeddable), "
          f"candidates pruned for {pruned} works.")


if __name__ == "__main__":
    main()
