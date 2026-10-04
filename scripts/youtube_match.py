"""Find the top 3 YouTube performances per work. Resumable and quota-aware.

Per work: search.list (100 units) + videos.list (1 unit); if nothing passes the filters, one
fallback search with a differently worded query (another 101 units).
Every candidate is cached in cache/youtube/<work_id>.json, so the filters can be retuned later
with --refilter (no API calls). Works already cached are skipped.
Quota usage is tracked per Pacific-time day in cache/youtube/_quota.json; the script stops
before exceeding --budget (default 9800) or on a quotaExceeded error.

A video is kept only if (all on the video title, except the composer, which may also be in the
channel name or description):
  - the composer is named;
  - the work is identified: its catalogue number (any spelling: Op. 9 No. 2, op.9/2, Op 9 no 2),
    or a nickname, or a distinctive title ("Ballade No. 1", "Clair de lune"), or form + key when
    that pair is unique among the composer's works;
  - nothing contradicts it: another catalogue number of the same kind, another key, another number;
  - it is not a tutorial, slowed/easy version, synthesia/visualiser, arrangement for other
    instruments (or orchestra, for solo works), compilation, short, or a single movement of a
    multi-movement work;
  - its duration fits the work.

Usage: python3 scripts/youtube_match.py [--limit N] [--budget 9800] [--ids a,b,c] [--refilter]
"""
import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "cache" / "youtube"
QUOTA_FILE = OUT / "_quota.json"
API = "https://www.googleapis.com/youtube/v3"
SEARCH_COST = 101

# ------------------------------------------------------------------ names
SURNAME = {  # name used in queries
    "Clara Schumann": "Clara Schumann", "Manuel de Falla": "de Falla", "Richard Strauss": "Richard Strauss",
    "Carl Maria von Weber": "Weber", "Ludwig van Beethoven": "Beethoven", "Heitor Villa-Lobos": "Villa-Lobos",
    "Charles-Valentin Alkan": "Alkan", "Camille Saint-Saëns": "Saint-Saëns", "Nikolai Rimsky-Korsakov": "Rimsky-Korsakov",
    "Wolfgang Amadeus Mozart": "Mozart", "Johann Sebastian Bach": "Bach",
}
VARIANTS = {  # extra spellings seen in video titles
    "Frédéric Chopin": ["chopin", "szopen", "shopen"],
    "Pyotr Ilyich Tchaikovsky": ["tchaikovsky", "tschaikowsky", "tchaikowsky", "chaikovsky", "tchaïkovski", "tchaikovski", "ciajkovskij"],
    "Sergei Rachmaninoff": ["rachmaninoff", "rachmaninov", "rachmaninow", "rakhmaninov", "rachmaninof"],
    "Alexander Scriabin": ["scriabin", "skryabin", "scriabine", "skrjabin", "skriabin"],
    "Sergei Prokofiev": ["prokofiev", "prokofieff", "prokofjew", "prokofiev's"],
    "Modest Mussorgsky": ["mussorgsky", "moussorgsky", "musorgsky", "mussorgski", "moussorgski"],
    "Dmitri Shostakovich": ["shostakovich", "chostakovitch", "schostakowitsch", "sostakovic"],
    "Antonín Dvořák": ["dvorak"], "Béla Bartók": ["bartok"], "Camille Saint-Saëns": ["saint-saens", "saint saens"],
    "George Frideric Handel": ["handel", "haendel", "hendel"],
    "Felix Mendelssohn": ["mendelssohn", "mendelsohn"], "Edvard Grieg": ["grieg"], "Franz Liszt": ["liszt", "list ferenc"],
    "Mily Balakirev": ["balakirev", "balakireff"], "Nikolai Medtner": ["medtner", "metner"],
    "Aram Khachaturian": ["khachaturian", "khatchaturian", "chatschaturjan"], "Dmitry Kabalevsky": ["kabalevsky"],
    "Domenico Scarlatti": ["scarlatti"], "Joseph Haydn": ["haydn"], "Johann Sebastian Bach": ["bach"],
    "Wolfgang Amadeus Mozart": ["mozart"], "Ludwig van Beethoven": ["beethoven"], "Clara Schumann": ["clara schumann", "clara wieck"],
    "Robert Schumann": ["schumann"], "Leoš Janáček": ["janacek"], "Isaac Albéniz": ["albeniz"], "Federico Mompou": ["mompou"],
    "Manuel de Falla": ["falla"], "Richard Strauss": ["strauss"], "Carl Maria von Weber": ["weber"],
    "Heitor Villa-Lobos": ["villa-lobos", "villa lobos"], "Charles-Valentin Alkan": ["alkan"],
    "Nikolai Rimsky-Korsakov": ["rimsky-korsakov", "rimsky korsakov", "rimsky"],
    "Gabriel Fauré": ["faure"], "Cécile Chaminade": ["chaminade"], "César Franck": ["franck"],
    "Karol Szymanowski": ["szymanowski"], "György Ligeti": ["ligeti"], "Enrique Granados": ["granados"],
}


def fold(s):
    """Lower-case, strip accents, unify dashes/quotes, collapse spaces."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("ł", "l").replace("ø", "o").replace("æ", "ae").replace("ß", "ss")
    s = re.sub(r"[‐‑‒–—―]", "-", s).replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", s).strip()


def words(s):
    return re.sub(r"[^a-z0-9#]+", " ", fold(s)).strip()


def composer_names(c):
    return VARIANTS.get(c) or [fold(c.split()[-1])]


def surname(c):
    return SURNAME.get(c, c.split()[-1])


# ------------------------------------------------------------------ keys
NOTE_DE = {"c": "c", "cis": "c-sharp", "des": "d-flat", "d": "d", "dis": "d-sharp", "es": "e-flat", "e": "e",
           "f": "f", "fis": "f-sharp", "ges": "g-flat", "g": "g", "gis": "g-sharp", "as": "a-flat", "a": "a",
           "ais": "a-sharp", "b": "b-flat", "h": "b"}
KEY_EN = re.compile(r"(?<![a-z])([a-g])\s*(-\s*sharp|-\s*flat|\s+sharp|\s+flat|#|♯|♭|b(?=\s*(?:major|minor|maj|min)\b))?"
                    r"\s*-?\s*(major|minor|maj|min)\b")
KEY_DE = re.compile(r"(?<![a-z])(cis|des|dis|es|fis|ges|gis|as|ais|[a-h])\s*-\s*(dur|moll)\b")


def keys_in(text):
    t = fold(text)
    out = set()
    for m in KEY_EN.finditer(t):
        acc = (m.group(2) or "").replace(" ", "").replace("-", "")
        acc = "-sharp" if acc in ("sharp", "#", "♯") else "-flat" if acc in ("flat", "♭", "b") else ""
        out.add(f"{m.group(1)}{acc} {'major' if m.group(3).startswith('maj') else 'minor'}")
    for m in KEY_DE.finditer(t):
        out.add(f"{NOTE_DE[m.group(1)]} {'major' if m.group(2) == 'dur' else 'minor'}")
    return out


# ------------------------------------------------------------------ catalogue numbers
ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10, "xi": 11,
         "xii": 12, "xiii": 13, "xiv": 14, "xv": 15, "xvi": 16, "xvii": 17, "xviii": 18, "xix": 19, "xx": 20}
ROMAN_OF = {v: k for k, v in ROMAN.items()} | {n: str(n) for n in range(21, 100)}
SEP = r"(?:\s*,\s*(?=\d)|\s*[,.]?\s*(?:no|nr|n°|n\.|#|number)\s*\.?\s*|\s*[/-]\s*)"
PREFIX_RE = {  # catalogue kind -> regex for its prefix as written in video titles
    "op": r"op(?:us)?\.?\s*(?:posth\.?\s*)?", "bwv": r"bwv\.?\s*", "k": r"(?:kv|k)\.?\s*", "d": r"d\.?\s*",
    "s": r"(?:s|searle)\.?\s*", "l": r"l\.?\s*", "hob": r"hob\.?\s*", "m": r"m\.?\s*", "sz": r"sz\.?\s*",
    "b": r"b\.?\s*", "woo": r"woo\.?\s*", "fp": r"fp\.?\s*", "hwv": r"hwv\.?\s*", "trv": r"trv\.?\s*", "bv": r"bv\s*b?\s*",
}


def cat_kind(norm):
    return next((k for k in sorted(PREFIX_RE, key=len, reverse=True) if norm.startswith(k)), "")


def norm_cat(s):
    """Same normalisation as catalogue.py: 'Op. 9 No. 2' -> 'op9-2', 'Hob. XVI:52' -> 'hobxvi:52'."""
    s = fold(s).replace("opus", "op")
    s = re.sub(r"\bkv\b", "k", s)
    s = re.sub(r"[\s.,]+", "", s)
    return re.sub(r"(\d[a-z]?)(?:no|nr|n°|/)(\d)", r"\1-\2", s)


def cats_in(title, kinds):
    """Catalogue numbers of the given kinds found in a video title, normalised like norm_cat."""
    t = fold(title)
    out = set()
    for kind in kinds:
        if kind == "hob":
            for m in re.finditer(r"(?<![a-z])(?:hob|h)\.?\s*([ivx]+|\d+)\s*(?:[:/.]|,?\s*no\.?)\s*(\d+)", t):
                g = m.group(1)
                roman = g if g in ROMAN else next((r for r, v in ROMAN.items() if str(v) == g), g)
                out.add(f"hob{roman}:{int(m.group(2))}")
            continue
        pat = rf"(?<![a-z0-9]){PREFIX_RE[kind]}(\d+)([a-c])?(?![0-9a-z])(?:{SEP}(\d+)(?![0-9]))?"
        for m in re.finditer(pat, t):
            num = m.group(1).lstrip("0") or "0"
            sub = m.group(2) or ""
            tok = f"{kind}{num}{sub}"
            out.add(f"{tok}-{int(m.group(3))}" if m.group(3) else tok)
    return out


# ------------------------------------------------------------------ filters
BAD = re.compile(
    r"tutorial|lesson|how to play|\blearn|\bslow(ed|ly)?\b|\beasy\b|beginner|simplified|synthesia|visuali[sz]|"
    r"piano tiles|\bmidi\b|karaoke|\bcover\b|remix|lo-?fi|\b8d\b|\bloop|\bhours?\b|\bhrs?\b(?!-)|\d+\s*min(utes)? of|compilation|"
    r"best of|collection|playlist|full album|\btop \d+|greatest|relaxing|study music|for sleep|sleep music|"
    r"meditation|#shorts?|\bshorts\b|reaction|analysis|explained|masterclass|master class|\bchallenge|"
    r"speed ?run|\bx2\b|faster|\bedm\b|\btrap\b|\bbeat\b|ringtone|guitar|violin|\bcello\b|flute|\bharp\b|\borgan\b|\borgel\b|\borgue\b|\borgano\b|"
    r"accordion|marimba|ukulele|saxophone|trumpet|clarinet|\bchoir\b|vocal|\bsing(s|ing|er)?\b|\bmetal\b|\brock\b|\bjazz|"
    r"arrangement|\barr\b|\barr\.|arranged|transcri|reharmoni|improvis|\bvs\.?\b|versus|comparison|"
    r"music box|8-bit|8 bit|chiptune|sheet music only|\bai\b|\bsuno\b|\blyrics\b|\bdrum",
    re.I)
NOT_SOLO = re.compile(r"orchestra|orchestral|philharmoni|symphony orchestra|\borch\b|\bsinfonia\b|\bstring quartet",
                      re.I)
DUET = re.compile(r"4 hands|four hands|four-hands|4-hands|piano duet|2 pianos|two pianos|piano duo|à quatre mains|"
                  r"a quatre mains|vierhändig", re.I)
SOLO_VERSION = re.compile(r"piano solo|solo piano|for piano solo|piano version|solo version|piano reduction", re.I)
OTHER_INSTRUMENT = re.compile(r"\b(cello|cellist|violin|violinist|guitar|guitarist|flute|harp|organ|orgel|"
                              r"accordion|saxophone|clarinet|choir|vocal|singer|soprano|tenor)\b")
PART = re.compile(r"\bpart \d|\bpt\.? ?\d|\(\d/\d\)|\b\d/\d\)|\[\d/\d\]", re.I)
MOVEMENT = re.compile(r"\b(1st|2nd|3rd|4th|ist|first|second|third|fourth|last|final)\s*\.?\s*(mov|movement|mvt|mvmt)|"
                      r"\((i|ii|iii|iv)\)|"
                      r"\bmov(ement|t)?\.?\s*(\d|i{1,3}|iv)\b|\bmvt\.?\s*\d|\b(i|ii|iii|iv)\.\s+[a-z]|"
                      r"\b(i|ii|iii|iv)\s*-\s*(allegro|adagio|andante|presto|largo|lento|rondo|scherzo|vivace|moderato)", re.I)
# falling-notes visualiser / arrangement channels (the brief excludes visualisers)
BAD_CHANNEL = re.compile(r"^(rousseau|kassia|hauser|2cellos|the piano guys|patrik pietschmann|pianella piano|sheet music boss|marioverehrer|"
                         r"riyandi kusuma|peter plutax|kyle landry|torby brand|piano tutorial.*|.*synthesia.*|"
                         r".*tutorial.*|.*lessons?)$", re.I)
TEMPO_WORDS = {"allegro", "adagio", "andante", "presto", "largo", "lento", "moderato", "vivace", "allegretto",
               "scherzo", "rondo", "finale", "menuetto", "minuetto", "minuet", "aria", "theme", "variation",
               "introduction", "prelude", "fugue", "sostenuto", "assai", "molto", "non", "troppo", "con",
               "brio", "ma", "poco", "piu", "tempo", "grave", "maestoso", "cantabile", "agitato", "vivo",
               "andantino", "larghetto", "espressivo", "intermezzo", "romanze", "romance", "promenade",
               "untitled", "interlude", "cadenza", "variations", "variazione", "sarabande", "allemande",
               "courante", "gigue", "gavotte", "bourree", "sinfonia", "capriccio", "toccata", "e", "and", "doppio",
               "movimento", "quasi", "un", "il", "la", "le", "di", "del", "alla", "scherzando", "energico"}
FORM_WORDS = {"sonata", "concerto", "nocturne", "etude", "study", "prelude", "fugue", "waltz", "valse", "mazurka",
              "polonaise", "ballade", "scherzo", "impromptu", "rhapsody", "rhapsodie", "fantasy", "fantasia", "fantaisie",
              "fantasie", "suite", "partita", "invention", "toccata", "variations", "rondo", "intermezzo", "barcarolle",
              "berceuse", "bagatelle", "sonatina", "sonatine", "minuet", "menuet", "gavotte", "dance", "danza",
              "piece", "pieces", "song", "romance", "humoresque", "arabesque", "moment", "musical", "prelude", "and",
              "piano", "for", "in", "the", "of", "no", "a", "op", "de", "la", "le", "les", "keyboard", "solo"}
FORM_SYNONYMS = {"étude": ["etude", "study", "etude-tableau", "etudes-tableaux"], "waltz": ["waltz", "valse"],
                 "prelude": ["prelude", "preludio"], "fantasy": ["fantasy", "fantasia", "fantaisie", "fantasie"],
                 "rhapsody": ["rhapsody", "rhapsodie", "rhapsodie"], "concerto": ["concerto", "konzert"],
                 "sonata": ["sonata", "sonate"], "sonatina": ["sonatina", "sonatine"], "dance": ["dance", "danza", "danse"],
                 "variations": ["variations", "variationen", "variazioni"], "prelude and fugue": ["prelude", "fugue"]}

MIN_SEC = {"prelude": 25, "invention": 40, "étude": 45, "mazurka": 45, "waltz": 45, "dance": 45, "piece": 45,
           "character piece": 45, "sonata": 60, "bagatelle": 30}
MULTI_MIN_SEC = {"sonata": 8 * 60, "concerto": 9 * 60, "suite": 6 * 60, "partita": 8 * 60, "sonatina": 4 * 60}
MAX_SEC = 60 * 60
SMALL_MAX = {"prelude": 15 * 60, "étude": 15 * 60, "mazurka": 12 * 60, "waltz": 15 * 60, "nocturne": 15 * 60,
             "invention": 10 * 60, "prelude and fugue": 20 * 60, "song without words": 10 * 60, "intermezzo": 12 * 60,
             "impromptu": 15 * 60, "polonaise": 20 * 60, "ballade": 15 * 60, "scherzo": 16 * 60}
LONG_MAX_SEC = 150 * 60  # whole cycles: Goldberg, Vingt regards, Catalogue d'oiseaux, Mikrokosmos


def load_json(p, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


MOVEMENTS = load_json(ROOT / "data" / "movements.json", {})
PIANISTS = load_json(ROOT / "data" / "pianists.json", {"pianists": {}})["pianists"]


NOT_PERFORMER_CHANNEL = re.compile(r"^arthur rubinstein$|competition|institute|festival", re.I)


def pianists_of(video):
    def look(text):
        hay = " " + words(text) + " "
        return [name for name, keys in PIANISTS.items() if any(f" {words(k)} " in hay for k in keys if words(k))]
    channel = video.get("channel", "")
    # the title wins over the channel name; competition channels named after a pianist are not the performer
    found = look(video["title"]) or ([] if NOT_PERFORMER_CHANNEL.search(channel) else look(channel))
    topic = re.fullmatch(r"(.+?) - Topic", video.get("channel", ""))
    if not found and topic and not re.search(r"various|artists|orchestra|ensemble|quartet|choir", topic.group(1), re.I):
        found = [topic.group(1)]
    return found


class Work:
    """Everything about one work that the filters need, computed once."""

    def __init__(self, w, all_works):
        self.w = w
        self.id = w["id"]
        self.composer = w["composer"]
        self.names = composer_names(w["composer"])
        self.cat = norm_cat(w["cat"]) if w["cat"] else ""
        self.kinds = {"op"} | {cat_kind(norm_cat(x["cat"])) for x in all_works
                               if x["composer"] == w["composer"] and x["cat"]}
        self.kinds = {k for k in self.kinds if k in PREFIX_RE}
        self.key = (w["key"] or "").lower()
        self.concerto = w["type"] == "concerto"
        # multi-movement: known parts, or a form that always has them (Scarlatti's sonatas are single movements)
        self.multi = (len(MOVEMENTS.get(w["id"], {}).get("movements", [])) >= 2
                      or (w["form"] in ("sonata", "partita", "suite", "sonatina", "concerto")
                          and w["composer"] != "Domenico Scarlatti" and "Sonatas" not in w["formal"]))
        movs = MOVEMENTS.get(w["id"], {}).get("movements", [])
        self.n_mov = len(movs)
        self.mov_names = set()
        for m in movs:  # distinctive movement names ('Baba Yaga', 'Träumerei'), not tempo markings
            m = re.sub(r"^\s*(no\.?\s*\d+\.?|[ivxl]+\.|\d+\.)\s*", "", fold(m))
            m = re.sub(r"\(.*?\)", " ", m)
            # the whole name and its first segment ("Arietta" from "Arietta. Adagio molto semplice")
            for name in {words(m), words(re.split(r"[.:;,]", m)[0])}:
                if len(name) >= 6 and not set(name.split()) <= TEMPO_WORDS and not re.match(r"(var|variation|no) ?\d+", name):
                    self.mov_names.add(name)
        text = fold(w["formal"] + " " + " ".join(w["aliases"] + w["search"]))
        self.allow = {"duet": bool(DUET.search(text)), "orch": self.concerto,
                      "bad": w["form"] == "transcription" or "improvis" in text}
        self.numbers = set(re.findall(r"\bno\.?\s*(\d+)", text)) | set(re.findall(r"-(\d+)$", self.cat))
        core = KEY_RE_STRIP.sub(" ", fold(w["formal"]))
        self.core = words(re.sub(r"\(.*?\)", " ", core))
        self.core_distinct = bool(re.search(r"\bno \d+\b", self.core)) or bool(set(self.core.split()) - FORM_WORDS)
        self.aliases = [words(a) for a in w["aliases"] + w["search"] if words(a)]
        self.form_words = FORM_SYNONYMS.get(w["form"], [fold(w["form"]).split()[0]])
        # is (form, key) unique for this composer? then "Chopin Ballade in G minor" identifies the work
        same = [x for x in all_works if x["composer"] == w["composer"] and x["form"] == w["form"]
                and (x["key"] or "").lower() == self.key]
        self.form_key_unique = bool(self.key) and len(same) == 1

    def max_sec(self):
        whole_set = re.search(r"preludes|etudes|waltzes|mazurkas|nocturnes|inventions|intermezzi|impromptus|"
                              r"sinfonias|bagatelles|fugues|melodies|\bbook\b", fold(self.w["formal"]))
        if self.w["form"] in SMALL_MAX and not self.multi and not whole_set:  # one short piece, never a set
            return SMALL_MAX[self.w["form"]]
        whole_cycle = self.w["form"] in ("suite", "variations", "character piece", "étude", "prelude",
                                         "prelude and fugue") and not re.search(r"No\.\s*\d+$", self.w["cat"])
        return LONG_MAX_SEC if whole_cycle and (self.multi or self.w["form"] in ("variations", "suite")) else MAX_SEC

    def min_sec(self):
        if self.concerto:
            if not self.multi:
                return 8 * 60
            return 9 * 60 if self.w["period"] == "Baroque" else 15 * 60
        if self.multi:
            return max(MULTI_MIN_SEC.get(self.w["form"], 5 * 60), 20 * self.n_mov)
        return MIN_SEC.get(self.w["form"], 60)


KEY_RE_STRIP = re.compile(r"\bin [a-g](-flat|-sharp)? (major|minor)\b")


def phrase_in(needle, hay):
    return bool(needle) and f" {needle} " in f" {hay} "


def judge(work, v):
    """(keep?, reason) for one candidate video."""
    title = v["title"]
    t = fold(title)
    tw = words(title)
    if not v.get("embeddable", True):
        return False, "not embeddable"
    if not work.min_sec() <= v["seconds"] <= work.max_sec():
        return False, f"duration {v['seconds']}s"
    bad = BAD.search(title)
    if bad and not (work.allow["bad"] and re.search(r"transcri|arr|improvis", bad.group(0), re.I)):
        return False, f"bad word '{bad.group(0)}'"
    if re.search(r"tutorial|synthesia|lesson|karaoke", v.get("channel", ""), re.I):
        return False, "bad channel"
    if not work.allow["orch"] and NOT_SOLO.search(title):
        return False, "orchestra (solo work)"
    if work.concerto and SOLO_VERSION.search(title):
        return False, "solo version of a concerto"
    if not work.concerto and re.search(r"piano version|version for piano", t) and "version" not in fold(work.w["formal"]):
        return False, "'piano version' of a piano work (an arrangement)"
    if fold(v.get("channel", "")).strip() in {fold(work.composer), *work.names}:
        return False, "channel named after the composer"
    if not work.allow["duet"] and DUET.search(title):
        return False, "four hands / two pianos"
    if re.search(r"(plus|and|with|\+|&)\s+encores?", t):
        return False, "includes encores"
    if PART.search(title):
        return False, "part of a split upload"
    if work.multi and MOVEMENT.search(title):
        return False, "single movement"
    if work.multi and not re.search(r"complete|full|integral|komplett|entire", t):
        hit = next((m for m in work.mov_names if phrase_in(m, tw) and not phrase_in(m, work.core)), None)
        if hit:
            return False, f"excerpt '{hit}'"
    if work.w["form"] == "prelude and fugue" and "prelud" in t and not re.search(r"fug|p&f|p & f", t):
        return False, "prelude without its fugue"
    # composer: title, else channel/description (Topic uploads name it only in the description)
    if BAD_CHANNEL.search(v.get("channel", "").strip()):
        return False, "visualiser/tutorial channel"
    topic = re.fullmatch(r"(.+?) - Topic", v.get("channel", ""))
    if topic and any(re.search(rf"(?<![a-z]){re.escape(n)}(?![a-z])", fold(topic.group(1))) for n in work.names):
        return False, "Topic channel named after the composer"
    hay_all = fold(title + " " + v.get("description", ""))
    if not any(re.search(rf"(?<![a-z]){re.escape(n)}(?![a-z])", hay_all) for n in work.names):
        return False, "composer not named"
    if work.composer == "Robert Schumann" and "clara" in t:
        return False, "Clara Schumann"
    # contradictions
    vkeys = keys_in(title)
    if work.key and vkeys and work.key not in vkeys:
        return False, f"other key {sorted(vkeys)}"
    vcats = cats_in(title, work.kinds)
    same_kind = {c for c in vcats if cat_kind(c) == cat_kind(work.cat)} if work.cat else set()
    cat_ok = False
    if work.cat:
        base = re.sub(r"-\d+$", "", work.cat)
        num = work.cat.rsplit("-", 1)[1] if base != work.cat else None
        if work.cat in vcats:
            cat_ok = True
        elif num and base in vcats and re.search(rf"\b(no|nr|n°|#)\.?\s*{num}\b", t):
            cat_ok = True  # "Nocturne No. 2, Op. 9"
        elif num and base in vcats and (
                re.search(rf"(?<![a-z0-9]){ROMAN_OF[int(num)]}\s*[.:)]\s|[:,]\s*{num}\s*[.:]\s", t)
                or any(phrase_in(a, tw) for a in work.aliases if len(a) >= 6)
                or (work.core_distinct and phrase_in(work.core, tw))):
            cat_ok = True  # "Suite bergamasque, L. 75: III. Clair de lune", "Préludes, L. 117: 10. La cathédrale"
        others = same_kind - {work.cat, base if num else None}
        if not cat_ok and same_kind:
            return False, f"other catalogue number {sorted(same_kind)}"
        if cat_ok and others and not all(o.startswith(base) for o in others if o != work.cat):
            return False, f"several works {sorted(same_kind)}"
        if cat_ok and num is None and any(re.fullmatch(rf"{re.escape(work.cat)}-\d+", o) for o in same_kind):
            return False, "a single piece from the set"
    if cat_ok:
        return True, "catalogue number"
    # identified by name only: an arrangement often hides its instrument in the description
    desc = fold(v.get("description", ""))
    if OTHER_INSTRUMENT.search(desc) and "piano" not in desc and "pianist" not in desc:
        return False, "description names another instrument"
    # no catalogue number in the title: numbers must not contradict ("Liebestraum No. 1")
    vnums = set(re.findall(r"\b(?:no|nr|n°|#)\.?\s*(\d+)", t))
    if vnums - work.numbers:
        return False, f"other number {sorted(vnums - work.numbers)}"
    for a in work.aliases:
        if phrase_in(a, tw) and (len(a.split()) >= 2 or len(a) >= 9 or any(phrase_in(f, tw) for f in work.form_words)):
            return True, f"nickname '{a}'"
    if work.core_distinct and phrase_in(work.core, tw):
        return True, f"title '{work.core}'"
    if work.form_key_unique and work.key in vkeys and any(f in tw.split() for f in work.form_words):
        return True, "form + key (unique)"
    return False, "work not identified"


def keep_videos(work, cands):
    kept, seen = [], set()
    verdicts = {v["id"]: judge(work, v) for v in cands}
    # Durations of the videos identified by catalogue number give the work's typical length; a much
    # shorter video is an excerpt (one movement), a much longer one holds several performances.
    typical = sorted(v["seconds"] for v in cands if verdicts[v["id"]] == (True, "catalogue number"))
    median = typical[len(typical) // 2] if len(typical) >= 3 else None
    for v in sorted(cands, key=lambda x: x["views"], reverse=True):
        ok, why = verdicts[v["id"]]
        if ok and median and not 0.55 * median <= v["seconds"] <= 1.7 * median:
            ok, why = False, f"duration {v['seconds']}s vs typical {median}s"
        v["reason"] = why
        if not ok:
            continue
        sig = (tuple(pianists_of(v)), round(v["seconds"] / 5))
        if sig in seen and sig[0]:
            v["reason"] = "duplicate upload"
            continue
        seen.add(sig)
        kept.append({k: v[k] for k in ("id", "title", "channel", "views", "likes", "seconds")}
                    | {"pianists": pianists_of(v), "why": why})
    return kept[:3]


# ------------------------------------------------------------------ API
def api_key():
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        k, _, v = line.partition("=")
        if k.strip() == "YOUTUBE_API_KEY":
            return v.strip().strip('"').strip("'")
    sys.exit("YOUTUBE_API_KEY not found in .env")


class QuotaExceeded(Exception):
    pass


def call(endpoint, params):
    """GET without ever printing the URL (it contains the key)."""
    try:
        r = requests.get(f"{API}/{endpoint}", params=params, timeout=30)
    except requests.RequestException as e:
        raise RuntimeError(f"{endpoint}: network error {type(e).__name__}") from None
    if r.status_code == 200:
        return r.json()
    try:
        err = r.json()["error"]
        reason = err["errors"][0].get("reason", "")
        msg = err.get("message", "")
    except Exception:
        reason, msg = "", r.text[:200]
    if reason in ("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"):
        raise QuotaExceeded(reason)
    raise RuntimeError(f"{endpoint}: HTTP {r.status_code} {reason} {msg}")


def pt_today():
    return datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d")


def load_quota():
    q = json.loads(QUOTA_FILE.read_text()) if QUOTA_FILE.exists() else {}
    return q if q.get("date") == pt_today() else {"date": pt_today(), "used": 0}


def save_quota(q):
    QUOTA_FILE.write_text(json.dumps(q))


def iso_seconds(d):
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d or "")
    if not m:
        return 0
    dd, h, mi, s = (int(x or 0) for x in m.groups())
    return dd * 86400 + h * 3600 + mi * 60 + s


def search(q, key):
    s = call("search", {"part": "snippet", "q": q, "type": "video", "order": "relevance",
                        "maxResults": 15, "videoEmbeddable": "true", "key": key})
    desc = {it["id"]["videoId"]: it["snippet"].get("description", "") for it in s.get("items", [])}
    if not desc:
        return []
    v = call("videos", {"part": "snippet,contentDetails,statistics,status", "id": ",".join(desc), "key": key})
    out = []
    for it in v.get("items", []):
        sn, st, cd = it["snippet"], it.get("statistics", {}), it["contentDetails"]
        out.append({
            "id": it["id"], "title": sn["title"], "channel": sn["channelTitle"],
            "description": (sn.get("description") or desc.get(it["id"], ""))[:300],
            "views": int(st.get("viewCount", 0)), "likes": int(st.get("likeCount", 0)),
            "seconds": iso_seconds(cd.get("duration")),
            "embeddable": it.get("status", {}).get("embeddable", False),
        })
    return out


def queries(w):
    sur = surname(w["composer"])
    title = w["aliases"][0] if w["aliases"] else (KEY_RE_STRIP.sub("", w["formal"]).strip(" ,") if w["cat"] else w["formal"])
    tail = "" if "piano" in fold(title) or w["type"] == "concerto" else " piano"
    q1 = f"{sur} {title} {w['cat']}".strip() + tail
    q2 = f"{sur} {w['formal']}" + ("" if "piano" in fold(w["formal"]) or w["type"] == "concerto" else " piano")
    return [q1] + ([q2] if fold(q2) != fold(q1) else [])


def match_work(work, key, quota):
    cands, used = [], []
    for q in queries(work.w):
        if used and keep_videos(work, cands):
            break  # fallback only when the first search found nothing usable
        seen = {c["id"] for c in cands}
        cands += [c for c in search(q, key) if c["id"] not in seen]
        quota["used"] += SEARCH_COST
        used.append(q)
    return {"queries": used, "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "candidates": cands, "videos": keep_videos(work, cands)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="max works this run (0 = no limit)")
    ap.add_argument("--budget", type=int, default=9800, help="max units to use per PT day")
    ap.add_argument("--ids", default="", help="comma-separated work ids (or @file with one id per line)")
    ap.add_argument("--refilter", action="store_true", help="re-apply filters to cached candidates; no API calls")
    a = ap.parse_args()

    all_works = json.loads((ROOT / "data" / "works.json").read_text(encoding="utf-8"))
    works = all_works
    if a.ids:
        ids = (Path(a.ids[1:]).read_text(encoding="utf-8").split() if a.ids.startswith("@") else a.ids.split(","))
        order = {i: n for n, i in enumerate(ids)}
        works = sorted([w for w in all_works if w["id"] in order], key=lambda w: order[w["id"]])
        missing = set(ids) - {w["id"] for w in works}
        if missing:
            sys.exit(f"unknown ids: {sorted(missing)}")
    OUT.mkdir(parents=True, exist_ok=True)

    if a.refilter:
        n = 0
        for w in works:
            p = OUT / f'{w["id"]}.json'
            if p.exists():
                r = json.loads(p.read_text(encoding="utf-8"))
                r["videos"] = keep_videos(Work(w, all_works), r["candidates"])
                p.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
                n += 1
        print(f"refiltered {n} cached works")
        return

    todo = [w for w in works if not (OUT / f'{w["id"]}.json').exists()]
    if not a.ids:
        # composers listed in data/priority.txt first (in that order), then the best-known works
        # (data/popular.txt order), then the catalogue order
        pri_file = ROOT / "data" / "priority.txt"
        pri = [ln.strip() for ln in pri_file.read_text(encoding="utf-8").splitlines()
               if ln.strip() and not ln.startswith("#")] if pri_file.exists() else []
        todo.sort(key=lambda w: (pri.index(w["composer"]) if w["composer"] in pri else len(pri),
                                 w["pop"] is None, w["pop"] or 0))
    print(f"{len(works) - len(todo)} cached, {len(todo)} to do", flush=True)
    key, quota, done, fails = api_key(), load_quota(), 0, 0
    for w in todo:
        if a.limit and done >= a.limit:
            break
        if quota["used"] + 2 * SEARCH_COST > a.budget:  # room for a possible fallback search
            print(f"Stopping: daily budget reached ({quota['used']} units used today PT).")
            break
        try:
            res = match_work(Work(w, all_works), key, quota)
        except QuotaExceeded as e:
            print(f"Stopping: YouTube says {e}.")
            quota["used"] = a.budget
            save_quota(quota)
            break
        except RuntimeError as e:
            fails += 1
            print(f"  error on {w['id']}: {e}")
            if fails >= 3:
                print("Stopping after 3 errors.")
                break
            continue
        finally:
            save_quota(quota)
        (OUT / f'{w["id"]}.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
        done += 1
        if done % 10 == 0:
            print(f"  {done} works, {quota['used']} units today", flush=True)
    print(f"Done this run: {done}. Remaining: {len(todo) - done}. Units used today (PT): {quota['used']}.")


if __name__ == "__main__":
    main()
