<script lang="ts">
  import { onMount } from 'svelte';
  import { articles, isLoading, filters } from '$lib/stores/articles';
  import { api } from '$lib/api';
  import { sources } from '$lib/stores/sources';
  import ArticleCard from '$lib/components/app/ArticleCard.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { LoaderCircle } from 'lucide-svelte';
  import type { Article } from '$lib/types';

  const TAGS = ['AI', 'Security', 'Tech', 'Business', 'Vietnam', 'World', 'Dev', 'Science', 'Crypto', 'Policy'];

  let allArticles = $state<Article[]>([]);
  let initialLoading = $state(true);

  // Filtered + sorted articles derived from local data — no API call on filter change
  let filteredArticles = $derived.by(() => {
    let result = allArticles;

    // Filter by tag
    if ($filters.tag) {
      result = result.filter(a => {
        try {
          const tags: string[] = a.tags ? JSON.parse(a.tags) : [];
          return tags.some(t => t.toLowerCase() === $filters.tag.toLowerCase());
        } catch { return false; }
      });
    }

    // Filter by source
    if ($filters.sourceId) {
      result = result.filter(a => a.source_id === $filters.sourceId);
    }

    // Filter by min hot score
    if ($filters.minHot > 0) {
      result = result.filter(a => (a.hot_score ?? 0) >= $filters.minHot);
    }

    // Sort
    if ($filters.sort === 'hot') {
      result = [...result].sort((a, b) => (b.hot_score ?? 0) - (a.hot_score ?? 0));
    } else {
      result = [...result].sort((a, b) => {
        const da = a.published_at || a.fetched_at;
        const db = b.published_at || b.fetched_at;
        return new Date(db).getTime() - new Date(da).getTime();
      });
    }

    return result;
  });

  const MOCK_ARTICLES: Article[] = [
    { id: 'm1', source_id: 'mock-1', url: 'https://example.com/1', title: 'OpenAI ra mắt GPT-5 với khả năng suy luận nâng cao', summary: 'OpenAI vừa công bố phiên bản GPT-5 với nhiều cải tiến đáng kể về khả năng suy luận, code generation và multimodal understanding. Mô hình mới có thể xử lý context lên đến 1 triệu token.', full_text: null, hot_score: 9, tags: '["AI","Tech"]', published_at: '2026-03-23T06:00:00Z', fetched_at: '2026-03-23T06:30:00Z', is_bookmarked: 0, is_read: 0 },
    { id: 'm2', source_id: 'mock-2', url: 'https://example.com/2', title: 'Việt Nam đặt mục tiêu top 3 ASEAN về AI vào 2030', summary: 'Chính phủ vừa phê duyệt chiến lược quốc gia về trí tuệ nhân tạo, đặt mục tiêu Việt Nam trở thành 1 trong 3 nước dẫn đầu ASEAN về nghiên cứu và ứng dụng AI vào năm 2030.', full_text: null, hot_score: 8, tags: '["AI","Vietnam","Policy"]', published_at: '2026-03-23T05:30:00Z', fetched_at: '2026-03-23T06:00:00Z', is_bookmarked: 1, is_read: 0 },
    { id: 'm3', source_id: 'mock-3', url: 'https://example.com/3', title: 'Cloudflare Workers AI hỗ trợ fine-tuning trực tiếp', summary: 'Cloudflare mở rộng nền tảng Workers AI cho phép fine-tuning các mô hình ngôn ngữ trực tiếp trên edge, giảm đáng kể thời gian và chi phí triển khai AI.', full_text: null, hot_score: 7, tags: '["AI","Tech","Dev"]', published_at: '2026-03-23T04:00:00Z', fetched_at: '2026-03-23T04:30:00Z', is_bookmarked: 0, is_read: 0 },
    { id: 'm4', source_id: 'mock-1', url: 'https://example.com/4', title: 'Critical zero-day exploit found in popular npm packages', summary: 'Security researchers have discovered a critical zero-day vulnerability affecting several popular npm packages with over 50 million weekly downloads combined. All users are urged to update immediately.', full_text: null, hot_score: 10, tags: '["Security","Dev"]', published_at: '2026-03-23T03:00:00Z', fetched_at: '2026-03-23T03:30:00Z', is_bookmarked: 0, is_read: 1 },
    { id: 'm5', source_id: 'mock-2', url: 'https://example.com/5', title: 'VinFast xuất khẩu lô xe điện lớn nhất sang châu Âu', summary: 'VinFast vừa hoàn tất đợt xuất khẩu xe điện lớn nhất lịch sử sang thị trường châu Âu, với hơn 5.000 chiếc VF8 và VF9 được vận chuyển tới Đức, Pháp và Hà Lan.', full_text: null, hot_score: 6, tags: '["Business","Vietnam"]', published_at: '2026-03-23T02:00:00Z', fetched_at: '2026-03-23T02:30:00Z', is_bookmarked: 0, is_read: 0 },
    { id: 'm6', source_id: 'mock-1', url: 'https://example.com/6', title: 'Rust 2.0 officially released with async improvements', summary: 'The Rust programming language team has released version 2.0, featuring major improvements to async/await ergonomics, a revamped borrow checker, and better compile times across the board.', full_text: null, hot_score: 8, tags: '["Dev","Tech"]', published_at: '2026-03-23T01:00:00Z', fetched_at: '2026-03-23T01:30:00Z', is_bookmarked: 0, is_read: 0 },
    { id: 'm7', source_id: 'mock-3', url: 'https://example.com/7', title: 'EU bỏ phiếu thông qua quy định AI Act toàn diện', summary: 'Nghị viện châu Âu đã chính thức thông qua AI Act với đa số phiếu thuận, thiết lập khung pháp lý toàn diện nhất thế giới về trí tuệ nhân tạo, có hiệu lực từ 2027.', full_text: null, hot_score: 7, tags: '["AI","Policy","World"]', published_at: '2026-03-22T23:00:00Z', fetched_at: '2026-03-22T23:30:00Z', is_bookmarked: 0, is_read: 0 },
    { id: 'm8', source_id: 'mock-1', url: 'https://example.com/8', title: 'Bitcoin vượt mốc $150,000 sau tin ETF mới', summary: 'Bitcoin đã chạm mốc $150,000 lần đầu tiên sau khi SEC phê duyệt thêm 3 quỹ ETF Bitcoin spot mới, kéo theo dòng vốn tổ chức đổ vào thị trường crypto.', full_text: null, hot_score: 9, tags: '["Crypto","Business"]', published_at: '2026-03-22T22:00:00Z', fetched_at: '2026-03-22T22:30:00Z', is_bookmarked: 1, is_read: 0 },
    { id: 'm9', source_id: 'mock-2', url: 'https://example.com/9', title: 'NASA phát hiện tín hiệu bất thường từ sao Proxima Centauri', summary: 'Các nhà khoa học NASA phát hiện một tín hiệu radio bất thường từ hệ sao Proxima Centauri. Dù chưa xác nhận nguồn gốc, phát hiện đã gây chấn động cộng đồng thiên văn học.', full_text: null, hot_score: 10, tags: '["Science","World"]', published_at: '2026-03-22T20:00:00Z', fetched_at: '2026-03-22T20:30:00Z', is_bookmarked: 0, is_read: 0 },
    { id: 'm10', source_id: 'mock-3', url: 'https://example.com/10', title: 'Svelte 5 đạt 1 triệu downloads/tuần trên npm', summary: 'Framework Svelte 5 đã đạt cột mốc 1 triệu lượt tải hàng tuần trên npm, trở thành framework frontend tăng trưởng nhanh nhất năm 2026 nhờ hệ thống runes và hiệu suất vượt trội.', full_text: null, hot_score: 5, tags: '["Dev","Tech"]', published_at: '2026-03-22T18:00:00Z', fetched_at: '2026-03-22T18:30:00Z', is_bookmarked: 0, is_read: 0 },
    { id: 'm11', source_id: 'mock-1', url: 'https://example.com/11', title: 'Google DeepMind giới thiệu Gemini Ultra 2', summary: 'Google DeepMind ra mắt Gemini Ultra 2, mô hình AI đa phương thức mạnh nhất của họ, vượt qua GPT-5 trong nhiều benchmark về reasoning và coding tasks.', full_text: null, hot_score: 8, tags: '["AI","Tech","Business"]', published_at: '2026-03-22T16:00:00Z', fetched_at: '2026-03-22T16:30:00Z', is_bookmarked: 0, is_read: 1 },
    { id: 'm12', source_id: 'mock-2', url: 'https://example.com/12', title: 'Đà Nẵng trở thành thành phố thông minh đầu tiên Việt Nam', summary: 'Đà Nẵng chính thức được công nhận là thành phố thông minh đầu tiên của Việt Nam, với hệ thống IoT bao phủ toàn thành phố và dịch vụ công trực tuyến cấp độ 4.', full_text: null, hot_score: 4, tags: '["Tech","Vietnam"]', published_at: '2026-03-22T14:00:00Z', fetched_at: '2026-03-22T14:30:00Z', is_bookmarked: 0, is_read: 0 },
  ];

  async function fetchAllArticles() {
    initialLoading = true;
    try {
      const res = await fetch(api('/api/articles?limit=200&sort=date'));
      const data = await res.json();
      if (data.articles) {
        allArticles = data.articles;
        $articles = data.articles;
      }
    } catch (e) {
      console.error('Failed to fetch articles, using mock data', e);
      // Fallback to mock data when backend is unavailable
      allArticles = MOCK_ARTICLES;
      $articles = MOCK_ARTICLES;
    } finally {
      initialLoading = false;
    }
  }

  onMount(fetchAllArticles);

  function setTag(tag: string) {
    $filters.tag = $filters.tag === tag ? '' : tag;
  }

  function toggleSort() {
    $filters.sort = $filters.sort === 'hot' ? 'date' : 'hot';
  }

  function setMinHot(val: number) {
    $filters.minHot = $filters.minHot === val ? 0 : val;
  }
</script>

<svelte:head>
  <title>NewsDigest - Home</title>
</svelte:head>

<div class="mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
  <div>
    <h1 class="text-3xl font-bold tracking-tight">Tin tức mới nhất</h1>
    <p class="text-muted-foreground mt-1">Được tổng hợp và phân tích bởi AI.</p>
  </div>
  <div class="flex gap-2 items-center">
     <Button variant={$filters.sort === 'hot' ? 'default' : 'outline'} size="sm" onclick={toggleSort}>
       {$filters.sort === 'hot' ? '🔥 Hot nhất' : '🕐 Mới nhất'}
     </Button>
     <Button variant={$filters.minHot >= 7 ? 'default' : 'outline'} size="sm" onclick={() => setMinHot(7)}>
       Hot ≥ 7
     </Button>
  </div>
</div>

<!-- Tag filter bar -->
<div class="flex gap-2 flex-wrap mb-6">
  {#each TAGS as tag}
    <button onclick={() => setTag(tag)}>
      <Badge variant={$filters.tag === tag ? 'default' : 'outline'} class="cursor-pointer hover:bg-primary/10 transition-colors">
        {tag}
      </Badge>
    </button>
  {/each}
  {#if $filters.tag || $filters.minHot > 0}
    <button onclick={() => { $filters.tag = ''; $filters.minHot = 0; }}>
      <Badge variant="secondary" class="cursor-pointer">✕ Bỏ lọc</Badge>
    </button>
  {/if}
</div>

{#if initialLoading}
  <div class="flex items-center justify-center py-24">
    <LoaderCircle size={36} class="animate-spin text-primary" />
  </div>
{:else if filteredArticles.length === 0}
  <div class="py-20 text-center border rounded-lg border-dashed text-muted-foreground">
    {$filters.tag || $filters.minHot > 0 ? 'Không tìm thấy bài viết phù hợp. Thử bỏ bộ lọc.' : 'Chưa có bài viết nào được tải. Đang đợi Cron Worker...'}
  </div>
{:else}
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    {#each filteredArticles as article (article.id)}
      <ArticleCard {article} />
    {/each}
  </div>
{/if}
