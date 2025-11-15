"""Simple integration test for iot_db_sqlalchemy.py using SQLite fallback.

This script initializes the DB, inserts a command, fetches it, updates status,
and prints results. It's intended to be runnable locally without MariaDB.
"""
import os
import json
from python_ai import iot_db_sqlalchemy as iot


def run_test():
    # Ensure we use the sqlite fallback for a clean run
    os.environ.pop("IOT_DATABASE_URL", None)
    os.environ.pop("IOT_DB_HOST", None)
    # initialize sqlite DB file in python_ai directory
    iot.init_db()

    recipe = {
        "volume_ml": 40,
        "temperature_c": 92,
        "pre_infusion_ms": 300,
        "capsule_type": "original",
        "capsule_variant": "espresso",
    }

    print("Creating command...")
    cmd_id = iot.create_command("TEST_MACHINE_1", recipe, execute_allowed=True, meta={"note": "test"})
    print(f"Created command id: {cmd_id}")

    print("Fetching pending command...")
    cmd = iot.get_pending_command("TEST_MACHINE_1")
    print("Fetched:", json.dumps(cmd, default=str, indent=2))

    print("Updating status to 'brewing'...")
    ok = iot.update_command_status(cmd_id, "brewing", meta={"started_at": "now"})
    print("Update OK:", ok)

    print("Fetching again (should be none pending if status != 'pending'):")
    cmd2 = iot.get_pending_command("TEST_MACHINE_1")
    print("Pending after update:", cmd2)


if __name__ == "__main__":
    run_test()
