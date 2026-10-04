"""Add movements to multi-movement works from MusicBrainz (core data CC0).

Per work: find the MusicBrainz work through its Wikidata item (url lookup), or else by a search
on title + catalogue number restricted to the composer; then read its ordered "parts".
Every response is cached under cache/musicbrainz/; MusicBrainz asks for at most 1 request/second.
Writes data/movements.json: {work_id: {"mbid": ..., "title": ..., "movements": [...]}}.

Usage: python3 scripts/movements.py [--ids a,b]
"""
import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catalogue import norm_cat, norm_title, unaccent  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache" / "musicbrainz"
DATA = ROOT / "data"
MB = "https://musicbrainz.org/ws/2"
S = requests.Session()
S.headers["User-Agent"] = "PianoPersonalSite/0.1 ( smaju78.github.io )"
MULTI = {"sonata", "concerto", "suite", "partita", "sonatina", "fantasy", "concert piece", "rhapsody",
         "variations", "burleske", "ballade", "character piece", "bagatelle", "étude", "prelude", "dance",
         "waltz", "piece", "toccata", "intermezzo"}


def get(path, params):
    key = hashlib.md5(json.dumps([path, params], sort_keys=True).encode()).hexdigest()
    p = CACHE / f"{key}.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    for attempt in range(5):
        try:
            r = S.get(f"{MB}/{path}", params={**params, "fmt": "json"}, timeout=30)
        except requests.RequestException as e:
            print(f"  retry {attempt + 1}: {e}", flush=True)
            time.sleep(5 * (attempt + 1))
            continue
        time.sleep(1.1)
        if r.status_code == 404:
            data = None
            break
        if r.status_code in (429, 503):
            time.sleep(10 * (attempt + 1))
            continue
        r.raise_for_status()
        data = r.json()
        break
    else:
        raise RuntimeError(f"MusicBrainz failed: {path}")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def composer_mbids():
    p = ROOT / "cache" / "wikidata" / "composer_mbids.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    comps = json.loads((ROOT / "cache" / "wikidata" / "composers.json").read_text(encoding="utf-8"))
    values = " ".join(f"wd:{c['qid']}" for c in comps.values())
    r = S.get("https://query.wikidata.org/sparql", params={
        "query": f"SELECT ?c ?mb WHERE {{ VALUES ?c {{ {values} }} ?c wdt:P434 ?mb }}", "format": "json"}, timeout=60)
    r.raise_for_status()
    by_qid = {b["c"]["value"].rsplit("/", 1)[1]: b["mb"]["value"] for b in r.json()["results"]["bindings"]}
    out = {name: by_qid.get(c["qid"]) for name, c in comps.items()}
    p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


def via_wikidata(qid):
    d = get("url", {"resource": f"https://www.wikidata.org/wiki/{qid}", "inc": "work-rels"})
    if not d:
        return None
    works = [r["work"]["id"] for r in d.get("relations", []) if r.get("target-type") == "work"]
    return works[0] if len(works) == 1 else None


def via_search(work, arid):
    if not arid:
        return None
    title = re.sub(r'["“”]', "", work["formal"])
    qs = [f'work:"{title}" AND arid:{arid}']
    if work["cat"] and "–" not in work["cat"]:
        qs.insert(0, f'"{work["cat"]}" AND arid:{arid}')
    found = []
    for q in qs:
        found += (get("work", {"query": q, "limit": 25}) or {}).get("works", [])
    d = {"works": found}
    want_cat = norm_cat(work["cat"])
    want_key = (work["key"] or "").lower().replace("-", "‐")  # MusicBrainz uses U+2010 hyphens
    hits = []
    for w in (d or {}).get("works", []):
        t = w["title"].replace("‐", "-")
        if ": " in t or w.get("score", 0) < 80:  # a movement, not the whole work
            continue
        if want_cat and want_cat not in norm_cat(" ".join(re.findall(
                r"(?:op\.|BWV|K\.|D\.|S\.|L\.|Hob\.|Sz\.|M\.|B\.|WoO|FP)\s*[0-9IVX:]+[a-z]?(?:\s*,?\s*no\.\s*\d+)?", t, re.I))):
            continue
        if want_key and " in " in t.lower() and want_key.replace("‐", "-") not in t.lower():
            continue
        if norm_title(title) and not set(norm_title(title).split()) <= set(norm_title(t).split()):
            continue
        hits.append(w["id"])
    # duplicates exist on MusicBrainz: take the candidate with the most parts
    best = max(hits[:3], key=lambda h: len(parts(h)[1]), default=None)
    return best


def parts(mbid):
    d = get(f"work/{mbid}", {"inc": "work-rels"})
    if not d:
        return None, []
    out = []
    for r in d.get("relations", []):
        if r.get("type") == "parts" and r.get("direction") == "forward" and r.get("target-type") == "work":
            out.append((r.get("ordering-key") or 999, r["work"]["title"]))
    out.sort()
    return d.get("title"), [clean(t, d.get("title", "")) for _, t in out]


def clean(part, parent):
    """'Piano Sonata no. 14 ... op. 27 no. 2 "Moonlight": I. Adagio sostenuto' -> 'I. Adagio sostenuto'."""
    if part.startswith(parent):
        part = part[len(parent):]
    elif ": " in part:
        part = part.split(": ", 1)[1] if len(part.split(": ", 1)[0]) > 12 else part
    return part.lstrip(" :,-–").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    a = ap.parse_args()
    works = json.loads((DATA / "works.json").read_text(encoding="utf-8"))
    if a.ids:
        works = [w for w in works if w["id"] in set(a.ids.split(","))]
    arids = composer_mbids()
    out_p = DATA / "movements.json"
    out = json.loads(out_p.read_text(encoding="utf-8")) if out_p.exists() else {}
    todo = [w for w in works if w["form"] in MULTI and not re.search(r"No\.\s*\d+$", w["cat"]) or w["type"] == "concerto"
            or w["form"] in ("sonata", "suite", "partita")]
    n_found = 0
    for i, w in enumerate(todo, 1):
        mbid = (via_wikidata(w["wikidata"]) if w["wikidata"] else None) or via_search(w, arids.get(w["composer"]))
        if not mbid:
            continue
        title, movs = parts(mbid)
        if len(movs) >= 2:
            out[w["id"]] = {"mbid": mbid, "title": title, "movements": movs}
            n_found += 1
        if i % 25 == 0:
            print(f"  {i}/{len(todo)} checked, {n_found} with movements", flush=True)
            out_p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    out_p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(todo)} works checked; {n_found} with movements this run; {len(out)} in data/movements.json")


if __name__ == "__main__":
    main()
