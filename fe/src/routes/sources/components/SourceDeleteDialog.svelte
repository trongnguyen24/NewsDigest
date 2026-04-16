<script lang="ts">
  import { Dialog } from 'bits-ui'
  import CusButton from '$lib/components/ui/CusButton.svelte'
  import { Loader2, Trash2 } from 'lucide-svelte'
  import type { Source } from '$lib/types'

  let {
    open = $bindable(false),
    deletingSource,
    isDeleting,
    onDelete,
    onCancel
  }: {
    open: boolean
    deletingSource: Source | null
    isDeleting: boolean
    onDelete: () => void
    onCancel: () => void
  } = $props()
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    <Dialog.Content class="fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-border/60 bg-bg-btn p-6 shadow-lg sm:rounded-3xl sm:max-w-[420px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] outline-none">
      <div class="flex flex-col space-y-1.5 text-center sm:text-left">
        <Dialog.Title class="text-lg font-semibold tracking-tight">Xóa nguồn tin?</Dialog.Title>
        <Dialog.Description class="text-sm leading-6 text-text-secondary">
          {#if deletingSource}
            Xóa <strong class="text-text-main">{deletingSource.name}</strong> và toàn
            bộ bài viết liên quan. Không thể hoàn tác.
          {/if}
        </Dialog.Description>
      </div>

    <div class="mt-5 flex justify-end gap-2">
      <CusButton
        class="h-9 px-4 text-sm"
        onclick={onCancel}
      >
        Hủy
      </CusButton>
      <CusButton
        class="h-9 px-4 text-sm"
        disabled={isDeleting}
        onclick={onDelete}
      >
        {#if isDeleting}
          <Loader2 size={14} class="animate-spin mr-1.5" />
        {:else}
          <Trash2 size={14} class="mr-1.5" />
        {/if}
        {isDeleting ? 'Đang xóa...' : 'Xác nhận xóa'}
      </CusButton>
    </div>
  </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
