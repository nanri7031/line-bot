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

// ===== 保存 =====
function saveData() {
  fs.writeFileSync('data.json', JSON.stringify(userData, null, 2));
}
function loadData() {
  if (fs.existsSync('data.json')) {
    userData = JSON.parse(fs.readFileSync('data.json'));
  }
}
loadData();

// ===== 名前生成（被り対策）=====
function generateName(name) {
  let count = 1;
  let newName = name;

  const names = Object.values(userData).map(u => u.name);

  while (names.includes(newName)) {
    newName = `${name}_${count}`;
    count++;
  }
  return newName;
}

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

// ===== メイン =====
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

  // ===== 初期登録 =====
  if (!userData[userId]) {
    userData[userId] = {
      name: generateName(profile.displayName),
      warns: 0,
      blacklist: false,
      lastMsg: '',
      lastTime: 0,
      spam: 0
    };
    saveData();
  }

  const user = userData[userId];

  // ===== 連投 =====
  if (text === user.lastMsg) {
    user.spam++;
    if (user.spam >= 3) user.warns++;
  } else {
    user.spam = 0;
  }

  if (now - user.lastTime < 3000) {
    user.warns++;
  }

  user.lastMsg = text;
  user.lastTime = now;

  // ===== NGワード =====
  if (ngWords.some(w => text.includes(w))) {
    user.warns++;
  }

  // ===== 自動BAN =====
  if (user.warns >= 2 && !user.blacklist) {
    user.blacklist = true;
    saveData();
    return reply(event, `🚫 ${user.name} はBANされました`);
  }

  if (user.blacklist) {
    return reply(event, `⚠️ ${user.name} は制限中`);
  }

  // ===== 通報 =====
  if (text.startsWith('通報')) {
    const name = text.split(' ')[1];
    const found = findUser(name);

    if (!found) return reply(event, 'ユーザー不明');

    const [, target] = found;
    target.warns++;

    if (target.warns >= 2) {
      target.blacklist = true;
    }

    saveData();
    return reply(event, `通報受付: ${target.name}`);
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

    saveData();
    return reply(event, `操作完了: ${target.name}`);
  }

  // ===== メンション風 =====
  if (text.startsWith('@')) {
    const name = text.replace('@', '');
    return reply(event, `👉 ${name} さんへ`);
  }

  if (text === 'ルール') {
    return reply(event, '暴言・連投・荒らし禁止');
  }
}

// ===== 管理画面 =====
app.get('/admin', (req, res) => {
  let html = '<h1>管理画面</h1>';

  Object.entries(userData).forEach(([id, u]) => {
    html += `
      <div>
        ${u.name}（${u.warns}）
        <a href="/ban?id=${id}">BAN</a>
        <a href="/unban?id=${id}">解除</a>
      </div><hr>
    `;
  });

  res.send(html);
});

app.get('/ban', (req, res) => {
  userData[req.query.id].blacklist = true;
  saveData();
  res.send('BAN完了');
});

app.get('/unban', (req, res) => {
  userData[req.query.id].blacklist = false;
  saveData();
  res.send('解除完了');
});

// ===== 返信 =====
function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: text
  });
}

app.listen(3000);
