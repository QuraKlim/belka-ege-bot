import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/bot.js';

test('/start отправляет приветствие и клавиатуру', async () => {
  const calls = [];
  const api = { sendPhoto: async (...args) => calls.push(args), call: async () => ({}) };
  await createBot(api).handleUpdate({ message: { chat: { id: 42 }, text: '/start' } });
  assert.equal(calls.length, 1);
  assert.match(calls[0][1], /assets[\\/]main\.jpg$/);
  assert.match(calls[0][2], /Какой экзамен/);
  assert.equal(calls[0][3].inline_keyboard[0][0].text, 'ОГЭ');
  assert.equal(calls[0][3].inline_keyboard[0][0].callback_data, 'material:oge');
  assert.equal(calls[0][3].inline_keyboard[0][1].text, 'ЕГЭ');
  assert.equal(calls[0][3].inline_keyboard[1][0].text, 'Итоговое сочинение');
});

test('без подписки материал закрыт', async () => {
  const messages = [];
  const api = {
    sendMessage: async (...args) => messages.push(args),
    call: async (method) => method === 'getChatMember' ? { status: 'left' } : {},
  };
  await createBot(api).handleUpdate({ callback_query: {
    id: 'q1', data: 'material:oge', from: { id: 7 }, message: { chat: { id: 42 } },
  } });
  assert.equal(messages.length, 1);
  assert.match(messages[0][1], /Ты не подписан/);
});

test('повторная проверка выводит отдельное сообщение', async () => {
  const messages = [];
  const api = {
    sendMessage: async (...args) => messages.push(args),
    call: async (method) => method === 'getChatMember' ? { status: 'left' } : {},
  };
  await createBot(api).handleUpdate({ callback_query: {
    id: 'q2', data: 'check|exam:oge', from: { id: 7 }, message: { chat: { id: 42 } },
  } });
  assert.equal(messages.length, 1);
  assert.match(messages[0][1], /Ты не подписан/);
  assert.match(messages[0][1], /<a href="https:\/\/t\.me\//);
});

test('неизвестный текст получает сообщение об ошибке', async () => {
  const messages = [];
  const api = { sendMessage: async (...args) => messages.push(args) };
  await createBot(api).handleUpdate({
    message: { chat: { id: 42 }, from: { id: 7 }, text: 'привет' },
  });
  assert.equal(messages[0][1], 'Такой команды не существует');
});
