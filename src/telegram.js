import fs from 'node:fs';

export class TelegramApi {
  constructor(token, { fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.fetch = fetchImpl;
    this.sleep = sleep;
  }

  call(method, payload = {}) {
    return this.request(method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async request(method, options) {
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetch(`${this.baseUrl}/${method}`, {
        ...options, signal: AbortSignal.timeout(60000),
      });
      let result;
      try {
        result = await response.json();
      } catch {
        const error = new Error(`Telegram ${method}: некорректный ответ HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      if (result.ok) return result.result;
      const error = new Error(`Telegram ${method}: ${result.description || 'ошибка API'}`);
      error.status = result.error_code || response.status;
      error.retryAfter = result.parameters?.retry_after;
      // Retry only an explicit rejection, never an uncertain send after a timeout.
      if (error.status === 429 && attempt < 2) {
        await this.sleep(Math.max(1, Number(error.retryAfter) || 1) * 1000);
        continue;
      }
      throw error;
    }
  }

  sendMessage(chatId, text, replyMarkup) {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  async sendDocument(chatId, filePath, caption) {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('caption', caption);
    form.set('document', new Blob([fs.readFileSync(filePath)]), filePath.split(/[\\/]/).pop());
    return this.request('sendDocument', { method: 'POST', body: form });
  }

  async sendPhoto(chatId, filePath, caption, replyMarkup) {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('caption', caption);
    form.set('parse_mode', 'HTML');
    if (replyMarkup) form.set('reply_markup', JSON.stringify(replyMarkup));
    form.set('photo', new Blob([fs.readFileSync(filePath)]), filePath.split(/[\\/]/).pop());
    return this.request('sendPhoto', { method: 'POST', body: form });
  }
}
