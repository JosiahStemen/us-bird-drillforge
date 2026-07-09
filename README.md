# US Bird DrillForge

Learn **United States birds** the way DrillForge drills language — by **region**, with quizzes on **how they look** and **what they sound like**.

Static single-page app: no build step, no backend. Progress stays in your browser.

## Live site

After GitHub Pages is enabled:

`https://josiahstemen.github.io/us-bird-drillforge/`

## Quick start (local)

```bash
cd us-bird-drillforge
python -m http.server 8080
```

Open `http://localhost:8080` — do **not** open `index.html` via `file://` (JSON and media will fail).

## Features

| Feature | Description |
|--------|-------------|
| **All Birds** | Full deck (~80 common North American species) |
| **Region tabs** | Northeast · Southeast · Midwest · Southwest · West/Rockies · Pacific Coast |
| **Look drills** | Photo → name (multiple choice or flashcard) |
| **Sound drills** | Call/song → name (auto-play + replay) |
| **Mixed** | Random look vs sound each question |
| **Browse** | Search, tags, Known / Needs Work filters |
| **Detail** | Field marks, habitat, call description, play audio |
| **Progress** | Separate look & sound mastery, export/import JSON |

## Drill tips

1. Pick a **region** (or All Birds).
2. Click **Start Drill** → choose Look / Sound / Mixed.
3. Multiple choice: press **1–4** or click; **Space** continues.
4. Flashcards: flip with click/Space, then Knew it / Missed.
5. Use **headphones** for sound ID.

Many species appear in several regions — that is intentional.

## Media

| Kind | Source |
|------|--------|
| **Photos** | [iNaturalist](https://www.inaturalist.org/) open data (species default photos) |
| **Audio** | [Wikimedia Commons](https://commons.wikimedia.org/) bird recordings, plus [xeno-canto](https://xeno-canto.org/) downloads where Commons has no file |

Each bird stores `image_credit` / `audio_credit`. Re-resolve media with:

```bash
cd data
python fix_media.py          # fill missing / broken Special:FilePath URLs
```

This is a personal study aid, not a field guide. For serious ID, use Merlin, eBird, and local experts.

## Data

Edit `data/birds.json`. Each bird:

```json
{
  "id": "northern-cardinal",
  "common_name": "Northern Cardinal",
  "scientific_name": "Cardinalis cardinalis",
  "regions": ["northeast", "southeast", "midwest", "southwest"],
  "habitat": "…",
  "size": "8–9 in",
  "field_marks": "…",
  "call_description": "…",
  "image": "https://commons.wikimedia.org/wiki/Special:FilePath/…?width=800",
  "audio": "https://commons.wikimedia.org/wiki/Special:FilePath/….ogg",
  "tags": ["songbird", "year-round"]
}
```

Region keys: `northeast`, `southeast`, `midwest`, `southwest`, `west`, `pacific`.

## Deploy (GitHub Pages)

1. Repo is public: `us-bird-drillforge`
2. **Settings → Pages → Source**: GitHub Actions (workflow `.github/workflows/pages.yml`), or branch `main` / root
3. Site: `https://<user>.github.io/us-bird-drillforge/`

## Tech

- HTML + Tailwind CDN + vanilla JS  
- localStorage progress  
- Same interaction patterns as [Arabic DrillForge](https://github.com/JosiahStemen/arabic-drillforge)

## License

Personal study use. Bird media rights belong to their Wikimedia authors (see each Commons file).
