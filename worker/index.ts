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
    if (event.cron === '0 1,13 * * *') {
      // Digest cron: 8h & 20h VN
      await scheduledDigest(env);
    } else {
      // Scraper cron: mỗi 3h
      await scheduled(event, env, ctx);
    }
  },
  async queue(batch: MessageBatch<ContentScrapeMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleContentQueue(batch, env);
  }
}
