const REPO_STORE_KEY = 'spectre.chat.repositories.v1';
const REPO_CONTEXT_STORE_KEY = 'spectre.chat.repository-context.v1';
const DRAFT_STORE_KEY = 'spectre.chat.drafts.v1';
const PENDING_REPO_KEY = '__pending__';

function readStore(storage: Storage | undefined, key: string): Record<string, unknown> {
	if (!storage) return {};
	try {
		const value = JSON.parse(storage.getItem(key) || '{}');
		return value && typeof value === 'object' ? value : {};
	} catch {
		return {};
	}
}

function writeStore(storage: Storage | undefined, key: string, value: unknown): void {
	if (!storage) return;
	try {
		storage.setItem(key, JSON.stringify(value));
	} catch {
		/* quota or unavailable */
	}
}

export function currentChatId(): string {
	if (typeof location === 'undefined') return 'home';
	const pathMatch = location.pathname.match(/\/chat\/([^/?#]+)/);
	const hashMatch = location.hash.match(/^#\/chat\/([^/?#]+)/);
	return pathMatch?.[1] ?? hashMatch?.[1] ?? `home:${location.pathname}`;
}

export function getRepoUrl(chatId: string = currentChatId()): string {
	const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
	const store = readStore(storage, REPO_STORE_KEY);
	if (store[chatId] !== undefined) return String(store[chatId] || '');
	if (!chatId.startsWith('home:')) {
		const pendingKey = store[PENDING_REPO_KEY] !== undefined ? PENDING_REPO_KEY : 'home:/';
		if (store[pendingKey] !== undefined) {
			store[chatId] = store[pendingKey];
			delete store[pendingKey];
			delete store['home:/'];
			writeStore(storage, REPO_STORE_KEY, store);
			return String(store[chatId] || '');
		}
	}
	return '';
}

export function setRepoUrl(url: string, chatId: string = currentChatId()): void {
	const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
	const store = readStore(storage, REPO_STORE_KEY);
	store[chatId] = url.replace(/\.git$/i, '');
	if (chatId.startsWith('home:')) store[PENDING_REPO_KEY] = store[chatId];
	else delete store[PENDING_REPO_KEY];
	writeStore(storage, REPO_STORE_KEY, store);
}

export function clearRepoUrl(chatId: string = currentChatId()): void {
	const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
	const store = readStore(storage, REPO_STORE_KEY);
	delete store[chatId];
	delete store[PENDING_REPO_KEY];
	delete store['home:/'];
	writeStore(storage, REPO_STORE_KEY, store);
}

export function getRepoContext(chatId: string = currentChatId()): Record<string, unknown> | null {
	const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
	const store = readStore(storage, REPO_CONTEXT_STORE_KEY);
	let context = store[chatId];
	if (context === undefined && !chatId.startsWith('home:')) {
		const pendingKey = store[PENDING_REPO_KEY] !== undefined ? PENDING_REPO_KEY : 'home:/';
		if (store[pendingKey] !== undefined) {
			context = store[pendingKey];
			store[chatId] = context;
			delete store[pendingKey];
			delete store['home:/'];
			writeStore(storage, REPO_CONTEXT_STORE_KEY, store);
		}
	}
	return context && typeof context === 'object' ? context as Record<string, unknown> : null;
}

export function setRepoContext(context: Record<string, unknown>, chatId: string = currentChatId()): void {
	const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
	const store = readStore(storage, REPO_CONTEXT_STORE_KEY);
	store[chatId] = context;
	if (chatId.startsWith('home:')) store[PENDING_REPO_KEY] = context;
	else delete store[PENDING_REPO_KEY];
	writeStore(storage, REPO_CONTEXT_STORE_KEY, store);
}

export function clearRepoContext(chatId: string = currentChatId()): void {
	const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
	const store = readStore(storage, REPO_CONTEXT_STORE_KEY);
	delete store[chatId];
	delete store[PENDING_REPO_KEY];
	delete store['home:/'];
	writeStore(storage, REPO_CONTEXT_STORE_KEY, store);
}

export function getDraft(chatId: string = currentChatId()): string {
	const store = readStore(typeof localStorage !== 'undefined' ? localStorage : undefined, DRAFT_STORE_KEY);
	return String(store[chatId] || '');
}

export function setDraft(text: string, chatId: string = currentChatId()): void {
	const storage = typeof localStorage !== 'undefined' ? localStorage : undefined;
	const store = readStore(storage, DRAFT_STORE_KEY);
	if (text) store[chatId] = text.slice(0, 12_000);
	else delete store[chatId];
	writeStore(storage, DRAFT_STORE_KEY, store);
}
