"""Print kept videos (and optionally rejected candidates) for a list of works, for hand audits.

Usage: python3 scripts/audit_youtube.py @data/test50.txt [--rejected]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
args = sys.argv[1:]
ids = Path(args[0][1:]).read_text(encoding="utf-8").split() if args and args[0].startswith("@") else args[0].split(",")
works = {w["id"]: w for w in json.loads((ROOT / "data" / "works.json").read_text(encoding="utf-8"))}
n_kept = n_none = 0
for wid in ids:
    p = ROOT / "cache" / "youtube" / f"{wid}.json"
    if not p.exists():
        continue
    r = json.loads(p.read_text(encoding="utf-8"))
    w = works[wid]
    n_kept += len(r["videos"])
    n_none += not r["videos"]
    print(f"## {w['composer'].split()[-1]} {w['cat']} {w['title']}  [{len(r['videos'])} of {len(r['candidates'])}]")
    for v in r["videos"]:
        print(f"   + {v['title'][:80]} | {v['channel'][:22]} | {v['views'] // 1000}k | "
              f"{v['seconds'] // 60}:{v['seconds'] % 60:02d} | {v['why']} | {', '.join(v['pianists'])}")
    if "--rejected" in args:
        kept = {v["id"] for v in r["videos"]}
        for c in r["candidates"]:
            if c["id"] not in kept:
                print(f"   - {c['title'][:80]} | {c['channel'][:22]} | {c.get('reason', '')}")
print(f"\n{len(ids)} works, {n_kept} videos kept, {n_none} works with none")
