"""Merge the hand-written mood tags in data/mood_tags/*.txt ("work-id Ca Dr ...") into data/moods.json.

Usage: python3 scripts/merge_moods.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CODES = {"Ca": "Calm", "Dr": "Dreamy", "Te": "Tender", "Me": "Melancholy", "Pa": "Passionate", "St": "Stormy",
         "Da": "Dark", "He": "Heroic", "Jo": "Joyful", "Pl": "Playful", "Dn": "Dancing", "Vi": "Virtuosic",
         "Co": "Contemplative"}
p = ROOT / "data" / "moods.json"
moods = json.loads(p.read_text(encoding="utf-8"))
ids = {w["id"] for w in json.loads((ROOT / "data" / "works.json").read_text(encoding="utf-8"))}
errors = []
for f in sorted((ROOT / "data" / "mood_tags").glob("*.txt")):
    for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.startswith("#"):
            continue
        wid, *codes = line.split()
        if wid not in ids:
            errors.append(f"{f.name}:{n}: unknown work {wid}")
        elif wid in moods["works"]:
            continue  # tags already in moods.json (e.g. reviewed by hand) win
        elif not codes or any(c not in CODES for c in codes):
            errors.append(f"{f.name}:{n}: bad codes {codes}")
        else:
            moods["works"][wid] = [CODES[c] for c in codes]
moods["works"] = {k: v for k, v in moods["works"].items() if k in ids}
p.write_text(json.dumps(moods, ensure_ascii=False, indent=1), encoding="utf-8")
missing = sorted(ids - set(moods["works"]))
print(f"{len(moods['works'])} of {len(ids)} works tagged; {len(missing)} untagged: {missing[:20]}")
print("\n".join(errors) or "no errors")
