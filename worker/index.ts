import { Env } from './types';
import { scheduled } from './cron/index';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const app = (await import('./api/index')).default;
    return app.fetch(request, env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await scheduled(event, env, ctx);
  }
}
