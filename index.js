const express = require('express');
const line = require('@line/bot-sdk');
const fs = require('fs');

const config = {
  channelAccessToken: process.env.ACCESS_TOKEN,
  channelSecret: process.env.SECRET
};

const app = express();
const client = new line.Client(config);

const admins = ['Ud9ae0b76918ab20e33fb8b25c78a5f95'];
const ngWords = ['死ね', 'バカ', '消えろ', 'アホ'];

let userData = {};

function save() {
  fs.writeFileSync('data.json', JSON.stringify(userData, null, 2));
}
function load() {
  if (fs.existsSync('data.json')) {
    userData = JSON.parse(fs.readFileSync('data.json'));
  }
}
load();

// ===== 名前検索 =====
function findUser(name) {
  return Object.entries(userData).find(
    ([id, u]) => u.name === name
  );
}

// ===== Webhook =====
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.end())
    .catch(() => res.end());
});

async function handleEvent(event) {
  if (event.type !== 'message') return;
  if (event.message.type !== 'text') return;

  const userId = event.source.userId;
  const text = event.message.text;
  const now = Date.now();

  let profile;
  try {
    profile = await client.getProfile(userId);
  } catch {
    profile = { displayName: 'ユーザー' };
  }

  // 初期化
  if (!userData[userId]) {
    userData[userId] = {
      name: profile.displayName,
      warns: 0,
      lastWarn: 0,
      reports: 0,
      blacklist: false,
      lastMsg: '',
      lastTime: 0
    };
    save();
  }

  const user = userData[userId];

  // ===== 時間リセット（重要）=====
  if (now - user.lastWarn > 600000) {
    user.warns = 0; // 10分でリセット
  }

  let warned = false;

  // ===== NGワード =====
  if (ngWords.some(w => text.includes(w))) {
    user.warns++;
    user.lastWarn = now;
    warned = true;
  }

  // ===== 連投（かなり厳しく）=====
  if (!warned && text === user.lastMsg && now - user.lastTime < 1000) {
    user.warns++;
    user.lastWarn = now;
    warned = true;
  }

  user.lastMsg = text;
  user.lastTime = now;

  // ===== 通報 =====
  if (text.startsWith('通報')) {
    const name = text.split(' ')[1];
    const found = findUser(name);

    if (!found) return reply(event, 'ユーザー不明');

    const [, target] = found;
    target.reports++;

    if (target.reports >= 2) {
      target.warns++;
      target.reports = 0;
    }

    save();
    return reply(event, `通報受付: ${target.name}`);
  }

  // ===== BAN条件（安全）=====
  if (user.warns >= 5 && user.reports >= 2) {
    user.blacklist = true;
    save();
    return reply(event, `🚫 ${user.name} は制限対象`);
  }

  if (user.blacklist) {
    return reply(event, `⚠️ ${user.name} は制限中`);
  }

  // ===== 管理者 =====
  if (text.startsWith('/')) {

    if (!admins.includes(userId)) {
      return reply(event, '権限なし');
    }

    const parts = text.split(' ');
    const cmd = parts[0];
    const name = parts[1];

    const found = findUser(name);
    if (!found) return reply(event, 'ユーザー不明');

    const [, target] = found;

    if (cmd === '/警告') target.warns++;
    if (cmd === '/追加') target.blacklist = true;
    if (cmd === '/解除') target.blacklist = false;

    save();
    return reply(event, `管理操作: ${target.name}`);
  }

  // ===== メンション風 =====
  if (text.startsWith('@')) {
    return reply(event, `👉 ${text.replace('@','')} さんへ`);
  }

  if (text === 'ルール') {
    return reply(event, '暴言・連投・通報で制限');
  }
}

// ===== 返信 =====
function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: text
  });
}

app.listen(3000);
