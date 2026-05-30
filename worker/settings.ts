export const SCRAPER_SETTINGS = {
  cron: {
    general: '0 */3 * * *',
    githubTrending: '0 1 * * *',
    retryFailed: '*/30 * * * *',
    cleanup: '30 23 * * *',
  },
  sourceFetch: {
    batchSize: 3,
    htmlTimeoutMs: 15000,
    rssTimeoutMs: 15000,
    githubTrendingTimeoutMs: 15000,
    githubTrendingMaxRepos: 15,
    rssRecentDays: 3,
    rssMaxItems: 10,
    rssContentEncodedMinChars: 500,
  },
  reddit: {
    listingLimit: 15,
    minScore: 50,
    minComments: 15,
    sourceStaggerMs: 15000,
    queueDelaySeconds: 15,
    queueFetchDelayMs: 10000,
    fetchTimeoutMs: 15000,
    retryDelaySeconds: 120,
    reprocessAfterDays: 1,
    contentMaxChars: 25000,
    topCommentsLimit: 25,
    commentPreviewChars: 500,
    replyPreviewChars: 300,
    selfTextPreviewChars: 300,
  },
  github: {
    reprocessAfterDays: 3,
    readmeMaxChars: 25000,
    apiTimeoutMs: 10000,
    rawTimeoutMs: 10000,
  },
  content: {
    extractMaxChars: 25000,
    fetchTimeoutMs: 10000,
    descriptionFallbackMinChars: 200,
    richDescriptionMinChars: 1000,
  },
  retry: {
    failedWindowDays: 2,
    maxRetryBatch: 50,
    defaultRateLimitDelaySeconds: 30,
  },
  retention: {
    days: 30,
  },
  aiProfile: {
    minHtmlChars: 300,
    htmlSampleChars: 120000,
    debugPreviewChars: 2000,
    articlePreviewChars: 500,
    listingPreviewItems: 10,
    maxContentSelectors: 8,
    maxListingSelectors: 10,
    maxRemoveSelectors: 20,
  },
  googleNews: {
    resolveTimeoutMs: 10000,      // timeout per URL resolve (2 HTTP round-trips)
    resolveDelayMs: 3000,         // delay between each URL decode (avoid rate limit)
    maxResolvePerFeed: 10,        // max URLs to decode per RSS fetch cycle
  },
  queue: {
    normalSendBatchSize: 25,
    redditSendBatchSize: 100,
  },
} as const;
