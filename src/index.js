import { createBot } from './bot.js';
import { createAnalytics } from './analytics.js';
import { config, validateConfig } from './config.js';
import { setupTelegram, describeConnectionError } from './startup.js';
import { TelegramApi } from './telegram.js';
import { startStatsServer } from './stats-server.js';
import { createErrorLogger } from './error-notifier.js';

validateConfig();
const api = new TelegramApi(config.token);
const logger = createErrorLogger(api, {
  chatId: config.errorChatId, secrets: [config.token, config.statsToken],
});
const analytics = createAnalytics(config.analyticsDir);
const { secretPath } = await startStatsServer({
  token: config.statsToken,
  logger,
  directory: config.analyticsDir, host: config.statsHost, port: config.statsPort,
});
console.log(`Статистика на этом компьютере: http://localhost:${config.statsPort}${secretPath}`);
// Persist before advancing the polling offset so a storage failure is retried.
const bot = createBot(api, logger);
let offset = 0;

await setupTelegram(api, { logger });

console.log('Бот запущен. Для остановки нажмите Ctrl+C.');

while (true) {
  try {
    const updates = await api.call('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
    for (const update of updates) {
      analytics.recordUpdate(update);
      offset = update.update_id + 1;
      try {
        await bot.handleUpdate(update);
      } catch (error) {
        if (error.message?.includes('Forbidden: bot was blocked by the user')) {
          console.warn(`Update ${update.update_id} пропущен: пользователь заблокировал бота.`);
          continue;
        }
        logger.error(`Ошибка update ${update.update_id}:`, error);
      }
    }
  } catch (error) {
    logger.error('Ошибка получения обновлений:', describeConnectionError(error));
    if (error.status === 409) {
      console.error('Конфликт получения событий: проверьте, не запущена ли другая копия бота и не установлен ли webhook.');
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(3000, (error.retryAfter || 0) * 1000)));
  }
}
