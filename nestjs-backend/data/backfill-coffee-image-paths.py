"""Backfill coffee_products.image_path from src/data/coffee.generated.json.

The generated JSON is the only complete source of public image paths: coffee_products
stores a filename and an extension but not the collection segment the public path needs.

Two id shapes exist in the database. Most rows use the base capsule id, and a handful use
`<base>-vertuo` for the Vertuo variant. The JSON is organised by collection, and both
collections use the *base* id, so a `-vertuo` row is resolved by stripping the suffix and
taking the entry from the `vertuo` collection.

Idempotent: rewrites the same values, and reports anything it could not resolve rather
than leaving it silently NULL.

    python data/backfill-coffee-image-paths.py
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
SOURCE = REPO / "src" / "data" / "coffee.generated.json"
CONTAINER = "filspresso_postgres"
DB_USER = "filspresso_user"
DB_NAME = "filspresso"


def load_collections() -> dict[str, dict[str, str]]:
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    return {
        collection["id"]: {
            product["id"]: (product.get("image") or "").strip()
            for group in collection.get("groups", [])
            for product in group.get("products", [])
            if product.get("id")
        }
        for collection in data
    }


def db_products() -> list[str]:
    result = subprocess.run(
        ["docker", "exec", CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME, "-tAc",
         "SELECT product_id FROM coffee_products ORDER BY product_id;"],
        capture_output=True, text=True, check=True,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def resolve(product_id: str, collections: dict[str, dict[str, str]]) -> str | None:
    """Image path for one catalogue id, or None when it cannot be resolved."""
    original = collections.get("original", {})
    vertuo = collections.get("vertuo", {})
    if product_id in original and original[product_id]:
        return original[product_id]
    if product_id.endswith("-vertuo"):
        base = product_id[: -len("-vertuo")]
        path = vertuo.get(base)
        if path:
            return path
    return None


def normalise(path: str) -> str:
    """Store a same-origin, site-rooted path.

    The JSON has no leading slash while popular_products_cache has one; everything that
    renders these normalises, and a single convention keeps the CHECK constraint simple.
    """
    cleaned = path.replace("\\", "/").strip()
    while cleaned.startswith("/"):
        cleaned = cleaned[1:]
    return f"/{cleaned}"


def main() -> int:
    if not SOURCE.exists():
        print(f"missing {SOURCE}", file=sys.stderr)
        return 1
    collections = load_collections()
    products = db_products()

    updates: list[tuple[str, str]] = []
    unresolved: list[str] = []
    for product_id in products:
        path = resolve(product_id, collections)
        if path:
            updates.append((normalise(path), product_id))
        else:
            unresolved.append(product_id)

    if not updates:
        print("nothing to write")
        return 1 if unresolved else 0

    # One statement rather than 100 round-trips.
    #
    # psql has no bind parameters, so the pairs go in as a VALUES list. Values are
    # escaped by doubling single quotes; the CHECK constraint on image_path is the real
    # guard, and it rejects anything that is not a same-origin relative path.
    def lit(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    values = ", ".join(f"({lit(pid)}, {lit(path)})" for path, pid in updates)
    sql = (
        "UPDATE coffee_products c SET image_path = v.image_path "
        "FROM (VALUES " + values + ") AS v(product_id, image_path) "
        "WHERE c.product_id = v.product_id"
    )
    payload = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME,
         "-v", "ON_ERROR_STOP=1", "-tAc", sql],
        capture_output=True, text=True,
    )
    if payload.returncode != 0:
        print(payload.stderr.strip(), file=sys.stderr)
        return 1

    print(f"resolved {len(updates)}/{len(products)}")
    if unresolved:
        print(f"UNRESOLVED ({len(unresolved)}): {unresolved}")
        return 1
    print("sample:")
    for path, product_id in updates[:3]:
        print(f"  {product_id} -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())