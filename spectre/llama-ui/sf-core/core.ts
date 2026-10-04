import { browser } from '$app/environment';
import * as compaction from './compaction';
import * as session from './session';

export function installSpectreCore(): void {
	if (!browser) return;
	(window as unknown as { SF?: unknown }).SF = { compaction, session };
}

installSpectreCore();
