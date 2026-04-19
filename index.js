const express = require('express');
const line = require('@line/bot-sdk');
const fs = require('fs');

const config = {
  channelAccessToken: process.env.ACCESS_TOKEN,
  channelSecret: process.env.SECRET
};

const app = express();
const client = new line.Client(config);

let admins = ['Ud9ae0b76918ab20e33fb8b25c78a5f95'];
const ngWords = ['死ね', 'バカ', '消えろ', 'アホ'];

let userData = {};

// ===== 保存 =====
function save() {
  fs.writeFileSync('data.json', JSON.stringify({ userData, admins }, null, 2));
}
function load() {
  if (fs.existsSync('data.json')) {
    const d = JSON.parse(fs.readFileSync('data.json'));
    userData = d.userData || {};
    admins = d.admins || admins;
  }
}
load();

// ===== Webhook =====
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.end());
});

// ===== メイン =====
async function handleEvent(event) {

  // ===== 新規参加 =====
  if (event.type === 'memberJoined') {

    for (let m of event.joined.members) {

      if (userData[m.userId]?.permanentBan) {
        try {
          await client.kickoutFromGroup(event.source.groupId, [m.userId]);
        } catch {}
        continue;
      }

      let name = 'ユーザー';
      try {
        const p = await client.getGroupMemberProfile(event.source.groupId, m.userId);
        name = p.displayName;
      } catch {}

      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: `@${name} さん ようこそ！ルール確認してね👍`
      });
    }
    return;
  }

  // ===== ボタン =====
  if (event.type === 'postback') {

    const [action, targetId] = event.postback.data.split(':');
    const groupId = event.source.groupId;

    if (!admins.includes(event.source.userId)) return reply(event, '権限なし');
    if (!userData[targetId]) return reply(event, '不明');

    if (action === 'warn') userData[targetId].warns++;
    if (action === 'ban') {
      userData[targetId].blacklist = true;
      userData[targetId].permanentBan = true;
    }
    if (action === 'unban') {
      userData[targetId].blacklist = false;
      userData[targetId].permanentBan = false;
    }
    if (action === 'kick') {
      await client.kickoutFromGroup(groupId, [targetId]);
    }

    save();
    return reply(event, '操作完了');
  }

  // ===== ユーザー処理 =====
  const userId = event.source.userId;
  const groupId = event.source.groupId;
  const now = Date.now();

  if (!userData[userId]) {
    const profile = await client.getProfile(userId);
    userData[userId] = {
      name: profile.displayName,
      warns: 0,
      reports: 0,
      blacklist: false,
      permanentBan: false,
      lastMsg: '',
      lastTime: 0,
      stampCount: 0,
      lastStampTime: 0
    };
    save();
  }

  const user = userData[userId];

  // ===== 永久BAN =====
  if (user.permanentBan) {
    try {
      await client.kickoutFromGroup(groupId, [userId]);
    } catch {}
    return;
  }

  let warned = false;

  // ===== スタンプ処理 =====
  if (event.message && event.message.type === 'sticker') {

    if (now - user.lastStampTime < 3000) {
      user.stampCount++;
    } else {
      user.stampCount = 1;
    }

    user.lastStampTime = now;

    if (user.stampCount >= 3) {
      user.warns++;
      warned = true;
    }
  }

  // ===== テキスト処理 =====
  if (event.message && event.message.type === 'text') {

    const text = event.message.text;

    if (ngWords.some(w => text.includes(w))) {
      user.warns++;
      warned = true;
    }

    if (!warned && text === user.lastMsg && now - user.lastTime < 3000) {
      user.warns++;
      warned = true;
    }

    user.lastMsg = text;
    user.lastTime = now;

    // ===== 通報 =====
    if (text.startsWith('通報')) {
      const name = text.split(' ')[1];
      const found = Object.entries(userData).find(([id,u]) => u.name === name);

      if (!found) return reply(event, '不明');

      const [, target] = found;
      target.reports++;

      if (target.reports >= 2) target.warns++;

      save();
      return reply(event, '通報受付');
    }

    // ===== 管理UI =====
    if (text === '/管理') {

      if (!admins.includes(userId)) return reply(event, '権限なし');

      const bubbles = Object.entries(userData).map(([id,u]) => ({
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: u.name },
            { type: 'text', text: `警告:${u.warns}` },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                btn('警告', `warn:${id}`),
                btn('BAN', `ban:${id}`),
                btn('解除', `unban:${id}`),
                btn('キック', `kick:${id}`)
              ]
            }
          ]
        }
      }));

      return client.replyMessage(event.replyToken, {
        type: 'flex',
        altText: '管理',
        contents: {
          type: 'carousel',
          contents: bubbles
        }
      });
    }
  }

  // ===== 警告表示 =====
  if (warned) {
    save();
    return reply(event, `⚠️ ${user.name} 警告(${user.warns})`);
  }

  // ===== 自動キック =====
  if (user.warns >= 5 && user.reports >= 2) {
    user.permanentBan = true;
    save();

    try {
      await client.kickoutFromGroup(groupId, [userId]);
    } catch {}

    return reply(event, '強制退出');
  }
}

// ===== ボタン =====
function btn(label, data) {
  return {
    type: 'button',
    action: {
      type: 'postback',
      label: label,
      data: data
    }
  };
}

// ===== 返信 =====
function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: text
  });
}

app.listen(3000);
