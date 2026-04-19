const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.ACCESS_TOKEN,
  channelSecret: process.env.SECRET
};

const app = express();
const client = new line.Client(config);

// 管理者
const admins = ['Ud9ae0b76918ab20e33fb8b25c78a5f95'];

// NGワード
const ngWords = ['死ね', 'バカ', '消えろ'];

// データ保存
let userData = {};

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.end())
    .catch(() => res.end());
});

async function handleEvent(event) {
  if (event.type !== 'message') return Promise.resolve(null);
  if (event.message.type !== 'text') return Promise.resolve(null);

  const userId = event.source.userId;
  const text = event.message.text;

  // 初期化
  if (!userData[userId]) {
    userData[userId] = { warns: 0, blacklist: false };
  }

  // ===== ID取得 =====
  if (text === 'id') {
    return reply(event, `あなたのID: ${userId}`);
  }

  // ===== NGワード =====
  if (ngWords.some(word => text.includes(word))) {
    userData[userId].warns++;
    return reply(event, `⚠️ NGワード検知（${userData[userId].warns}回目）`);
  }

  // ===== ブラック =====
  if (userData[userId].blacklist) {
    return reply(event, '⚠️ 要注意ユーザーです');
  }

  // ===== 管理者コマンド =====
  if (text.startsWith('/')) {

    if (!admins.includes(userId)) {
      return reply(event, '権限がありません');
    }

    const parts = text.split(' ');
    const command = parts[0];
    const targetId = parts[1];

    // 対象初期化
    if (targetId && !userData[targetId]) {
      userData[targetId] = { warns: 0, blacklist: false };
    }

    // ===== コマンド =====

    if (command === '/確認') {
      return reply(event, 'BOT正常稼働中');
    }

    if (command === '/警告') {
      if (!targetId) return reply(event, 'IDを指定してください');

      userData[targetId].warns++;
      return reply(event, `⚠️ ${targetId} に警告（${userData[targetId].warns}回）`);
    }

    if (command === '/追加') {
      if (!targetId) return reply(event, 'IDを指定してください');

      userData[targetId].blacklist = true;
      return reply(event, `🚫 ${targetId} をブラックリスト登録`);
    }

    if (command === '/解除') {
      if (!targetId) return reply(event, 'IDを指定してください');

      userData[targetId].blacklist = false;
      return reply(event, `✅ ${targetId} を解除`);
    }
  }

  // ===== ルール =====
  if (text === 'ルール') {
    return reply(event,
      '【ルール】\n・暴言禁止\n・荒らし禁止\n・連投禁止'
    );
  }

  return Promise.resolve(null);
}

// 返信
function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: text
  });
}

app.listen(3000);
