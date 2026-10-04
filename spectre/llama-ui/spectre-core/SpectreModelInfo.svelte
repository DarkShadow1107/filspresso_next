<script lang="ts">
	import { onMount } from 'svelte';

	let showModal = $state(false);
  let activeModel = $state('Granite-4.2-3B-Q4_0');
	let modelProps = $state<any>(null);

  let isQ4KM = $derived(activeModel.toLowerCase().includes('q4_k_m'));

	onMount(() => {
		fetch('/props')
			.then(r => r.ok ? r.json() : null)
			.catch(() => null)
			.then(data => {
				if (data) {
					modelProps = data;
					if (data.default_generation_settings?.model) {
						activeModel = data.default_generation_settings.model;
					}
				}
			});
	});
</script>

<!-- Model Info Trigger Button -->
<button
	type="button"
	class="sf-info-btn"
	title="View Model Build Information & Capabilities"
	aria-label="Model Information"
	onclick={() => (showModal = !showModal)}
>
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5">
		<circle cx="12" cy="12" r="10"/>
		<path d="M12 16v-4"/>
		<path d="M12 8h.01"/>
	</svg>
</button>

<!-- Model Info Modal -->
{#if showModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="sf-modal-backdrop" onclick={() => (showModal = false)}>
		<div class="sf-info-panel" onclick={(e) => e.stopPropagation()}>
			<header class="flex justify-between items-center mb-4">
				<h3 class="font-bold text-base text-white flex items-center gap-2">
					<svg viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" class="w-5 h-5">
						<circle cx="12" cy="12" r="10"/>
						<path d="M12 16v-4"/><path d="M12 8h.01"/>
					</svg>
					Model Information & Build
				</h3>
				<button type="button" class="text-gray-400 hover:text-white" onclick={() => (showModal = false)}>✕</button>
			</header>

			<div class="grid gap-2 text-xs">
				<div class="sf-info-row">
					<span class="text-gray-400 font-medium">Model ID</span>
					<span class="text-white font-mono font-semibold">{activeModel}</span>
				</div>

				<div class="sf-info-row">
					<span class="text-gray-400 font-medium">Context Window</span>
					<span class="text-white font-semibold">131,072 tokens (128K)</span>
				</div>

				<div class="sf-info-row">
					<span class="text-gray-400 font-medium">Quantization</span>
					<span class="text-white font-semibold">{isQ4KM ? 'Q4_K_M (Medium)' : 'Q4_0 (Standard)'}</span>
				</div>

				<div class="sf-info-row">
					<span class="text-gray-400 font-medium">Architecture</span>
					<span class="text-white font-semibold">Llama / Transformer MoE</span>
				</div>

				<div class="sf-info-row">
					<span class="text-gray-400 font-medium">MCP Tools</span>
          <span class="text-green-400 font-semibold">Spectre tools active</span>
				</div>

				<div class="sf-info-row">
					<span class="text-gray-400 font-medium">Scrapling Stealth RAG</span>
					<span class="text-indigo-400 font-semibold">Enabled (Port :8091)</span>
				</div>
			</div>

			<div class="mt-4 flex justify-end">
				<button
					type="button"
					class="sf-btn-close"
					onclick={() => (showModal = false)}
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.sf-info-btn {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		background: transparent;
		border: 1px solid transparent;
		color: #9ca3af;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.sf-info-btn:hover {
		color: #ffffff;
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.15);
	}

	.sf-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 10000;
		display: grid;
		place-items: center;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(8px);
		padding: 1rem;
	}
	.sf-info-panel {
		width: min(100%, 26rem);
		background: rgba(18, 22, 32, 0.96);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 1.15rem;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.85);
		padding: 1.5rem;
		color: #fff;
	}
	.sf-info-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.45rem 0.65rem;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 0.5rem;
	}
	.sf-btn-close {
		padding: 0.45rem 1rem;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: #fff;
		border-radius: 0.5rem;
		font-size: 0.78125rem;
		font-weight: 600;
		cursor: pointer;
	}
	.sf-btn-close:hover {
		background: rgba(255, 255, 255, 0.15);
	}
</style>
