# Canon files

Hand-curated list of well-known works, one file per group of composers. `scripts/catalogue.py`
checks each line against Wikidata (catalogue code, key, year) and reports mismatches and
well-known Wikidata piano works that are missing here.

Format (UTF-8, `#` starts a comment):

    @ Composer Name                       composer block (name as in catalogue.py COMPOSERS)
    ## Set name | year | form             block defaults; set name "-" = not a set; fields may be empty
    cat | formal title | year | form | alias; alias

- `cat`: catalogue number as usually printed (Op. 10 No. 3, BWV 846, K. 331, D. 899 No. 3, S. 244 No. 2,
  L. 75, Hob. XVI:52, M. 55, Sz. 56, FP 61); `-` when there is none.
- `formal title`: the title as commonly printed, with key ("Étude in E major"); the key is read from it.
- `year`, `form`: may be left empty to inherit the block defaults.
- aliases: nicknames and common titles; the first alias becomes the display title.
- Records in a set are separate works (performed separately); a cycle usually played whole
  (Kinderszenen, Carnaval) is one work.
