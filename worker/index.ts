import { Env, ContentScrapeMessage } from './types';
import { scheduled } from './cron/index';
import { scheduledDigest } from './cron/digest';
import { handleContentQueue } from './queue/content-scraper';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const app = (await import('./api/index')).default;
    return app.fetch(request, env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Scraper cron: mỗi 3h — fetch + summarize + digest
    await scheduled(event, env, ctx);
    // Sau khi scrape xong, tạo/cập nhật digest cho ngày hiện tại
    await scheduledDigest(env);
  },
  async queue(batch: MessageBatch<ContentScrapeMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleContentQueue(batch, env);
  }
}
