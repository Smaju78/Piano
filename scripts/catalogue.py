"""Build the catalogue of solo piano works and piano concertos.

Stages (each resumable; responses are cached under cache/):
  composers - resolve composer names to Wikidata items (cache/wikidata/composers.json)
  wikidata  - every work by each composer, with instrumentation, genre, catalogue codes, key,
              dates, parts and sitelinks (one SPARQL query per composer, cached)
  merge     - filter to piano works, join sets and parts, write data/works.json

Usage: python3 scripts/catalogue.py [composers] [wikidata] [merge]   (default: all)
"""
import json
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache" / "wikidata"
DATA = ROOT / "data"
UA = "PianoPersonalSite/0.1 (personal non-commercial project)"
S = requests.Session()
S.headers["User-Agent"] = UA

# Composer -> period (the site's period is the composer's, which is how listeners browse).
COMPOSERS = {
    "Johann Sebastian Bach": "Baroque", "George Frideric Handel": "Baroque",
    "Domenico Scarlatti": "Baroque", "Jean-Philippe Rameau": "Baroque", "François Couperin": "Baroque",
    "Joseph Haydn": "Classical", "Wolfgang Amadeus Mozart": "Classical", "Muzio Clementi": "Classical",
    "Ludwig van Beethoven": "Classical", "Johann Nepomuk Hummel": "Classical",
    "Franz Schubert": "Romantic", "Carl Maria von Weber": "Romantic", "John Field": "Romantic",
    "Felix Mendelssohn": "Romantic", "Frédéric Chopin": "Romantic", "Robert Schumann": "Romantic",
    "Clara Schumann": "Romantic", "Franz Liszt": "Romantic", "Charles-Valentin Alkan": "Romantic",
    "Henry Litolff": "Romantic", "César Franck": "Romantic", "Johannes Brahms": "Romantic",
    "Camille Saint-Saëns": "Romantic", "Mily Balakirev": "Romantic", "Modest Mussorgsky": "Romantic",
    "Pyotr Ilyich Tchaikovsky": "Romantic", "Antonín Dvořák": "Romantic", "Edvard Grieg": "Romantic",
    "Nikolai Rimsky-Korsakov": "Romantic",
    "Isaac Albéniz": "Late Romantic", "Enrique Granados": "Late Romantic", "Gabriel Fauré": "Late Romantic",
    "Cécile Chaminade": "Late Romantic", "Alexander Scriabin": "Late Romantic",
    "Sergei Rachmaninoff": "Late Romantic", "Nikolai Medtner": "Late Romantic",
    "Ferruccio Busoni": "Late Romantic", "Richard Strauss": "Late Romantic", "Edward MacDowell": "Late Romantic",
    "Claude Debussy": "Impressionist", "Maurice Ravel": "Impressionist", "Erik Satie": "Impressionist",
    "Manuel de Falla": "Impressionist", "Federico Mompou": "Impressionist",
    "Karol Szymanowski": "20th century", "Leoš Janáček": "20th century", "Béla Bartók": "20th century",
    "Sergei Prokofiev": "20th century", "Francis Poulenc": "20th century", "George Gershwin": "20th century",
    "Dmitri Shostakovich": "20th century", "Olivier Messiaen": "20th century", "Aram Khachaturian": "20th century",
    "Dmitry Kabalevsky": "20th century", "Heitor Villa-Lobos": "20th century", "Alberto Ginastera": "20th century",
    "Samuel Barber": "20th century", "Aaron Copland": "20th century", "György Ligeti": "20th century",
}

PIANO = {"Q5994"}  # piano
KEYBOARD = {"Q5994", "Q52954", "Q81982", "Q180744", "Q1131993", "Q1061298"}  # piano, keyboard, harpsichord, clavichord, fortepiano, piano solo?
ORCH = {"Q42998", "Q1424116", "Q5309"}  # orchestra, string orchestra, ...
PIANO_CONCERTO = "Q1746028"
PIANO_SONATA = "Q1546995"


def get_json(url, path, delay=1.0, **params):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    for attempt in range(5):
        try:
            r = S.get(url, params=params, timeout=180)
            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After", 0) or 0) or 60 * (attempt + 1)
                print(f"  429, sleeping {wait}s", flush=True)
                time.sleep(wait)
                continue
            r.raise_for_status()
            break
        except requests.RequestException as e:
            print(f"  retry {attempt + 1}: {url} ({e})", flush=True)
            time.sleep(10 * (attempt + 1))
    else:
        raise RuntimeError(f"failed: {url}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(r.text, encoding="utf-8")
    time.sleep(delay)
    return r.json()


def sparql(q, path):
    return get_json("https://query.wikidata.org/sparql", path, 2.0, query=q, format="json")["results"]["bindings"]


# ---------------------------------------------------------------- composers
def stage_composers():
    out_p = CACHE / "composers.json"
    known = json.loads(out_p.read_text(encoding="utf-8")) if out_p.exists() else {}
    for name in COMPOSERS:
        if name in known:
            continue
        r = get_json("https://www.wikidata.org/w/api.php", CACHE / "search" / f"{name}.json", 0.5,
                     action="wbsearchentities", search=name, language="en", format="json", limit=5)
        hit = next((x for x in r["search"] if "compos" in x.get("description", "").lower()), None)
        if not hit:
            print(f"  NOT FOUND: {name}")
            continue
        known[name] = {"qid": hit["id"], "desc": hit.get("description", "")}
        print(f"  {name}: {hit['id']} ({hit.get('description', '')})")
    out_p.write_text(json.dumps(known, ensure_ascii=False, indent=1), encoding="utf-8")


# ---------------------------------------------------------------- wikidata works
WORKS_Q = """SELECT ?w ?wLabel ?enwiki ?links
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?inst), "entity/"); separator="|") AS ?instr)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?type), "entity/"); separator="|") AS ?types)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?genre), "entity/"); separator="|") AS ?genres)
  (GROUP_CONCAT(DISTINCT CONCAT(?code, "@", COALESCE(?catLabel, "")); separator="|") AS ?codes)
  (GROUP_CONCAT(DISTINCT ?keyLabel; separator="|") AS ?keys)
  (MIN(YEAR(?date)) AS ?year)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?parent), "entity/"); separator="|") AS ?parents)
  (SAMPLE(?ord) AS ?ordinal)
  (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases)
WHERE {
  ?w wdt:P86 wd:%s .
  OPTIONAL { ?w wikibase:sitelinks ?links . }
  OPTIONAL { ?enwiki schema:about ?w ; schema:isPartOf <https://en.wikipedia.org/> . }
  OPTIONAL { ?w wdt:P870 ?inst . }
  OPTIONAL { ?w wdt:P31 ?type . }
  OPTIONAL { ?w wdt:P136 ?genre . }
  OPTIONAL { ?w p:P528 ?cs . ?cs ps:P528 ?code . OPTIONAL { ?cs pq:P972 ?cat . ?cat rdfs:label ?catLabel . FILTER(LANG(?catLabel) = "en") } }
  OPTIONAL { ?w wdt:P826 ?key . ?key rdfs:label ?keyLabel . FILTER(LANG(?keyLabel) = "en") }
  OPTIONAL { ?w wdt:P571|wdt:P577 ?date . }
  OPTIONAL { ?w p:P361 ?ps . ?ps ps:P361 ?parent . OPTIONAL { ?ps pq:P1545 ?ord . } }
  OPTIONAL { ?w skos:altLabel ?alias . FILTER(LANG(?alias) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr,de,pl,ru,es,it". }
} GROUP BY ?w ?wLabel ?enwiki ?links"""


def stage_wikidata():
    comps = json.loads((CACHE / "composers.json").read_text(encoding="utf-8"))
    for name, c in comps.items():
        p = CACHE / "works" / f"{c['qid']}.json"
        if p.exists():
            continue
        rows = sparql(WORKS_Q % c["qid"], p)
        print(f"  {name}: {len(rows)} works", flush=True)


# ---------------------------------------------------------------- merge
CANON = DATA / "canon"
PERIODS = ["Baroque", "Classical", "Romantic", "Late Romantic", "Impressionist", "20th century"]
KEY_RE = re.compile(r"\bin ([A-G](?:-flat|-sharp)? (?:major|minor))\b")
# Wikidata catalogue (qualifier label substring) -> prefix used when the code is a bare number
CAT_PREFIX = {"köchel": "K", "kirkpatrick": "K", "bach-werke": "BWV", "hoboken": "Hob.", "deutsch": "D",
              "lesure": "L", "marnat": "M", "szőllősy": "Sz", "liszt": "S", "woo": "WoO", "brown": "B",
              "händel-werke": "HWV", "hwv": "HWV", "poulenc": "FP"}
LABEL_CAT_RE = re.compile(
    r"(?<![A-Za-z])((?i:op\.?|opus)|BWV|KV|K\.|D\.?|S\.|L\.|Hob\.|H\.|Sz\.?|M\.|B\.|WoO|FP|HWV)\s*"
    r"([0-9]+[a-z]?(?::[0-9]+)?|[IVX]+:[0-9]+)(?:\s*,?\s*(?i:no\.?|nr\.?)\s*([0-9]+))?")
BAD_TYPES = {"Q11424", "Q482994", "Q24862", "Q202866", "Q5398426", "Q7725634", "Q134556", "Q7366",
             "Q58483083", "Q1344", "Q15079786", "Q112572383"}  # films, albums, singles, operas, ballet productions...


GROUP_BLOCKS = {"Ballades", "Scherzos", "Impromptus", "Nocturnes", "Waltzes", "Polonaises", "Mazurkas",
                "Piano sonatas", "Keyboard sonatas", "Piano concertos"}
OPUS_BLOCKS = {"Lyric Pieces", "Songs without Words"}


def unaccent(s):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm_cat(s):
    """'Op. 9 No. 2', 'op.9, no.2', 'Op 9/2' -> 'op9-2'; 'KV 331' -> 'k331'; 'Hob. XVI:52' -> 'hobxvi:52'."""
    s = unaccent(s or "").lower().replace("opus", "op")
    s = re.sub(r"\bkv\b", "k", s)
    s = re.sub(r"[\s.,]+", "", s)
    s = re.sub(r"(\d[a-z]?)(?:no|nr|n°|/)(\d)", r"\1-\2", s)
    return s


def norm_title(s):
    s = unaccent(s or "").lower()
    s = re.sub(r",?\s*\b(op|bwv|k|kv|d|s|l|hob|sz|m|b|woo|fp|hwv)\b\.?\s*[0-9ivx:]+[a-z]?(\s*,?\s*no\.?\s*\d+)?", " ", s)
    s = KEY_RE.sub(" ", s.replace("in c sharp", "in c-sharp"))
    s = re.sub(r"\bin [a-g](-flat|-sharp)? (major|minor)\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def norm_key(k):
    k = unaccent(k or "").lower().replace("♯", "-sharp").replace("♭", "-flat").replace(" sharp", "-sharp").replace(" flat", "-flat")
    return k.strip()


def parse_canon():
    works = []
    for path in sorted(CANON.glob("*.txt")):
        composer, block = None, ("-", "", "")
        for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            line = raw.strip()
            if line.startswith("#") and not line.startswith("##"):
                continue
            if not line:
                continue
            if line.startswith("@"):
                composer = line[1:].strip()
                if composer not in COMPOSERS:
                    sys.exit(f"{path.name}:{n}: unknown composer {composer}")
                block = ("-", "", "")
                continue
            if line.startswith("##"):
                f = [x.strip() for x in line[2:].split("|")] + ["", ""]
                block = (f[0] or "-", f[1], f[2])
                continue
            f = [x.strip() for x in line.split("|")] + ["", "", ""]
            cat, formal, year, form, aliases = f[0], f[1], f[2] or block[1], f[3] or block[2], f[4]
            if not formal:
                sys.exit(f"{path.name}:{n}: no title")
            al = [a.strip() for a in aliases.split(";") if a.strip()]
            m = KEY_RE.search(formal)
            works.append({
                "composer": composer, "cat": "" if cat == "-" else cat, "formal": formal,
                "year": int(year) if year else None, "form": form or "piece",
                "set": "" if block[0] == "-" else block[0],
                "aliases": [a for a in al if not a.startswith("+")],
                "search": [a[1:].strip() for a in al if a.startswith("+")],
                "key": m.group(1) if m else "", "src": f"{path.name}:{n}",
            })
    return works


def wd_index(qid):
    rows = json.loads((CACHE / "works" / f"{qid}.json").read_text(encoding="utf-8"))["results"]["bindings"]
    out = []
    for b in rows:
        v = lambda k: b.get(k, {}).get("value", "")  # noqa: E731
        split = lambda k: [x for x in v(k).split("|") if x]  # noqa: E731
        types = set(split("types"))
        if types & BAD_TYPES:
            continue
        toks = set()
        for c in split("codes"):
            code, _, catl = c.partition("@")
            if re.fullmatch(r"[0-9]+[a-z]?(/[0-9]+[a-z]?)?|[IVX]+:[0-9]+", code.strip()):
                pre = next((p for k, p in CAT_PREFIX.items() if k in catl.lower()), None)
                if not pre:
                    continue
                for part in code.split("/"):
                    toks.add(norm_cat(f"{pre} {part}"))
            else:
                toks.add(norm_cat(code))
        label = v("wLabel")
        for m in LABEL_CAT_RE.finditer(label):
            pre = "Hob." if m.group(1) == "H." else m.group(1)
            toks.add(norm_cat(f"{pre} {m.group(2)}" + (f" No. {m.group(3)}" if m.group(3) else "")))
            if m.group(3):
                toks.add(norm_cat(f"{pre} {m.group(2)}"))
        out.append({
            "qid": v("w").rsplit("/", 1)[-1], "label": label, "aliases": split("aliases"),
            "enwiki": v("enwiki"), "links": int(v("links") or 0), "instr": set(split("instr")),
            "types": types, "genres": set(split("genres")), "keys": [norm_key(k) for k in split("keys")] or [norm_key(m.group(1)) for m in [KEY_RE.search(label.replace(" Major", " major").replace(" Minor", " minor"))] if m],
            "year": int(v("year")) if v("year") else None, "parents": split("parents"), "toks": toks,
            "ordinal": v("ordinal"),
        })
    return out


def is_keyboard(w):
    return bool(w["instr"] & KEYBOARD) and w["instr"] <= (KEYBOARD | ORCH)


def match(work, items):
    """Best Wikidata item for a canon work: catalogue number, then opus + key, then title."""
    key = norm_key(work["key"])
    def best(cands):
        cands = sorted(cands, key=lambda w: (not (key and key in w["keys"]), not is_keyboard(w), -w["links"]))
        return cands[0] if cands else None
    cat = norm_cat(work["cat"])
    if cat:
        hit = best([w for w in items if cat in w["toks"]])
        if hit:
            return hit, "cat"
        base = re.sub(r"-\d+$", "", cat)
        if base != cat and key:
            c = [w for w in items if base in w["toks"] and w["keys"] == [key]]
            num = cat.rsplit("-", 1)[1]
            c2 = [w for w in c if re.search(rf"\bno\.?\s*{num}\b", w["label"], re.I)]
            if len(c2) == 1 or len(c) == 1:
                return (c2 or c)[0], "opus+key"
    names = {norm_title(work["formal"])} | {norm_title(a) for a in work["aliases"]}
    names.discard("")
    c = [w for w in items if names & ({norm_title(w["label"])} | {norm_title(a) for a in w["aliases"]})]
    if key:
        c = [w for w in c if not w["keys"] or key in w["keys"]]
    if cat:  # a different catalogue number on Wikidata means a different work
        c = [w for w in c if not w["toks"] or cat in w["toks"]]
    if len({w["qid"] for w in c}) == 1 or (c and len(c) <= 3 and is_keyboard(best(c))):
        return best(c), "title"
    return None, ""


def slug(s):
    s = unaccent(s).lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def concerto_form(formal):
    t = formal.lower()
    for word, form in (("concerto", "concerto"), ("rhapsod", "rhapsody"), ("variation", "variations"),
                       ("fantas", "fantasy"), ("burleske", "burleske"), ("ballade", "ballade")):
        if word in t:
            return form
    return "concert piece"


def stage_merge():
    comps = json.loads((CACHE / "composers.json").read_text(encoding="utf-8"))
    works = parse_canon()
    report, by_comp, matched_qids = [], {}, set()
    for w in works:
        items = by_comp.setdefault(w["composer"], wd_index(comps[w["composer"]]["qid"]))
        hit, how = match(w, items)
        w["wikidata"], w["enwiki"], w["links"] = None, None, 0
        if hit:
            matched_qids.add(hit["qid"])
            matched_qids.update(hit["parents"])
            w["wikidata"], w["enwiki"], w["links"] = hit["qid"], hit["enwiki"] or None, hit["links"]
            k = norm_key(w["key"])
            if k and hit["keys"] and k not in hit["keys"]:
                report.append(f"KEY  {w['src']}: {w['composer']} {w['cat']} '{w['formal']}' vs Wikidata {hit['qid']} "
                              f"'{hit['label']}' key {hit['keys']} ({how})")
            if not k and len(hit["keys"]) == 1:
                w["key"] = hit["keys"][0][:1].upper() + hit["keys"][0][1:]
            exact = hit["year"] and hit["year"] % 10  # Wikidata decade-precision dates come out as 1830
            if exact and w["year"] and abs(hit["year"] - w["year"]) > 5:
                report.append(f"YEAR {w['src']}: {w['composer']} {w['cat']} '{w['formal']}' {w['year']} vs Wikidata "
                              f"{hit['year']} ({hit['qid']} '{hit['label']}', {how})")
            if not w["year"] and exact:
                w["year"] = hit["year"]
    # Block names that only group records (Nocturnes, Piano sonatas) are not sets; numbered members
    # get their real set from the opus: "Nocturne in B-flat minor", Op. 9 No. 1 -> "Nocturnes, Op. 9".
    for w in works:
        base = re.sub(r"\s+No\.\s*\d+$", "", w["cat"])
        numbered = base != w["cat"]
        if w["set"] in GROUP_BLOCKS:
            word = re.split(r" in | No\.|,", w["formal"])[0].strip()
            w["set"] = (word + ("es" if word.endswith(("z", "s", "x")) else "s") + ", " + base) if numbered else ""
        elif w["set"] in OPUS_BLOCKS:
            w["set"] = f"{w['set']}, {base}" if numbered else w["set"]
    # parent records: "Op. 15 No. 7" belongs to the record "Op. 15" by the same composer
    by_cat = {(w["composer"], norm_cat(w["cat"])): w for w in works if w["cat"]}
    for w in works:
        base = re.sub(r"-\d+$", "", norm_cat(w["cat"]))
        parent = by_cat.get((w["composer"], base)) if w["cat"] and base != norm_cat(w["cat"]) else None
        if parent and parent is not w:
            w["set"] = parent["formal"]
    # ids, display titles, type, period
    seen = set()
    for w in works:
        # surname, except where two composers share one (Robert and Clara Schumann)
        sur = slug(w["composer"]) if w["composer"] == "Clara Schumann" else slug(w["composer"].split()[-1])
        base = f"{sur}-{slug(w['cat'])}" if w["cat"] else f"{sur}-{slug(w['formal'])}"
        wid, i = base, 2
        while wid in seen:
            wid, i = f"{base}-{i}", i + 1
        seen.add(wid)
        w["id"] = wid
        w["title"] = w["aliases"][0] if w["aliases"] else w["formal"]
        w["type"] = "concerto" if w["form"] == "concerto" else "solo"
        if w["type"] == "concerto":
            w["form"] = concerto_form(w["formal"])
        w["period"] = COMPOSERS[w["composer"]]
    # popular list
    pop = []
    for n, raw in enumerate((DATA / "popular.txt").read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip() or raw.startswith("#"):
            continue
        sur, ref, label = [x.strip() for x in raw.split("|")]
        cands = [w for w in works if w["composer"] == sur or w["composer"].endswith(" " + sur)]
        if sur == "Schumann":
            cands = [w for w in cands if w["composer"] == "Robert Schumann"]
        hit = [w for w in cands if w["cat"] and norm_cat(w["cat"]) == norm_cat(ref)]
        if not hit:
            nt = norm_title(ref)
            hit = [w for w in cands if nt and nt in {norm_title(w["formal"])} | {norm_title(a) for a in w["aliases"] + w["search"]}]
        if len(hit) != 1:
            report.append(f"POP  popular.txt:{n}: '{raw}' -> {len(hit)} matches")
            continue
        if hit[0]["id"] not in pop:
            pop.append(hit[0]["id"])
    rank = {wid: i + 1 for i, wid in enumerate(pop)}
    for w in works:
        w["pop"] = rank.get(w["id"])
    # gaps: well-known Wikidata keyboard works that no canon record covers
    gaps = []
    set_names = {norm_title(w["set"]) for w in works} | {norm_title(w["formal"]) for w in works}
    for comp, items in by_comp.items():
        for it in items:
            if it["qid"] in matched_qids or it["links"] < 5 or not is_keyboard(it) or norm_title(it["label"]) in set_names:
                continue
            gaps.append((it["links"], comp, it["qid"], it["label"]))
    for comp in COMPOSERS:
        if comp not in by_comp:
            report.append(f"NONE {comp}: no canon works")
    gaps.sort(reverse=True)
    report += [f"GAP  {links:3} links  {comp}: {label} ({qid})" for links, comp, qid, label in gaps]

    keys = ["id", "title", "formal", "composer", "cat", "key", "year", "period", "form", "type", "set",
            "aliases", "search", "pop", "wikidata", "enwiki", "links"]
    order = {c: i for i, c in enumerate(COMPOSERS)}
    works.sort(key=lambda w: order[w["composer"]])
    out = [{k: w[k] for k in keys} for w in works]
    (DATA / "works.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA / "catalogue_report.txt").write_text("\n".join(report) + "\n", encoding="utf-8")
    n_wd = sum(1 for w in works if w["wikidata"])
    print(f"data/works.json: {len(works)} works ({sum(w['type'] == 'solo' for w in works)} solo, "
          f"{sum(w['type'] == 'concerto' for w in works)} with orchestra), {n_wd} matched to Wikidata, "
          f"{len(pop)} in the popular list")
    kinds = {}
    for r in report:
        kinds[r[:4]] = kinds.get(r[:4], 0) + 1
    print("report (data/catalogue_report.txt):", kinds)


if __name__ == "__main__":
    stages = sys.argv[1:] or ["composers", "wikidata", "merge"]
    for st in stages:
        print(f"== {st}")
        globals()[f"stage_{st}"]()
