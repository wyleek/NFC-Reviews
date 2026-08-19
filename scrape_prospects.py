#!/usr/bin/env python3
"""
Tap2Review — corridor prospect scraper.

Scrapes a hex grid of Nearby Search calls over a bounding box or a
corridor (a list of points forming a route), dedupes by place_id, and
writes to Supabase in two layers:

    businesses           - durable  (one master record per business;
                            upserted with stage='scraped' on first
                            sight, via the upsert_scraped_businesses
                            RPC — a re-scrape never regresses stage
                            or clobbers a name you've since edited)
    places_lookup_cache  - ephemeral (Google content, 30-day TTL)

Run the SAME corridor again in ~21 days to generate review velocity
(once something downstream reads two places_lookup_cache pulls —
scoring/velocity itself is out of scope for this script).

Usage:
    export GOOGLE_MAPS_API_KEY=...
    export SUPABASE_URL=...
    export SUPABASE_SERVICE_KEY=...

    # bounding box
    python scrape_prospects.py --bbox 38.960,-76.960,39.010,-76.900 \
        --corridor "route1-college-park"

    # corridor: points along a strip, 400m each side
    python scrape_prospects.py --route 38.9807,-76.9369 38.9905,-76.9330 \
        --route-width 400 --corridor "baltimore-ave"

    # dry run, CSV only, no writes
    python scrape_prospects.py --bbox ... --dry-run --csv out.csv
"""

import argparse
import csv
import json
import math
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import requests

# ------------------------------------------------------------------
# Config
# ------------------------------------------------------------------

API_URL = "https://places.googleapis.com/v1/places:searchNearby"

# Enterprise-tier field mask. rating/userRatingCount/phone/hours push
# the call to the Enterprise SKU. Trim this if you don't need a field —
# billing is at the HIGHEST tier present in the mask.
FIELD_MASK = ",".join([
    "places.id",
    "places.displayName",
    "places.shortFormattedAddress",
    "places.location",
    "places.primaryType",
    "places.types",
    "places.businessStatus",
    "places.rating",
    "places.userRatingCount",
    "places.priceLevel",
    "places.nationalPhoneNumber",
    "places.websiteUri",
    "places.regularOpeningHours",
    "places.photos",
])

# Ordered by priority tier. See lead-engine-spec.md §2.
TYPE_GROUPS = {
    "s": [
        "barber_shop", "nail_salon", "hair_salon", "beauty_salon",
        "cafe", "coffee_shop", "restaurant", "car_repair", "spa",
    ],
    "a": [
        "bakery", "bar", "massage", "pet_store",
        "cell_phone_store", "tattoo_parlor",
    ],
    "b": [
        "laundry", "car_wash", "ice_cream_shop", "florist",
        "chiropractor", "dentist", "veterinary_care",
    ],
}

# Never worth a door.
SKIP_TYPES = {
    "fast_food_restaurant", "gas_station", "bank", "atm",
    "convenience_store", "supermarket", "pharmacy",
    "department_store", "shopping_mall", "lodging", "hotel",
}

MAX_PER_CALL = 20          # Nearby Search (New) hard cap, no pagination
DEFAULT_RADIUS = 250       # metres per hex
MIN_RADIUS = 80            # stop subdividing below this
RATE_SLEEP = 0.12          # be polite


# ------------------------------------------------------------------
# Geometry
# ------------------------------------------------------------------

def hex_grid(lat_min, lng_min, lat_max, lng_max, radius_m):
    """Hexagonal packing of circles over a bbox. ~15% fewer calls than
    a square grid at the same coverage."""
    dy = radius_m * 1.5
    dx = radius_m * math.sqrt(3)

    lat_step = dy / 111_320.0
    mid_lat = (lat_min + lat_max) / 2
    lng_step = dx / (111_320.0 * math.cos(math.radians(mid_lat)))

    points, row, lat = [], 0, lat_min
    while lat <= lat_max + lat_step:
        offset = (lng_step / 2) if row % 2 else 0.0
        lng = lng_min + offset
        while lng <= lng_max + lng_step:
            points.append((lat, lng))
            lng += lng_step
        lat += lat_step
        row += 1
    return points


def route_cells(route_pts, width_m, radius_m):
    """Cells along a polyline — far cheaper than a bbox when you're
    working a commercial strip rather than a whole neighbourhood."""
    cells, step = [], radius_m * 1.4
    for (lat1, lng1), (lat2, lng2) in zip(route_pts, route_pts[1:]):
        seg_m = haversine(lat1, lng1, lat2, lng2)
        n = max(1, int(seg_m / step))
        for i in range(n + 1):
            t = i / n
            cells.append((lat1 + (lat2 - lat1) * t,
                          lng1 + (lng2 - lng1) * t))
    # widen perpendicular if the strip is wider than one cell
    if width_m > radius_m * 2:
        extra, off = [], width_m / 2 / 111_320.0
        for lat, lng in cells:
            extra.extend([(lat + off, lng), (lat - off, lng)])
        cells.extend(extra)
    return dedupe_points(cells)


def haversine(lat1, lng1, lat2, lng2):
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = (math.sin(dp / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(a))


def dedupe_points(pts, precision=5):
    seen, out = set(), []
    for p in pts:
        k = (round(p[0], precision), round(p[1], precision))
        if k not in seen:
            seen.add(k)
            out.append(p)
    return out


# ------------------------------------------------------------------
# API
# ------------------------------------------------------------------

@dataclass
class Stats:
    requests: int = 0
    saturated: int = 0
    places: int = 0
    skipped: int = 0
    errors: int = 0

    @property
    def est_cost(self):
        """Enterprise SKU, $35/1k, first 1000/month free."""
        billable = max(0, self.requests - 1000)
        return billable * 0.035


def nearby(api_key, lat, lng, radius, types, stats):
    body = {
        "includedTypes": types,
        "maxResultCount": MAX_PER_CALL,
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(radius),
            }
        },
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": FIELD_MASK,
    }
    for attempt in range(3):
        try:
            r = requests.post(API_URL, headers=headers,
                              json=body, timeout=25)
            stats.requests += 1
            if r.status_code == 200:
                return r.json().get("places", [])
            if r.status_code in (429, 500, 502, 503):
                time.sleep(2 ** attempt)
                continue
            stats.errors += 1
            print(f"  ! {r.status_code}: {r.text[:200]}", file=sys.stderr)
            return []
        except requests.RequestException as e:
            stats.errors += 1
            print(f"  ! {e}", file=sys.stderr)
            time.sleep(2 ** attempt)
    return []


def harvest_cell(api_key, lat, lng, radius, all_types, stats, depth=0):
    """One call with all types. If it saturates at 20, the cell is dense
    and we're losing businesses — so re-run it per type-group, then
    subdivide geographically if still saturated.

    This keeps sparse areas at 1 call/cell and only spends extra
    requests where there's actually something to find.
    """
    results = nearby(api_key, lat, lng, radius, all_types, stats)
    time.sleep(RATE_SLEEP)

    if len(results) < MAX_PER_CALL:
        return results

    stats.saturated += 1
    merged = {p["id"]: p for p in results}

    # pass 2: split by type group
    for group_types in TYPE_GROUPS.values():
        sub = nearby(api_key, lat, lng, radius, group_types, stats)
        time.sleep(RATE_SLEEP)
        for p in sub:
            merged[p["id"]] = p
        # pass 3: still saturated on this group -> geographic subdivide
        if len(sub) >= MAX_PER_CALL and radius / 2 >= MIN_RADIUS and depth < 2:
            half = radius / 2
            off = half / 111_320.0
            for dlat, dlng in ((off, 0), (-off, 0), (0, off), (0, -off)):
                for p in harvest_cell(api_key, lat + dlat, lng + dlng,
                                      half, group_types, stats, depth + 1):
                    merged[p["id"]] = p

    return list(merged.values())


# ------------------------------------------------------------------
# Transform
# ------------------------------------------------------------------

def category_group(primary_type):
    for g, types in TYPE_GROUPS.items():
        if primary_type in types:
            return g
    return "c"


def normalise(p):
    loc = p.get("location", {})
    return {
        "place_id":          p["id"],
        "display_name":      (p.get("displayName") or {}).get("text"),
        "formatted_address": p.get("shortFormattedAddress"),
        "lat":               loc.get("latitude"),
        "lng":               loc.get("longitude"),
        "primary_type":      p.get("primaryType"),
        "types":             p.get("types", []),
        "rating":            p.get("rating"),
        "user_rating_count": p.get("userRatingCount", 0),
        "price_level":       p.get("priceLevel"),
        "business_status":   p.get("businessStatus"),
        "national_phone":    p.get("nationalPhoneNumber"),
        "website_uri":       p.get("websiteUri"),
        "photo_count":       len(p.get("photos", [])),
        "opening_hours":     p.get("regularOpeningHours"),
    }


def worth_keeping(row, stats):
    """Cheap pre-filter. The real scoring happens in SQL — this just
    avoids writing obvious junk."""
    if row["business_status"] != "OPERATIONAL":
        stats.skipped += 1
        return False
    if row["primary_type"] in SKIP_TYPES:
        stats.skipped += 1
        return False
    if row["rating"] is not None and row["rating"] < 3.5:
        stats.skipped += 1
        return False
    return True


# ------------------------------------------------------------------
# Persistence
# ------------------------------------------------------------------

def write_supabase(rows, corridor, url, key):
    from supabase import create_client
    sb = create_client(url, key)

    # Durable layer: one master record per business. This never writes
    # `place_id`/prospects directly — it calls the upsert_scraped_businesses
    # RPC (supabase/migrations/20260817120000_crm_data_model.sql), which
    # inserts new businesses at stage='scraped' and, on a re-scrape, only
    # refreshes bookkeeping columns. It will not regress a business past
    # 'scraped' or overwrite a name you've since edited by hand.
    sb.rpc("upsert_scraped_businesses", {
        "rows": [
            {"google_place_id": r["place_id"],
             "name": r["display_name"],
             "category_group": category_group(r["primary_type"]),
             "corridor": corridor}
            for r in rows
        ]
    }).execute()

    # Ephemeral layer: Google Places content only, 30-day TTL, keyed on
    # google_place_id — never joined into a permanent export past that
    # window. Send plain lat/lng floats; `location` is a generated column
    # derived from them in SQL. opening_hours goes in as jsonb.
    #
    # fetched_at/expires_at are sent explicitly (as real timestamps, not
    # the literal string "now()") rather than left to the column
    # DEFAULTs — on a re-scrape this is an UPDATE via ON CONFLICT, and
    # column defaults only fire on INSERT. Without this the TTL clock
    # would never actually reset on a revisited corridor.
    fetched_at = datetime.now(timezone.utc)
    expires_at = fetched_at + timedelta(days=30)

    sb.table("places_lookup_cache").upsert([
        {"google_place_id":   r["place_id"],
         "fetched_at":        fetched_at.isoformat(),
         "expires_at":        expires_at.isoformat(),
         "display_name":      r["display_name"],
         "formatted_address": r["formatted_address"],
         "lat":               r["lat"],
         "lng":               r["lng"],
         "primary_type":      r["primary_type"],
         "types":             r["types"],
         "rating":            r["rating"],
         "user_rating_count": r["user_rating_count"],
         "price_level":       r["price_level"],
         "business_status":   r["business_status"],
         "national_phone":    r["national_phone"],
         "website_uri":       r["website_uri"],
         "photo_count":       r["photo_count"],
         "opening_hours":     r["opening_hours"]}
        for r in rows
    ], on_conflict="google_place_id").execute()


def write_csv(rows, path):
    if not rows:
        return
    cols = [c for c in rows[0] if c not in ("types", "opening_hours")]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols + ["category_group"])
        w.writeheader()
        for r in rows:
            out = {c: r[c] for c in cols}
            out["category_group"] = category_group(r["primary_type"])
            w.writerow(out)


# ------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", help="lat_min,lng_min,lat_max,lng_max")
    ap.add_argument("--route", nargs="+", metavar="LAT,LNG",
                    help="polyline points along a commercial strip")
    ap.add_argument("--route-width", type=float, default=300)
    ap.add_argument("--radius", type=float, default=DEFAULT_RADIUS)
    ap.add_argument("--corridor", required=True, help="your label for this sweep")
    ap.add_argument("--tiers", default="s,a,b", help="type groups to include")
    ap.add_argument("--max-requests", type=int, default=400,
                    help="hard stop. Protects you from a runaway bill")
    ap.add_argument("--csv")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not api_key:
        sys.exit("GOOGLE_MAPS_API_KEY not set")

    if args.bbox:
        a, b, c, d = map(float, args.bbox.split(","))
        cells = hex_grid(a, b, c, d, args.radius)
    elif args.route:
        pts = [tuple(map(float, p.split(","))) for p in args.route]
        cells = route_cells(pts, args.route_width, args.radius)
    else:
        sys.exit("need --bbox or --route")

    types = []
    for t in args.tiers.split(","):
        types.extend(TYPE_GROUPS.get(t.strip(), []))

    print(f"corridor : {args.corridor}")
    print(f"cells    : {len(cells)} @ {args.radius}m")
    print(f"types    : {len(types)}")
    print(f"est cost : ${max(0, len(cells) - 1000) * 0.035:.2f} "
          f"(before saturation splits)\n")

    stats = Stats()
    found = {}

    for i, (lat, lng) in enumerate(cells, 1):
        if stats.requests >= args.max_requests:
            print(f"\n! hit --max-requests ({args.max_requests}), stopping")
            break
        for p in harvest_cell(api_key, lat, lng, args.radius, types, stats):
            row = normalise(p)
            if worth_keeping(row, stats):
                found[row["place_id"]] = row
        if i % 10 == 0 or i == len(cells):
            print(f"  cell {i}/{len(cells)}  "
                  f"reqs={stats.requests}  kept={len(found)}  "
                  f"skipped={stats.skipped}")

    rows = list(found.values())
    stats.places = len(rows)

    print(f"\n--- {args.corridor} ---")
    print(f"requests   : {stats.requests}  (saturated cells: {stats.saturated})")
    print(f"prospects  : {stats.places}")
    print(f"skipped    : {stats.skipped}")
    print(f"errors     : {stats.errors}")
    print(f"est. cost  : ${stats.est_cost:.2f}")

    by_group = {}
    for r in rows:
        by_group[category_group(r["primary_type"])] = \
            by_group.get(category_group(r["primary_type"]), 0) + 1
    print(f"by group   : {by_group}")

    with_phone = sum(1 for r in rows if r["national_phone"])
    print(f"callable   : {with_phone} have a phone number")

    if args.csv:
        write_csv(rows, args.csv)
        print(f"wrote      : {args.csv}")

    if args.dry_run:
        print("\n(dry run — nothing written to Supabase)")
        return

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    write_supabase(rows, args.corridor, url, key)
    print("wrote      : supabase (businesses stage='scraped', places_lookup_cache)")
    print("\nnext: select b.id, b.name, b.category_group, "
          "c.rating, c.user_rating_count, c.national_phone "
          "from businesses b "
          "join places_lookup_cache c using (google_place_id) "
          f"where b.corridor = '{args.corridor}' "
          "order by c.user_rating_count desc nulls last;")


if __name__ == "__main__":
    main()
