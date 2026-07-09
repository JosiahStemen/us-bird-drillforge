#!/usr/bin/env python3
"""
Resolve working image + audio URLs for birds.json.

Images: iNaturalist open data (primary), Wikipedia pageimages (fallback).
Audio: Wikimedia Commons search (primary), xeno-canto API (fallback).

Resumable: skips birds that already have non-Special:FilePath media unless --force.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

UA = "USBirdDrillForge/1.1 (personal study; +https://github.com/JosiahStemen/us-bird-drillforge)"
HEADERS = {"User-Agent": UA, "Accept": "application/json"}

TITLE_OVERRIDES = {
    "northern-cardinal": "Northern_cardinal",
    "american-robin": "American_robin",
    "blue-jay": "Blue_jay",
    "american-crow": "American_crow",
    "black-capped-chickadee": "Black-capped_chickadee",
    "tufted-titmouse": "Tufted_titmouse",
    "white-breasted-nuthatch": "White-breasted_nuthatch",
    "downy-woodpecker": "Downy_woodpecker",
    "red-bellied-woodpecker": "Red-bellied_woodpecker",
    "northern-flicker": "Northern_flicker",
    "mourning-dove": "Mourning_dove",
    "house-finch": "House_finch",
    "american-goldfinch": "American_goldfinch",
    "dark-eyed-junco": "Dark-eyed_junco",
    "song-sparrow": "Song_sparrow",
    "white-throated-sparrow": "White-throated_sparrow",
    "red-winged-blackbird": "Red-winged_blackbird",
    "common-grackle": "Common_grackle",
    "european-starling": "Common_starling",
    "house-sparrow": "House_sparrow",
    "baltimore-oriole": "Baltimore_oriole",
    "eastern-bluebird": "Eastern_bluebird",
    "cedar-waxwing": "Cedar_waxwing",
    "ruby-throated-hummingbird": "Ruby-throated_hummingbird",
    "great-blue-heron": "Great_blue_heron",
    "mallard": "Mallard",
    "canada-goose": "Canada_goose",
    "bald-eagle": "Bald_eagle",
    "red-tailed-hawk": "Red-tailed_hawk",
    "great-horned-owl": "Great_horned_owl",
    "barred-owl": "Barred_owl",
    "northern-mockingbird": "Northern_mockingbird",
    "carolina-wren": "Carolina_wren",
    "pileated-woodpecker": "Pileated_woodpecker",
    "wild-turkey": "Wild_turkey",
    "sandhill-crane": "Sandhill_crane",
    "killdeer": "Killdeer",
    "great-egret": "Great_egret",
    "belted-kingfisher": "Belted_kingfisher",
    "tree-swallow": "Tree_swallow",
    "barn-swallow": "Barn_swallow",
    "yellow-warbler": "Yellow_warbler",
    "american-redstart": "American_redstart",
    "indigo-bunting": "Indigo_bunting",
    "scarlet-tanager": "Scarlet_tanager",
    "western-meadowlark": "Western_meadowlark",
    "eastern-meadowlark": "Eastern_meadowlark",
    "greater-roadrunner": "Greater_roadrunner",
    "gambels-quail": "Gambel's_quail",
    "cactus-wren": "Cactus_wren",
    "anna-hummingbird": "Anna's_hummingbird",
    "steller-jay": "Steller's_jay",
    "california-scrub-jay": "California_scrub_jay",
    "black-billed-magpie": "Black-billed_magpie",
    "mountain-bluebird": "Mountain_bluebird",
    "spotted-towhee": "Spotted_towhee",
    "california-quail": "California_quail",
    "brown-pelican": "Brown_pelican",
    "laughing-gull": "Laughing_gull",
    "painted-bunting": "Painted_bunting",
    "roseate-spoonbill": "Roseate_spoonbill",
    "wood-duck": "Wood_duck",
    "common-loon": "Common_loon",
    "osprey": "Osprey",
    "turkey-vulture": "Turkey_vulture",
    "american-kestrel": "American_kestrel",
    "northern-harrier": "Northern_harrier",
    "snowy-egret": "Snowy_egret",
    "double-crested-cormorant": "Double-crested_cormorant",
    "red-shouldered-hawk": "Red-shouldered_hawk",
    "cooper-hawk": "Cooper's_hawk",
    "ruby-crowned-kinglet": "Ruby-crowned_kinglet",
    "golden-crowned-kinglet": "Golden-crowned_kinglet",
    "eastern-phoebe": "Eastern_phoebe",
    "eastern-kingbird": "Eastern_kingbird",
    "western-kingbird": "Western_kingbird",
    "vermillion-flycatcher": "Vermilion_flycatcher",
    "green-heron": "Green_heron",
    "black-crowned-night-heron": "Black-crowned_night_heron",
    "chimney-swift": "Chimney_swift",
    "common-nighthawk": "Common_nighthawk",
    "purple-martin": "Purple_martin",
}


def http_get_json(url: str, timeout: int = 40, retries: int = 4):
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code in (429, 503):
                wait = 8 * (attempt + 1)
                print(f"    rate limit {e.code}, wait {wait}s")
                time.sleep(wait)
                continue
            raise
        except Exception as e:
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise last_err


def looks_resolved_image(url: str | None) -> bool:
    if not url:
        return False
    u = url.lower()
    if "special:filepath" in u:
        return False
    return any(
        x in u
        for x in (
            "upload.wikimedia.org",
            "inaturalist",
            "staticflickr",
            "inaturalist-open-data",
            "wikipedia.org",
        )
    )


def looks_resolved_audio(url: str | None) -> bool:
    if not url:
        return False
    u = url.lower()
    if "special:filepath" in u:
        return False
    return any(
        x in u
        for x in (
            "upload.wikimedia.org",
            "xeno-canto.org",
            ".ogg",
            ".mp3",
            ".oga",
            ".wav",
            ".opus",
            ".flac",
        )
    )


def fetch_inat_image(bird: dict) -> tuple[str | None, str | None]:
    q = urllib.parse.quote(bird["scientific_name"])
    url = f"https://api.inaturalist.org/v1/taxa?q={q}&rank=species&per_page=5"
    data = http_get_json(url)
    results = data.get("results") or []
    sci = bird["scientific_name"].lower()
    # Prefer exact scientific name match
    ordered = sorted(
        results,
        key=lambda r: (
            0 if (r.get("name") or "").lower() == sci else 1,
            0 if r.get("default_photo") else 1,
        ),
    )
    for r in ordered:
        photo = r.get("default_photo") or {}
        # medium_url / large_url / original_url / url
        for key in ("medium_url", "large_url", "original_url", "url", "square_url"):
            src = photo.get(key)
            if src:
                # Prefer https and larger
                src = src.replace("http://", "https://")
                # bump square to medium-ish if possible
                src = src.replace("/square.", "/medium.")
                credit = photo.get("attribution") or "iNaturalist"
                return src, f"iNaturalist — {credit}"
    return None, None


def fetch_wiki_image(title: str) -> tuple[str | None, str | None]:
    q = urllib.parse.urlencode(
        {
            "action": "query",
            "format": "json",
            "titles": title.replace("_", " "),
            "prop": "pageimages",
            "pithumbsize": 900,
            "piprop": "thumbnail|original|name",
            "redirects": 1,
            "origin": "*",
        }
    )
    data = http_get_json(f"https://en.wikipedia.org/w/api.php?{q}")
    for page in (data.get("query") or {}).get("pages", {}).values():
        if "missing" in page:
            continue
        original = page.get("original") or {}
        thumb = page.get("thumbnail") or {}
        src = original.get("source") or thumb.get("source")
        if src:
            return src, f"Wikipedia ({page.get('pageimage') or title})"
    return None, None


def wiki_title(bird: dict) -> str:
    return TITLE_OVERRIDES.get(bird["id"], bird["common_name"].replace(" ", "_"))


def commons_audio_candidates(bird: dict) -> list[str]:
    sci = bird["scientific_name"]
    common = bird["common_name"]
    return [
        f'intitle:"{sci}" (song OR call OR voice) filetype:audio',
        f'"{sci}" filetype:audio',
        f'intitle:"{common}" (song OR call) filetype:audio',
        f'"{common}" bird (song OR call) filetype:audio',
    ]


def search_commons_audio(bird: dict) -> tuple[str | None, str | None]:
    for query in commons_audio_candidates(bird):
        q = urllib.parse.urlencode(
            {
                "action": "query",
                "format": "json",
                "list": "search",
                "srsearch": query,
                "srnamespace": 6,
                "srlimit": 15,
                "origin": "*",
            }
        )
        try:
            data = http_get_json(f"https://commons.wikimedia.org/w/api.php?{q}")
        except Exception as e:
            print(f"    commons search err: {e}")
            time.sleep(2)
            continue

        titles = []
        for hit in (data.get("query") or {}).get("search", []):
            title = hit.get("title") or ""
            if not title.startswith("File:"):
                continue
            low = title.lower()
            if not any(low.endswith(ext) for ext in (".ogg", ".oga", ".mp3", ".wav", ".flac", ".opus", ".mid")):
                continue
            if any(bad in low for bad in ("spectrogram", ".jpg", ".png", ".svg", "map", "logo")):
                continue
            titles.append(title)

        if not titles:
            time.sleep(0.6)
            continue

        # Batch imageinfo (up to 10)
        for chunk_start in range(0, min(len(titles), 10), 10):
            chunk = titles[chunk_start : chunk_start + 10]
            iq = urllib.parse.urlencode(
                {
                    "action": "query",
                    "format": "json",
                    "titles": "|".join(chunk),
                    "prop": "imageinfo",
                    "iiprop": "url|mime|size",
                    "origin": "*",
                }
            )
            info = http_get_json(f"https://commons.wikimedia.org/w/api.php?{iq}")
            pages = list((info.get("query") or {}).get("pages", {}).values())
            # Prefer shorter/cleaner song files
            scored = []
            for p in pages:
                ii = (p.get("imageinfo") or [None])[0]
                if not ii or not ii.get("url"):
                    continue
                mime = (ii.get("mime") or "").lower()
                if "audio" not in mime and not ii["url"].lower().endswith(
                    (".ogg", ".oga", ".mp3", ".wav", ".opus", ".flac")
                ):
                    continue
                fname = (p.get("title") or "").replace("File:", "")
                score = 0
                fl = fname.lower()
                if "song" in fl:
                    score += 3
                if "call" in fl:
                    score += 1
                if "xc" in fl:
                    score += 1
                scored.append((score, ii["url"], fname))
            scored.sort(reverse=True)
            if scored:
                _, url, fname = scored[0]
                return url, f"Wikimedia Commons ({fname})"
        time.sleep(0.8)
    return None, None


def search_xc_audio(bird: dict) -> tuple[str | None, str | None]:
    sci = urllib.parse.quote(bird["scientific_name"])
    for extra in ("+q:A", "+q:B", ""):
        url = f"https://xeno-canto.org/api/2/recordings?query={sci}{extra}"
        try:
            data = http_get_json(url, timeout=25, retries=2)
        except Exception as e:
            print(f"    xc err: {e}")
            return None, None
        recs = data.get("recordings") or []
        if not recs:
            continue

        def score(r):
            s = 0
            t = (r.get("type") or "").lower()
            if "song" in t:
                s += 4
            elif "call" in t:
                s += 2
            if r.get("cnt") in ("United States", "Canada"):
                s += 3
            if r.get("q") == "A":
                s += 2
            elif r.get("q") == "B":
                s += 1
            return s

        for r in sorted(recs, key=score, reverse=True)[:6]:
            file_url = r.get("file") or ""
            if not file_url:
                # construct from id
                xc_id = r.get("id")
                if xc_id:
                    file_url = f"https://xeno-canto.org/{xc_id}/download"
            if file_url.startswith("//"):
                file_url = "https:" + file_url
            file_url = file_url.replace("http://", "https://")
            if file_url:
                return file_url, f"xeno-canto XC{r.get('id')} ({r.get('rec', '?')})"
    return None, None


def resolve_image(bird: dict) -> tuple[str | None, str | None]:
    try:
        img, credit = fetch_inat_image(bird)
        if img:
            return img, credit
    except Exception as e:
        print(f"    inat err: {e}")
    time.sleep(0.4)
    try:
        return fetch_wiki_image(wiki_title(bird))
    except Exception as e:
        print(f"    wiki img err: {e}")
    return None, None


def resolve_audio(bird: dict) -> tuple[str | None, str | None]:
    try:
        url, credit = search_commons_audio(bird)
        if url:
            return url, credit
    except Exception as e:
        print(f"    commons aud err: {e}")
    time.sleep(0.5)
    try:
        return search_xc_audio(bird)
    except Exception as e:
        print(f"    xc aud err: {e}")
    return None, None


def main():
    force = "--force" in sys.argv
    path = Path(__file__).with_name("birds.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    birds = data["birds"]

    ok_img = ok_aud = 0
    miss_img, miss_aud = [], []

    for i, bird in enumerate(birds):
        print(f"[{i+1}/{len(birds)}] {bird['common_name']}", flush=True)

        need_img = force or not looks_resolved_image(bird.get("image"))
        need_aud = force or not looks_resolved_audio(bird.get("audio"))

        if need_img:
            img, credit = resolve_image(bird)
            if img:
                bird["image"] = img
                bird["image_credit"] = credit or "open photo"
                ok_img += 1
                print(f"  image OK")
            else:
                miss_img.append(bird["id"])
                print(f"  image MISS")
            time.sleep(0.8)
        else:
            ok_img += 1
            print(f"  image keep")

        if need_aud:
            aud, credit = resolve_audio(bird)
            if aud:
                bird["audio"] = aud
                bird["audio_credit"] = credit or "open recording"
                ok_aud += 1
                print(f"  audio OK — {credit}")
            else:
                miss_aud.append(bird["id"])
                print(f"  audio MISS")
            time.sleep(1.0)
        else:
            ok_aud += 1
            print(f"  audio keep")

        # checkpoint every 10 birds
        if (i + 1) % 10 == 0:
            data["_meta"]["count"] = len(birds)
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            print("  …checkpoint saved")

    data["_meta"]["count"] = len(birds)
    data["_meta"]["media_resolved"] = {
        "images_ok": ok_img,
        "audio_ok": ok_aud,
        "images_missing": miss_img,
        "audio_missing": miss_aud,
    }
    data["_meta"]["media_note"] = (
        "Images primarily from iNaturalist (with Wikipedia fallback). "
        "Audio from Wikimedia Commons or xeno-canto. See image_credit / audio_credit."
    )
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nDone.")
    print(f"Images OK-ish: {ok_img}/{len(birds)}  Audio: {ok_aud}/{len(birds)}")
    if miss_img:
        print("Missing images:", ", ".join(miss_img))
    if miss_aud:
        print("Missing audio:", ", ".join(miss_aud))


if __name__ == "__main__":
    main()
