"""
Lightweight IoT DB Helper - Stub for coffee machine commands
This is a minimal stub that satisfies the API but doesn't persist data
"""

import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# In-memory storage
commands_db = {}
command_id_counter = 0

def init_db():
    """Initialize the database (no-op for stub)"""
    logger.info("IoT DB initialized (in-memory stub)")

def create_command(machine_id: str, recipe: Dict, execute_allowed: bool = True, meta: Optional[Dict] = None) -> int:
    """Create a new command for a machine"""
    global command_id_counter
    command_id_counter += 1
    
    commands_db[command_id_counter] = {
        'command_id': command_id_counter,
        'machine_id': machine_id,
        'recipe': recipe,
        'execute_allowed': execute_allowed,
        'meta': meta or {},
        'status': 'pending',
        'created_at': 'now'
    }
    
    return command_id_counter

def get_pending_command(machine_id: str) -> Optional[Dict]:
    """Get the first pending command for a machine"""
    for cmd in commands_db.values():
        if cmd['machine_id'] == machine_id and cmd['status'] == 'pending':
            return cmd
    return None

def update_command_status(command_id: int, status: str, meta: Optional[Dict] = None) -> bool:
    """Update the status of a command"""
    if command_id in commands_db:
        commands_db[command_id]['status'] = status
        if meta:
            commands_db[command_id]['meta'].update(meta)
        return True
    return False
