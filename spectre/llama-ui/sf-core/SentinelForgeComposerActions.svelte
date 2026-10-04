<script lang="ts">
	import { onMount } from 'svelte';

	// Svelte 5 runes
	let showSettings = $state(false);
	let showGithubDialog = $state(false);
	let githubUrl = $state('');
	let attachedRepo = $state('');
	let attachedImages = $state<{ name: string; b64: string; mime: string }[]>([]);
	let fileInputRef = $state<HTMLInputElement | null>(null);

	// Settings state
	let contextSize = $state(32768);
	let reasoningLevel = $state('default');
	let compactionMode = $state('balanced');
	let memoryEnabled = $state(true);
	let memoryStatus = $state('');
  let memoryStatusError = $state(false);

  const STORAGE_KEY = 'spectre.ui.settings.v1';
  const REPO_STORE_KEY = 'spectre.chat.repositories.v1';
	const CONTEXT_OPTIONS = [
		{ value: 32768, label: '32K' },
		{ value: 65536, label: '64K' },
		{ value: 131072, label: '128K' }
	];
	const REASONING_OPTIONS = [
		{ value: 'default', label: 'Default (High)' },
		{ value: 'low', label: 'Low' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'high', label: 'High' },
		{ value: 'xhigh', label: 'XHigh' },
		{ value: 'max', label: 'Max' }
	];

	function getCookie(name: string) {
		const prefix = `${encodeURIComponent(name)}=`;
		const found = document.cookie.split(';').map(p => p.trim()).find(p => p.startsWith(prefix));
		return found ? decodeURIComponent(found.slice(prefix.length)) : '';
	}

	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
			if (CONTEXT_OPTIONS.some(option => option.value === Number(saved.context_size))) {
				contextSize = Number(saved.context_size);
			}
			if (REASONING_OPTIONS.some(option => option.value === saved.reasoning_level)) {
				reasoningLevel = saved.reasoning_level;
			}
			if (saved.compaction_mode) compactionMode = saved.compaction_mode;
		} catch (_) {}

		try {
			const repoStore = JSON.parse(sessionStorage.getItem(REPO_STORE_KEY) || '{}');
			attachedRepo = repoStore['current'] || '';
		} catch (_) {}
		window.addEventListener('sentinelforge-settings-change', syncExternalSettings);

		// Load memory preference from API
		fetch('/api/v1/me/memory/preferences')
			.then(r => r.ok ? r.json() : null)
			.catch(() => null)
			.then(data => {
				if (data && typeof data.enabled === 'boolean') {
					memoryEnabled = data.enabled;
				}
			});

		return () => window.removeEventListener('sentinelforge-settings-change', syncExternalSettings);
	});

	function saveSettings() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({
				context_size: contextSize,
				reasoning_level: reasoningLevel,
				compaction_mode: compactionMode,
				tools: { repo_analysis: true, web_search: true }
			}));
		} catch (_) {}
		window.dispatchEvent(new CustomEvent('sentinelforge-settings-change', {
			detail: {
				context_size: contextSize,
				reasoning_level: reasoningLevel,
				compaction_mode: compactionMode
			}
		}));
	}

	function syncExternalSettings(event: Event) {
		const detail = (event as CustomEvent).detail || {};
		const context = Number(detail.context_size);
		if (CONTEXT_OPTIONS.some(option => option.value === context)) contextSize = context;
		if (REASONING_OPTIONS.some(option => option.value === detail.reasoning_level)) {
			reasoningLevel = detail.reasoning_level;
		}
		if (['off', 'balanced', 'proactive', 'aggressive'].includes(detail.compaction_mode)) {
			compactionMode = detail.compaction_mode;
		}
	}

	function handleImageSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files || []);
		for (const file of files) {
			if (!file.type.startsWith('image/')) continue;
			if (file.size > 12 * 1024 * 1024) {
				alert(`Image "${file.name}" exceeds 12MB limit.`);
				continue;
			}
			const reader = new FileReader();
			reader.onload = () => {
				const res = String(reader.result || '');
				const b64 = res.split(',')[1] || '';
				attachedImages = [...attachedImages, {
					name: file.name,
					b64,
					mime: file.type.replace('image/', '')
				}];
			};
			reader.readAsDataURL(file);
		}
		input.value = '';
	}

	function removeImage(index: number) {
		attachedImages = attachedImages.filter((_, i) => i !== index);
	}

	function attachGithubRepo() {
		const raw = githubUrl.trim();
		if (!raw) return;
		if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/i.test(raw)) {
			alert('Please enter a valid GitHub repository URL (e.g. https://github.com/owner/repo)');
			return;
		}
		attachedRepo = raw.replace(/\.git$/i, '');
		try {
			const store = JSON.parse(sessionStorage.getItem(REPO_STORE_KEY) || '{}');
			store['current'] = attachedRepo;
			sessionStorage.setItem(REPO_STORE_KEY, JSON.stringify(store));
		} catch (_) {}
		githubUrl = '';
		showGithubDialog = false;
	}

	function removeRepo() {
		attachedRepo = '';
		try {
			const store = JSON.parse(sessionStorage.getItem(REPO_STORE_KEY) || '{}');
			delete store['current'];
			sessionStorage.setItem(REPO_STORE_KEY, JSON.stringify(store));
		} catch (_) {}
	}

	async function updateMemoryPref(enabled: boolean) {
		memoryEnabled = enabled;
		try {
			const res = await fetch('/api/v1/me/memory/preferences', {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'X-CSRF-Token': getCookie('sf_csrf')
				},
				body: JSON.stringify({ enabled })
			});
			if (!res.ok) throw new Error();
			memoryStatus = enabled ? 'Personal memory activated.' : 'Personal memory paused.';
			memoryStatusError = false;
		} catch (_) {
			memoryStatus = 'Could not update memory preference (sign in required).';
			memoryStatusError = true;
		}
	}

</script>

<!-- Hidden Image Input -->
<input
	type="file"
	accept="image/*"
	multiple
	style="display:none;"
	bind:this={fileInputRef}
	onchange={handleImageSelect}
/>

<!-- Composer Action Buttons: [+] is followed by [Add Image] -> [GitHub] -> [Chat Settings] -->
<div class="flex items-center gap-1.5 sf-composer-buttons">
	<!-- 1. Add Image Button -->
	<button
		type="button"
		class="sf-composer-btn"
		title="Add image for analysis"
		aria-label="Add image"
		onclick={() => fileInputRef?.click()}
	>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<circle cx="9" cy="9" r="2" />
			<path d="m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 20" />
		</svg>
	</button>

	<!-- 2. GitHub Button -->
	<button
		type="button"
		class="sf-composer-btn {attachedRepo ? 'sf-active-btn' : ''}"
		title={attachedRepo ? `Attached: ${attachedRepo}` : 'Attach GitHub repository'}
		aria-label="Attach GitHub repository"
		onclick={() => (showGithubDialog = !showGithubDialog)}
	>
		<svg viewBox="0 0 24 24" fill="currentColor">
			<path d="M12 .7a11.3 11.3 0 0 0-3.6 22c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.6-1.4-5.6-6.1 0-1.4.5-2.5 1.2-3.4-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.5 1.3a12 12 0 0 1 6.3 0c2.4-1.6 3.5-1.3 3.5-1.3.6 1.7.2 3 .1 3.3.8.9 1.2 2 1.2 3.4 0 4.8-2.9 5.8-5.6 6.1.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.3 11.3 0 0 0 12 .7Z" />
		</svg>
	</button>

	<!-- 3. Chat Settings Button -->
	<button
		type="button"
		class="sf-composer-btn {showSettings ? 'sf-active-btn' : ''}"
		title="Chat settings & Memory"
		aria-label="Chat settings"
		onclick={() => (showSettings = !showSettings)}
	>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
		</svg>
	</button>
</div>

<!-- Attachment / Image Previews (Rendered directly) -->
{#if attachedRepo || attachedImages.length > 0}
	<div class="sf-attachment-bar">
		{#if attachedRepo}
			<div class="sf-chip">
				<svg viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5"><path d="M12 .7a11.3 11.3 0 0 0-3.6 22c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.6-1.4-5.6-6.1 0-1.4.5-2.5 1.2-3.4-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.5 1.3a12 12 0 0 1 6.3 0c2.4-1.6 3.5-1.3 3.5-1.3.6 1.7.2 3 .1 3.3.8.9 1.2 2 1.2 3.4 0 4.8-2.9 5.8-5.6 6.1.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.3 11.3 0 0 0 12 .7Z" /></svg>
				<span class="truncate max-w-[200px]">{attachedRepo.replace('https://github.com/', '')}</span>
				<button type="button" class="sf-remove-btn" onclick={removeRepo}>✕</button>
			</div>
		{/if}

		{#each attachedImages as img, idx}
			<div class="sf-chip">
				<span class="text-xs">🖼️</span>
				<span class="truncate max-w-[150px]">{img.name}</span>
				<button type="button" class="sf-remove-btn" onclick={() => removeImage(idx)}>✕</button>
			</div>
		{/each}
	</div>
{/if}

<!-- GitHub Attachment Modal -->
{#if showGithubDialog}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="sf-modal-backdrop" onclick={() => (showGithubDialog = false)}>
		<div class="sf-dialog-panel" onclick={(e) => e.stopPropagation()}>
			<header class="flex justify-between items-center mb-3">
				<h3 class="font-bold text-sm text-white flex items-center gap-2">
					<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M12 .7a11.3 11.3 0 0 0-3.6 22c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.6-1.4-5.6-6.1 0-1.4.5-2.5 1.2-3.4-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.5 1.3a12 12 0 0 1 6.3 0c2.4-1.6 3.5-1.3 3.5-1.3.6 1.7.2 3 .1 3.3.8.9 1.2 2 1.2 3.4 0 4.8-2.9 5.8-5.6 6.1.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.3 11.3 0 0 0 12 .7Z" /></svg>
					Attach GitHub Repository
				</h3>
				<button type="button" class="text-gray-400 hover:text-white" onclick={() => (showGithubDialog = false)}>✕</button>
			</header>
			<p class="text-xs text-gray-400 mb-3">
				Enter a public or accessible GitHub repository URL to analyze code structures and inject repository findings into chat.
			</p>
			<div class="flex gap-2">
				<input
					type="url"
					placeholder="https://github.com/owner/repo"
					class="sf-input"
					bind:value={githubUrl}
					onkeydown={(e) => e.key === 'Enter' && attachGithubRepo()}
				/>
				<button type="button" class="sf-btn-primary shrink-0" onclick={attachGithubRepo}>
					Attach
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Chat Settings Drawer -->
{#if showSettings}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="sf-modal-backdrop" onclick={() => (showSettings = false)}>
		<div class="sf-settings-panel" onclick={(e) => e.stopPropagation()}>
			<header class="sf-settings-header">
				<h2 class="font-bold text-sm text-white">Chat Settings & Personal Memory</h2>
				<button type="button" class="text-gray-400 hover:text-white" onclick={() => (showSettings = false)}>✕</button>
			</header>

			<div class="sf-settings-body">
				<!-- Context Size -->
				<div class="sf-setting-row">
					<div class="sf-setting-label">
						<span>Context Window</span>
						<small>Compaction budget ceiling</small>
					</div>
					<select
						class="sf-select"
						bind:value={contextSize}
						onchange={() => saveSettings()}
					>
						{#each CONTEXT_OPTIONS as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</div>

				<!-- Reasoning Effort -->
				<div class="sf-setting-row">
					<div class="sf-setting-label">
						<span>Reasoning</span>
						<small>Thinking effort</small>
					</div>
					<select class="sf-select" bind:value={reasoningLevel} onchange={() => saveSettings()}>
						{#each REASONING_OPTIONS as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</div>

				<!-- Compaction Mode -->
				<div class="sf-setting-row">
					<div class="sf-setting-label">
						<span>Compaction Mode</span>
						<small>Auto-fold older turns</small>
					</div>
					<select
						class="sf-select"
						bind:value={compactionMode}
						onchange={() => saveSettings()}
					>
						<option value="off">Off (Keep full history)</option>
						<option value="balanced">Balanced (80% context)</option>
						<option value="proactive">Proactive (65% context)</option>
						<option value="aggressive">Aggressive (50% context)</option>
					</select>
				</div>

				<!-- Personal Memory Evolution -->
				<div class="sf-memory-box">
					<div class="flex items-center justify-between mb-2">
						<span class="font-bold text-xs text-white flex items-center gap-1.5">
							🧠 Continuous Personal Memory
						</span>
						<label class="sf-switch">
							<input
								type="checkbox"
								aria-label="Enable personal memory"
								checked={memoryEnabled}
								onchange={(e) => updateMemoryPref((e.target as HTMLInputElement).checked)}
							/>
							<span class="sf-slider"></span>
						</label>
					</div>
					<p class="text-[11px] text-gray-400 mb-3 leading-relaxed">
						Stores useful conversation knowledge privately in this workspace.
					</p>
					{#if memoryStatus}
						<div class="sf-status-text {memoryStatusError ? 'text-red-400' : 'text-green-400'}">
							{memoryStatus}
						</div>
					{/if}
				</div>
			</div>

			<footer class="sf-settings-footer">
				<button
					type="button"
					class="sf-btn-danger-outline"
					onclick={() => {
						localStorage.removeItem(STORAGE_KEY);
						window.location.reload();
					}}
				>
					Reset Settings
				</button>
			</footer>
		</div>
	</div>
{/if}

<style>
	.sf-composer-buttons {
		display: flex;
		align-items: center;
	}
	.sf-composer-btn {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: rgba(18, 22, 32, 0.7);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: #e5e7eb;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.sf-composer-btn:hover {
		background: rgba(255, 255, 255, 0.12);
		color: #ffffff;
		border-color: rgba(255, 255, 255, 0.25);
		transform: scale(1.05);
	}
	.sf-active-btn {
		background: rgba(99, 102, 241, 0.25);
		border-color: #6366f1;
		color: #a5b4fc;
	}
	.sf-composer-btn svg {
		width: 1.1rem;
		height: 1.1rem;
	}

	.sf-attachment-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.4rem;
		margin-bottom: 0.4rem;
	}
	.sf-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.25rem 0.6rem;
		background: rgba(18, 22, 32, 0.85);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 999px;
		font-size: 0.75rem;
		color: #f3f4f6;
	}
	.sf-remove-btn {
		background: none;
		border: none;
		color: #9ca3af;
		cursor: pointer;
		font-size: 0.7rem;
		padding: 0 0.2rem;
	}
	.sf-remove-btn:hover {
		color: #f87171;
	}

	.sf-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: grid;
		place-items: center;
		background: rgba(0, 0, 0, 0.65);
		backdrop-filter: blur(8px);
		padding: 1rem;
	}
	.sf-dialog-panel {
		width: min(100%, 26rem);
		background: rgba(18, 22, 32, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 1.15rem;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
		padding: 1.5rem;
		color: #fff;
	}

	.sf-settings-panel {
		width: min(100%, 25rem);
		max-height: min(44rem, calc(100vh - 2rem));
		background: rgba(18, 22, 32, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 1.15rem;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		color: #fff;
	}
	.sf-settings-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		background: var(--muted, transparent);
	}
	.sf-settings-body {
		padding: 1.25rem;
		display: grid;
		gap: 1rem;
	}
	.sf-setting-row {
		display: grid;
		gap: 0.35rem;
	}
	.sf-setting-label {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		font-size: 0.78125rem;
		font-weight: 600;
		color: #e5e7eb;
	}
	.sf-setting-label small {
		font-size: 0.6875rem;
		color: #9ca3af;
		font-weight: 400;
	}

	.sf-input, .sf-select {
		box-sizing: border-box;
		width: 100% !important;
		min-width: 0 !important;
		padding: 0.55rem 0.75rem !important;
		color: var(--foreground, #f5f5f5) !important;
		background-color: var(--background, #111) !important;
		border: 1px solid var(--border, rgba(255, 255, 255, 0.18)) !important;
		border-radius: 0.75rem !important;
		font-size: 0.78125rem !important;
		font-family: inherit;
		outline: none;
	}
	.sf-input:focus, .sf-select:focus {
		border-color: var(--foreground, #fff) !important;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--foreground, #fff) 18%, transparent);
	}
	.sf-select {
		appearance: none !important;
		-webkit-appearance: none !important;
		padding-right: 2.25rem !important;
		color-scheme: inherit;
		cursor: pointer;
		transition: border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease;
		background-image:
			linear-gradient(45deg, transparent 50%, var(--muted-foreground, #737373) 50%),
			linear-gradient(135deg, var(--muted-foreground, #737373) 50%, transparent 50%);
		background-position: calc(100% - 0.95rem) 50%, calc(100% - 0.7rem) 50%;
		background-repeat: no-repeat;
		background-size: 0.3rem 0.3rem, 0.3rem 0.3rem;
	}
	.sf-select:hover {
		background-color: var(--muted, var(--background, #1f1f1f)) !important;
		border-color: var(--foreground, #fff) !important;
	}
	.sf-select option {
		color: var(--foreground, #f5f5f5);
		background: var(--background, #111);
	}

	.sf-memory-box {
		padding: 0.85rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 0.75rem;
	}
	.sf-status-text {
		font-size: 0.71875rem;
		margin-top: 0.4rem;
	}

	.sf-btn-primary {
		padding: 0.55rem 1rem;
		background: #6366f1;
		color: #fff;
		border: 1px solid #818cf8;
		border-radius: 0.55rem;
		font-size: 0.78125rem;
		font-weight: 600;
		cursor: pointer;
	}
	.sf-btn-primary:hover {
		background: #4f46e5;
	}

	.sf-settings-footer {
		padding: 0.75rem 1.25rem;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		display: flex;
		justify-content: flex-end;
	}
	.sf-btn-danger-outline {
		padding: 0.35rem 0.65rem;
		background: transparent;
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: #f87171;
		border-radius: 0.45rem;
		font-size: 0.71875rem;
		cursor: pointer;
	}
	.sf-btn-danger-outline:hover {
		background: rgba(239, 68, 68, 0.12);
	}

	/* Switch */
	.sf-switch {
		position: relative;
		display: inline-block;
		width: 32px;
		height: 18px;
	}
	.sf-switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}
	.sf-slider {
		position: absolute;
		cursor: pointer;
		inset: 0;
		background-color: rgba(255, 255, 255, 0.2);
		border-radius: 18px;
		transition: 0.2s;
	}
	.sf-slider:before {
		position: absolute;
		content: "";
		height: 14px;
		width: 14px;
		left: 2px;
		bottom: 2px;
		background-color: white;
		border-radius: 50%;
		transition: 0.2s;
	}
	input:checked + .sf-slider {
		background-color: #22c55e;
	}
	input:checked + .sf-slider:before {
		transform: translateX(14px);
	}
</style>
