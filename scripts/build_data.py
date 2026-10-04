"""Combine works, movements, moods and YouTube results into docs/works.json (the one data file the site loads).

Usage: python3 scripts/build_data.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catalogue import COMPOSERS, PERIODS  # noqa: E402
from youtube_match import pianists_of  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA, YT, SITE = ROOT / "data", ROOT / "cache" / "youtube", ROOT / "docs"


def lifespans():
    """Composer -> 'YYYY–YYYY' from the Wikidata search cache (descriptions carry the years)."""
    comps = json.loads((ROOT / "cache" / "wikidata" / "composers.json").read_text(encoding="utf-8"))
    out = {}
    for name, c in comps.items():
        m = re.search(r"\((\d{4})\s*[-–]\s*(\d{4})\)", c.get("desc", ""))
        if m:
            out[name] = f"{m.group(1)}–{m.group(2)}"
    return out


YEARS = {  # composers whose Wikidata description has no years
    "Domenico Scarlatti": "1685–1757", "Muzio Clementi": "1752–1832", "John Field": "1782–1837",
    "Henry Litolff": "1818–1891", "Dmitry Kabalevsky": "1904–1987", "Cécile Chaminade": "1857–1944",
}


def main():
    works = json.loads((DATA / "works.json").read_text(encoding="utf-8"))
    moods = json.loads((DATA / "moods.json").read_text(encoding="utf-8"))
    movements = json.loads((DATA / "movements.json").read_text(encoding="utf-8"))
    years = {**lifespans(), **YEARS}
    composers = list(COMPOSERS)
    out, n_vid = [], 0
    for w in works:
        yt = YT / f'{w["id"]}.json'
        vids = json.loads(yt.read_text(encoding="utf-8"))["videos"] if yt.exists() else None
        rec = {
            "id": w["id"], "t": w["title"], "f": w["formal"] if w["formal"] != w["title"] else None,
            "c": composers.index(w["composer"]), "cat": w["cat"], "key": w["key"], "y": w["year"],
            "fm": w["form"], "o": 1 if w["type"] == "concerto" else None, "set": w["set"],
            "al": [a for a in w["aliases"][1:] + w["search"]] or None,
            "mv": movements.get(w["id"], {}).get("movements"),
            "moods": moods["works"].get(w["id"], []),
            "pop": w["pop"], "wp": w["enwiki"],
            # None = not searched yet; [] = searched, nothing relevant found
            "v": None if vids is None else [
                {"id": v["id"], "t": v["title"], "ch": v["channel"], "views": v["views"], "sec": v["seconds"],
                 "p": v.get("pianists") or pianists_of(v)} for v in vids],
        }
        n_vid += bool(rec["v"])
        out.append({k: v for k, v in rec.items() if v not in (None, "", []) or (k == "v" and v == [])})
    meta = {
        "moods": moods["moods"], "periods": PERIODS, "count": len(out),
        "composers": [{"n": c, "p": COMPOSERS[c], "y": years.get(c, "")} for c in composers],
    }
    SITE.mkdir(exist_ok=True)
    (SITE / "works.json").write_text(json.dumps({"meta": meta, "works": out}, ensure_ascii=False,
                                                separators=(",", ":")), encoding="utf-8")
    size = (SITE / "works.json").stat().st_size / 1e6
    print(f"docs/works.json: {len(out)} works, {n_vid} with videos, {size:.2f} MB")


if __name__ == "__main__":
    main()
