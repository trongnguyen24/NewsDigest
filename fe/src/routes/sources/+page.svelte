<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '$lib/api'
  import {
    clearAdminKeyStorage,
    adminHeaders,
    getStoredAdminKey,
    saveAdminKey,
  } from '$lib/admin'
  import CusButton from '$lib/components/ui/CusButton.svelte'
  import { sources } from '$lib/stores/sources'
  import type { Source } from '$lib/types'
  import { toast } from 'svelte-sonner'
  import {
    ArrowLeft,
    Loader2,
    Lock,
    LockOpen,
    RefreshCw,
  } from 'lucide-svelte'

  import SourceItem from './components/SourceItem.svelte'
  import SourceDeleteDialog from './components/SourceDeleteDialog.svelte'
  import SourceEditDialog from './components/SourceEditDialog.svelte'
  import AddSourceForm from './components/AddSourceForm.svelte'
  import { formatRelativeTime, getTypeIcon } from './components/utils'

  let loading = $state(true)
  let pageError = $state('')
  let authError = $state('')
  let showKeyInput = $state(false)
  let adminKey = $state('')

  let newUrl = $state('')
  let newName = $state('')

  let isAdding = $state(false)
  let isFetchingAll = $state(false)
  let fetchingSourceId = $state<string | null>(null)
  let togglingIds = $state<string[]>([])

  let deleteDialogOpen = $state(false)
  let deletingSource = $state<Source | null>(null)
  let isDeleting = $state(false)

  let editDialogOpen = $state(false)
  let editingSource = $state<Source | null>(null)
  let editName = $state('')
  let editUrl = $state('')
  let isEditing = $state(false)

  let isAuthed = $derived(adminKey.trim().length > 0)

  // Sort sources A-Z by name
  let sortedSources = $derived(
    [...$sources].sort((a, b) => a.name.localeCompare(b.name)),
  )

  let enabledCount = $derived($sources.filter((s) => s.enabled).length)

  onMount(() => {
    adminKey = getStoredAdminKey()
    fetchSources()
  })



  function normalizeSource(source: Record<string, unknown>): Source {
    return source as unknown as Source
  }

  async function fetchSources() {
    loading = true
    pageError = ''
    try {
      const res = await fetch(api('/api/sources'))
      if (!res.ok) throw new Error('Không thể tải danh sách nguồn tin.')
      const data = await res.json()
      $sources = (data.sources ?? []).map(normalizeSource)
    } catch (error) {
      pageError =
        error instanceof Error
          ? error.message
          : 'Không thể tải danh sách nguồn tin.'
      toast.error(pageError)
    } finally {
      loading = false
    }
  }

  function openDeleteDialog(source: Source) {
    deletingSource = source
    deleteDialogOpen = true
  }

  function openEditDialog(source: Source) {
    editingSource = source
    editName = source.name
    editUrl = source.url
    editDialogOpen = true
  }

  async function editSource() {
    if (!editingSource) return

    isEditing = true
    authError = ''

    try {
      const body: Record<string, unknown> = {}
      if (editName.trim() !== editingSource.name) body.name = editName.trim()
      if (editUrl.trim() !== editingSource.url) body.url = editUrl.trim()

      if (Object.keys(body).length === 0) {
        toast.message('Không có thay đổi.')
        editDialogOpen = false
        editingSource = null
        return
      }

      const res = await fetch(api(`/api/sources/${editingSource.id}`), {
        method: 'PATCH',
        headers: adminHeaders(adminKey),
        body: JSON.stringify(body),
      })

      if (res.status === 401) {
        handleUnauthorized()
        return
      }

      const result = await res.json()
      if (!res.ok || !result.ok) {
        throw new Error(result.error || 'Không thể cập nhật.')
      }

      toast.success(`Đã cập nhật "${editName.trim()}".`)
      $sources = $sources.map((s) =>
        s.id === editingSource?.id
          ? {
              ...s,
              ...(body.name !== undefined ? { name: body.name as string } : {}),
              ...(body.url !== undefined ? { url: body.url as string } : {}),
            }
          : s,
      )
      editDialogOpen = false
      editingSource = null
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Không thể cập nhật.'
      toast.error(message)
    } finally {
      isEditing = false
    }
  }

  function handleUnauthorized() {
    authError = 'Admin key không đúng hoặc đã hết hạn.'
    toast.error(authError)
  }

  function saveAdminKeyFromForm(event: SubmitEvent) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget as HTMLFormElement)
    const key = String(formData.get('admin_key') ?? '').trim()
    if (!key) return

    adminKey = saveAdminKey(key)
    authError = ''
    showKeyInput = false
    toast.success('Đã lưu admin key.')
  }

  function clearAdminKey() {
    adminKey = ''
    clearAdminKeyStorage()
    authError = ''
    showKeyInput = false
    toast.message('Đã đăng xuất.')
  }



  async function addSource() {
    const normalizedUrl = newUrl.trim()
    if (!normalizedUrl) return

    isAdding = true
    authError = ''

    try {
      const res = await fetch(api('/api/sources'), {
        method: 'POST',
        headers: adminHeaders(adminKey),
        body: JSON.stringify({
          url: normalizedUrl,
          name: newName.trim() || undefined,
        }),
      })

      if (res.status === 401) {
        handleUnauthorized()
        return
      }

      const result = await res.json()
      if (!res.ok || !result.ok) {
        throw new Error(result.error || 'Không thể thêm nguồn tin.')
      }

      toast.success(`Đã thêm "${result.source.name}".`)
      newUrl = ''
      newName = ''

      await fetchSources()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Không thể thêm nguồn tin.'
      toast.error(message)
    } finally {
      isAdding = false
    }
  }

  function addTogglingId(id: string) {
    if (!togglingIds.includes(id)) {
      togglingIds = [...togglingIds, id]
    }
  }

  function removeTogglingId(id: string) {
    togglingIds = togglingIds.filter((value) => value !== id)
  }

  async function toggleSource(id: string, currentEnabled: number) {
    const nextEnabled = currentEnabled ? 0 : 1
    const snapshot = $sources

    authError = ''
    addTogglingId(id)
    $sources = $sources.map((source) =>
      source.id === id ? { ...source, enabled: nextEnabled } : source,
    )

    try {
      const res = await fetch(api(`/api/sources/${id}`), {
        method: 'PATCH',
        headers: adminHeaders(adminKey),
        body: JSON.stringify({ enabled: nextEnabled === 1 }),
      })

      if (res.status === 401) {
        $sources = snapshot
        handleUnauthorized()
        return
      }

      const result = await res.json()
      if (!res.ok || !result.ok) {
        throw new Error(result.error || 'Không thể cập nhật.')
      }

      toast.success(nextEnabled ? 'Đã bật nguồn tin.' : 'Đã tắt nguồn tin.')
    } catch (error) {
      $sources = snapshot
      const message =
        error instanceof Error ? error.message : 'Không thể cập nhật.'
      toast.error(message)
    } finally {
      removeTogglingId(id)
    }
  }

  async function deleteSource() {
    if (!deletingSource) return

    isDeleting = true
    authError = ''

    try {
      const res = await fetch(api(`/api/sources/${deletingSource.id}`), {
        method: 'DELETE',
        headers: adminHeaders(adminKey),
      })

      if (res.status === 401) {
        handleUnauthorized()
        return
      }

      const result = await res.json()
      if (!res.ok || !result.ok) {
        throw new Error(result.error || 'Không thể xóa.')
      }

      toast.success(`Đã xóa "${deletingSource.name}".`)
      $sources = $sources.filter((source) => source.id !== deletingSource?.id)
      deleteDialogOpen = false
      deletingSource = null
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể xóa.'
      toast.error(message)
    } finally {
      isDeleting = false
    }
  }

  async function manualFetch(source: Source) {
    fetchingSourceId = source.id
    authError = ''
    const toastId = toast.loading(`Đang fetch "${source.name}"...`)

    try {
      const res = await fetch(api(`/api/sources/${source.id}/fetch`), {
        method: 'POST',
        headers: adminHeaders(adminKey),
      })

      if (res.status === 401) {
        toast.dismiss(toastId)
        handleUnauthorized()
        return
      }

      const result = await res.json()
      if (!res.ok || !result.ok) {
        throw new Error(result.error || 'Fetch thất bại.')
      }

      toast.success(`Fetch ${result.fetched} bài, +${result.inserted} mới.`, {
        id: toastId,
      })
      await fetchSources()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fetch thất bại.'
      toast.error(message, { id: toastId })
    } finally {
      fetchingSourceId = null
    }
  }

  async function fetchAllSources() {
    isFetchingAll = true
    authError = ''
    const toastId = toast.loading('Đang fetch tất cả nguồn...')

    try {
      const res = await fetch(api('/api/sources/fetch-all'), {
        method: 'POST',
        headers: adminHeaders(adminKey),
      })

      if (res.status === 401) {
        toast.dismiss(toastId)
        handleUnauthorized()
        return
      }

      const result = await res.json()
      if (!res.ok || !result.ok) {
        throw new Error(result.error || 'Fetch thất bại.')
      }

      const failed = (result.results ?? []).filter(
        (item: { error?: string }) => item.error,
      ).length
      toast.success(
        `Fetch ${result.total_fetched ?? 0} bài, +${result.total_inserted ?? 0} mới${failed ? `, ${failed} lỗi` : ''}.`,
        { id: toastId },
      )
      await fetchSources()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fetch thất bại.'
      toast.error(message, { id: toastId })
    } finally {
      isFetchingAll = false
    }
  }


</script>

<svelte:head>
  <title>NewsDigest - Nguồn tin</title>
</svelte:head>

<div class="min-h-screen bg-bg-1">
  <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
    <!-- Header -->
    <header class="mb-8">
      <div class="flex items-center justify-between gap-4 mb-6">
        <CusButton href="/" class="size-9">
          <ArrowLeft size={18} />
        </CusButton>

        <div class="flex items-center gap-2">
          {#if isAuthed}
            <span
              class="text-[0.675rem] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mr-1"
            >
              <LockOpen size={11} /> Admin
            </span>
            <CusButton class="h-8 px-3.5 text-xs" onclick={clearAdminKey}
              >Đăng xuất</CusButton
            >
          {:else if showKeyInput}
            <form
              onsubmit={saveAdminKeyFromForm}
              class="flex items-center gap-2"
            >
              <!-- svelte-ignore a11y_autofocus -->
              <input
                type="password"
                name="admin_key"
                placeholder="Admin key..."
                class="h-8 w-40 text-xs rounded-full border border-border bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-text-main/10 placeholder:text-text-secondary/60 disabled:cursor-not-allowed disabled:opacity-50"
                autofocus
              />
              <CusButton class="h-8 px-3 text-xs" type="submit">Lưu</CusButton>
              <CusButton
                class="h-8 px-3 text-xs"
                type="button"
                onclick={() => (showKeyInput = false)}>Huỷ</CusButton
              >
            </form>
          {:else}
            <CusButton
              class="h-8 px-3.5 text-xs"
              onclick={() => (showKeyInput = true)}
            >
              <Lock size={12} class="mr-1.5" /> Đăng nhập
            </CusButton>
          {/if}
        </div>
      </div>

      <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1
            class="font-serif text-3xl font-bold text-text-main leading-tight"
          >
            Nguồn tin
          </h1>
          <p class="text-sm text-text-secondary mt-1">
            {$sources.length} nguồn · {enabledCount} đang bật
          </p>
        </div>

        {#if isAuthed}
          <CusButton
            class="h-9 px-4 text-sm shrink-0"
            disabled={isFetchingAll}
            onclick={fetchAllSources}
          >
            {#if isFetchingAll}
              <Loader2 size={14} class="animate-spin mr-1.5" />
              <span>Đang fetch...</span>
            {:else}
              <RefreshCw size={14} class="mr-1.5" />
              <span>Fetch tất cả</span>
            {/if}
          </CusButton>
        {/if}
      </div>
    </header>

    {#if authError}
      <div
        class="mb-5 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-4 py-2.5"
      >
        🔒 {authError}
      </div>
    {/if}

    <!-- Add Source (admin only) -->
    {#if isAuthed}
      <AddSourceForm
        bind:newUrl
        bind:newName
        {isAdding}
        onAdd={addSource}
      />
    {/if}

    <!-- Sources List -->
    {#if loading}
      <div class="flex flex-col gap-3 animate-pulse">
        {#each Array(5) as _, i (i)}
          <div class="rounded-xl border border-border/40 p-4">
            <div class="flex items-center gap-3">
              <div
                class="size-8 rounded-full bg-zinc-200 dark:bg-zinc-800"
              ></div>
              <div class="flex-1">
                <div
                  class="h-4 w-40 rounded bg-zinc-200 dark:bg-zinc-800 mb-2"
                ></div>
                <div
                  class="h-3 w-64 rounded bg-zinc-200 dark:bg-zinc-800"
                ></div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {:else if $sources.length === 0}
      <div
        class="py-20 text-center border border-dashed border-border/60 rounded-2xl text-text-secondary text-sm"
      >
        Chưa có nguồn tin nào.{isAuthed
          ? ' Thêm nguồn đầu tiên ở trên.'
          : ' Đăng nhập admin để thêm.'}
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#each sortedSources as source (source.id)}
          {@const typeInfo = getTypeIcon(source.type)}
          {@const isFetching = fetchingSourceId === source.id}
          {@const isToggling = togglingIds.includes(source.id)}
          <SourceItem
            {source}
            {isAuthed}
            {isFetching}
            {isToggling}
            {typeInfo}
            formattedTime={formatRelativeTime(source.last_fetched_at)}
            onManualFetch={() => manualFetch(source)}
            onEdit={() => openEditDialog(source)}
            onDelete={() => openDeleteDialog(source)}
            onToggle={() => toggleSource(source.id, source.enabled)}
          />
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- Delete Confirmation Dialog -->
<SourceDeleteDialog
  bind:open={deleteDialogOpen}
  {deletingSource}
  {isDeleting}
  onDelete={deleteSource}
  onCancel={() => {
    deleteDialogOpen = false
    deletingSource = null
  }}
/>

<!-- Edit Source Dialog -->
<SourceEditDialog
  bind:open={editDialogOpen}
  bind:editName
  bind:editUrl
  {isEditing}
  onSave={editSource}
  onCancel={() => {
    editDialogOpen = false
    editingSource = null
  }}
/>
