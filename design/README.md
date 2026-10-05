# Design notes

## "Programme" (October 2026)

The look of a printed concert programme and a record sleeve, chosen to be distinct from the two sister
sites (Anandadhara's ivory/claret shell that Piano started from, and Raagmala's lacquer-and-gold "Chitra").

- **Type**: Fraunces (optical-size serif) for titles, Inter for everything else.
- **Colour**: paper and ink by day, ebony by night, one spot colour (viridian) for actions and counts; red only
  for likes and the YouTube button. Tokens on `:root`, dark via `prefers-color-scheme` plus `data-theme` overrides
  (the toggle in the header, remembered as `piano.theme`).
- **Ornament**: a single keyboard rule (white keys with the black keys of each octave, drawn in CSS) under the
  masthead, in the brand mark and on the sleeves. No other decoration.
- **Sleeves**: every work gets a generated square "record sleeve" (composer in small capitals, the title, the
  catalogue number) coloured by period: Baroque umber, Classical slate blue, Romantic oxblood, Late Romantic plum,
  Impressionist teal, 20th century graphite. Works without recordings are desaturated.
- **Programme of the hour**: the home hero suggests a mood set for the time of day (morning: Calm/Joyful/Playful,
  afternoon: Heroic/Passionate/Virtuosic, evening: Tender/Passionate/Melancholy, night: Dreamy/Calm/Contemplative)
  with one-tap play; the jukebox calls its playlist a "Programme".
- **One player**: the jukebox is the only player; pressing ▶ on any row, card or recording plays it there and
  the player bar at the bottom shows it (thin progress line along the bar's top edge on phones, a seek line and
  times on desktop). Phones get bottom tabs; desktop a masthead with the nav and the search field.

`screens/` holds screenshots from the local test run (desktop light/dark, phone, the filter sheet, search,
the "Welcome back" resume prompt).
