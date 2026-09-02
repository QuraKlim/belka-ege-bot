import fs from 'node:fs';

export class TelegramApi {
  constructor(token) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async call(method, payload = {}) {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!result.ok) throw new Error(`Telegram ${method}: ${result.description}`);
    return result.result;
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
    const response = await fetch(`${this.baseUrl}/sendDocument`, { method: 'POST', body: form });
    const result = await response.json();
    if (!result.ok) throw new Error(`Telegram sendDocument: ${result.description}`);
    return result.result;
  }

  async sendPhoto(chatId, filePath, caption, replyMarkup) {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('caption', caption);
    form.set('parse_mode', 'HTML');
    if (replyMarkup) form.set('reply_markup', JSON.stringify(replyMarkup));
    form.set('photo', new Blob([fs.readFileSync(filePath)]), filePath.split(/[\\/]/).pop());
    const response = await fetch(`${this.baseUrl}/sendPhoto`, { method: 'POST', body: form });
    const result = await response.json();
    if (!result.ok) throw new Error(`Telegram sendPhoto: ${result.description}`);
    return result.result;
  }
}
