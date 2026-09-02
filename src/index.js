import { createBot } from './bot.js';
import { config, validateConfig } from './config.js';
import { botCommands } from './content.js';
import { TelegramApi } from './telegram.js';

validateConfig();
const api = new TelegramApi(config.token);
const bot = createBot(api);
let offset = 0;

await api.call('setMyCommands', {
  commands: botCommands,
  scope: { type: 'all_private_chats' },
});
await api.call('setChatMenuButton', {
  menu_button: { type: 'commands' },
});

console.log('Бот запущен. Для остановки нажмите Ctrl+C.');

while (true) {
  try {
    const updates = await api.call('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
    for (const update of updates) {
      offset = update.update_id + 1;
      try {
        await bot.handleUpdate(update);
      } catch (error) {
        console.error(`Ошибка update ${update.update_id}:`, error);
      }
    }
  } catch (error) {
    console.error('Ошибка получения обновлений:', error.message);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
