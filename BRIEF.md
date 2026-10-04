# Piano: project brief

A personal static website of **classical piano music**: every well-known solo piano work and piano
concerto, each with its details and the best YouTube performances, plus a jukebox. Sister project of
আনন্দধারা Anandadhara (Rabindrasangeet, https://smaju78.github.io/Anandadhara/), whose working code
is in `reference/` to adapt, not rewrite.

## Scope
- **Solo piano works** from Baroque to 20th century (Bach, Scarlatti, Haydn, Mozart, Beethoven,
  Schubert, Mendelssohn, Chopin, Schumann, Liszt, Brahms, Grieg, Tchaikovsky, Mussorgsky, Albéniz,
  Granados, Fauré, Debussy, Ravel, Satie, Scriabin, Rachmaninoff, Prokofiev, Bartók, Shostakovich,
  Gershwin, Messiaen, etc.).
- **Piano concertos** (and concerto-like works: Rhapsody in Blue, Paganini Rhapsody, Burleske…).
- Later, if wanted: chamber music with piano. Not in the first version.

## Data model (one record per work)
- id, title (as commonly known, e.g. "Moonlight Sonata"), formal title ("Piano Sonata No. 14 in C-sharp minor")
- composer, catalogue number (Op., BWV, K., D., S., L., Hob.), key, year, period
  (Baroque / Classical / Romantic / Late Romantic / Impressionist / 20th century)
- form (sonata, nocturne, étude, prelude, ballade, waltz, mazurka, polonaise, impromptu, variations,
  suite, fugue, rhapsody, concerto, …), set membership (e.g. Chopin Études Op. 10 No. 3)
- movements (name, tempo marking) where relevant
- moods (a fixed list for the user to approve, as in Anandadhara), aliases (nicknames: "Revolutionary", "Für Elise")
- videos: top 3 YouTube performances (id, title, channel, views, likes, duration, pianist)

## Sources (prefer open data; check licences before republishing anything)
- **Wikidata** (CC0): works with "instrumentation: piano", composer, catalogue codes, key, dates.
- **MusicBrainz** (core data CC0): works, aliases, recordings.
- **IMSLP**: lists of works per composer (useful for completeness; check terms before copying text).
- Wikipedia "List of compositions by X" pages for checking the canon.
- Be polite: batch API calls, small delays, cache everything locally (Wikimedia rate-limits single-page
  requests quickly; their batch query API was the fix on Anandadhara).

## YouTube matching (see reference/scripts/youtube_match.py)
- One `search.list` per work, query like `"Chopin Nocturne Op. 9 No. 2 piano"`, order=relevance,
  maxResults 15, then `videos.list` for stats; rank kept videos by views.
- Durations: allow up to ~60 min (sonatas, concertos); keep a per-form minimum (a Chopin prelude can be
  under 1 min).
- Relevance: composer name AND the work's catalogue number or nickname in the title. Catalogue numbers
  have many spellings (Op. 9 No. 2, Op.9/2, op 9 no 2): normalise them.
- Exclude: tutorials, "slow/easy piano", synthesia/visualisers, karaoke, orchestral arrangements of solo
  works, compilations ("best of", "2 hours"), shorts.
- Pianist recognition: a list of well-known pianists (Horowitz, Rubinstein, Argerich, Zimerman, Pollini,
  Richter, Gould, Kissin, Lang Lang, Yuja Wang, Trifonov…) plus YouTube "- Topic" artist channels.
- Order the run: best-known works first (a hand-picked list), as on Anandadhara.

## Site
Same shell as Anandadhara (reference/site): Listen home with mood tiles, browse by composer / period /
form / key / mood / pianist, work pages with movements and recordings, spelling-tolerant search (by
nickname and catalogue number too), jukebox with filters, mini-player, likes and never-play, Privacy
and Terms pages, plain HTML/CSS/JS with no build step, served from `docs/` on GitHub Pages.

## Constraints
- **YouTube API key in `.env` as `YOUTUBE_API_KEY`**. Never print it or commit it. This site gets its
  **own Google Cloud project and key** (one project per site is allowed; using several keys or projects
  to multiply quota for one site is not, and risks suspension of all projects).
- Free quota is 10,000 units/day (search.list = 100). The YouTube script must be resumable: cache per
  work, skip done ones, stop before the quota, continue next run. Daily Windows scheduled task as in
  `reference/scripts/run_youtube_daily.cmd`; **set it to run on battery** (Windows' default silently
  skips runs on battery).
- Keep stored YouTube statistics fresh (refresh at least every 30 days, as in refresh_stats.py).
- Python scripts for data (Python lives in WSL: `wsl -e bash -lc "..."`), one data JSON, static site.
- GitHub: user Smaju78; a new public repo for this site (user creates it), Pages from `/docs`.

## How to work with the user
- Show a 2–3 line plan first and wait for OK.
- Stop at each checkpoint and show results:
  1. Catalogue built (counts by composer / period / form, 10 sample rows).
  2. YouTube matching tested on 50 works (table work → 3 video titles; audit every kept video).
  3. Proposed mood list + 50 works tagged, for review.
  4. Full run plan (days of quota).
  5. Site built and running locally.
- If a step fails twice, stop and ask. If unsure, say so. Be concise.
- The user cares most that **only relevant videos** are kept: prefer no video over a wrong one.

## Lessons from Anandadhara worth keeping
- Verify matches between sources (titles that look alike pair crosswise); audit a sample by hand.
- Separate "searched, nothing found" from "not searched yet" in the data.
- Put the player first in the jukebox; show live counts on filters; a home page that starts listening
  in one tap; a mini-player that keeps playing while browsing.
- Fetch the best-known items first so the site is useful early.
