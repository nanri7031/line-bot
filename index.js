const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.ACCESS_TOKEN,
  channelSecret: process.env.SECRET
};

const app = express();
const client = new line.Client(config);

// ===== 管理者設定（あなたのID）=====
const admins = ['Ud9ae0b76918ab20e33fb8b25c78a5f95'];

// ===== NGワード =====
const ngWords = ['死ね', 'バカ', '消えろ'];

// ===== ユーザーデータ =====
let userData = {};

// ===== スパム設定 =====
const SPAM_LIMIT = 3;
const TIME_LIMIT = 5000;

// ===== Webhook =====
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.end())
    .catch(() => res.end());
});

// ===== メイン処理 =====
async function handleEvent(event) {
  if (event.type !== 'message') return Promise.resolve(null);
  if (event.message.type !== 'text') return Promise.resolve(null);

  const userId = event.source.userId;
  const text = event.message.text;
  const now = Date.now();

  // 初期化
  if (!userData[userId]) {
    userData[userId] = {
      warns: 0,
      lastMessage: '',
      spamCount: 0,
      lastTime: 0,
      blacklist: false
    };
  }

  const user = userData[userId];

  // ===== ID取得 =====
  if (text === 'id') {
    return reply(event, `あなたのID: ${userId}`);
  }

  // ===== NGワード =====
  if (ngWords.some(word => text.includes(word))) {
    user.warns++;
    return reply(event, `⚠️ NGワード検知（${user.warns}回目）`);
  }

  // ===== スパム検知 =====

  // 同文連投
  if (text === user.lastMessage) {
    user.spamCount++;
    if (user.spamCount >= SPAM_LIMIT) {
      user.warns++;
      return reply(event, `⚠️ 同文連投（${user.warns}回目）`);
    }
  } else {
    user.spamCount = 0;
  }

  // 短時間連投
  if (now - user.lastTime < TIME_LIMIT) {
    user.warns++;
    return reply(event, `⚠️ 短時間連投（${user.warns}回目）`);
  }

  user.lastMessage = text;
  user.lastTime = now;

  // ===== ブラックリスト =====
  if (user.blacklist) {
    return reply(event, `⚠️ 要注意ユーザーです`);
  }

  // ===== 管理者コマンド =====
  if (text.startsWith('/')) {

    if (!admins.includes(userId)) {
      return reply(event, '権限がありません');
    }

    if (text === '/確認') {
      return reply(event, 'BOT正常稼働中');
    }

    if (text === '/警告') {
      user.warns++;
      return reply(event, `⚠️ 管理者警告（${user.warns}回）`);
    }

    if (text === '/追加') {
      user.blacklist = true;
      return reply(event, 'ブラックリスト登録しました');
    }

    if (text === '/解除') {
      user.blacklist = false;
      return reply(event, 'ブラックリスト解除しました');
    }

    if (text === '/ルール') {
      return reply(event,
        '【グループルール】\n' +
        '・暴言禁止\n' +
        '・荒らし禁止\n' +
        '・連投禁止'
      );
    }
  }

  // ===== 一般コマンド =====
  if (text === 'ルール') {
    return reply(event,
      '【グループルール】\n' +
      '・暴言禁止\n' +
      '・荒らし禁止\n' +
      '・連投禁止'
    );
  }

  return Promise.resolve(null);
}

// ===== 返信処理 =====
function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: text
  });
}

// ===== 起動 =====
app.listen(3000, () => {
  console.log('BOT起動中');
});
