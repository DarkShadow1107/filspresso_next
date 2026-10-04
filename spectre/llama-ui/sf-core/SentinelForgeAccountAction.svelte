<script lang="ts">
	interface Props {
		isExpandedMode?: boolean;
		isOnMobile?: boolean;
	}

	let { isExpandedMode = false, isOnMobile = false }: Props = $props();
</script>

{#if isExpandedMode || isOnMobile}
	<div class="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
		<span class="text-xs">Local Mode</span>
	</div>
{/if}
