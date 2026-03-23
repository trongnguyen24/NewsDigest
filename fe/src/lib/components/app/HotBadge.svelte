<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import { Flame } from 'lucide-svelte';
  
  let { score }: { score: number | null } = $props();
  
  let variant = $derived(score && score >= 8 ? 'destructive' : score && score >= 5 ? 'default' : 'secondary');
  let label = $derived(score && score >= 8 ? `Hot ${score}` : score ? `${score}/10` : 'N/A');
</script>

{#if score}
  <Badge {variant} class="flex items-center gap-1 font-semibold">
    {#if score >= 8}
      <Flame size={14} />
    {/if}
    {label}
  </Badge>
{/if}
