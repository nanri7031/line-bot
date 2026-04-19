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

// ===== 名前検索 =====
function findUser(name) {
  return Object.entries(userData).find(([id, u]) => u.name === name);
}

// ===== Webhook =====
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.end());
});

async function handleEvent(event) {

  // ===== 新規参加 =====
  if (event.type === 'memberJoined') {
    for (let m of event.joined.members) {

      if (userData[m.userId]?.permanentBan) {
        await client.kickoutFromGroup(event.source.groupId, [m.userId]);
        continue;
      }

      let name = 'ユーザー';
      try {
        const p = await client.getGroupMemberProfile(event.source.groupId, m.userId);
        name = p.displayName;
      } catch {}

      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: `@${name} さん ようこそ！`
      });
    }
    return;
  }

  // ===== ボタン =====
  if (event.type === 'postback') {

    const [action, targetId] = event.postback.data.split(':');
    const groupId = event.source.groupId;

    if (!admins.includes(event.source.userId)) return reply(event, '権限なし');

    if (action === 'warn') userData[targetId].warns++;
    if (action === 'ban') {
      userData[targetId].permanentBan = true;
    }
    if (action === 'unban') {
      userData[targetId].permanentBan = false;
    }
    if (action === 'kick') {
      await client.kickoutFromGroup(groupId, [targetId]);
    }

    save();
    return reply(event, '操作完了');
  }

  // ===== メッセージ =====
  if (event.type !== 'message') return;

  const userId = event.source.userId;
  const groupId = event.source.groupId;
  const now = Date.now();

  // 初期化
  if (!userData[userId]) {
    const p = await client.getProfile(userId);
    userData[userId] = {
      name: p.displayName,
      warns: 0,
      reports: 0,
      permanentBan: false,
      lastMsg: '',
      lastTime: 0,
      stampCount: 0,
      lastStamp: 0
    };
    save();
  }

  const user = userData[userId];

  // ===== 永久BAN =====
  if (user.permanentBan) {
    await client.kickoutFromGroup(groupId, [userId]);
    return;
  }

  let warned = false;

  // ===== スタンプ =====
  if (event.message.type === 'sticker') {
    if (now - user.lastStamp < 3000) user.stampCount++;
    else user.stampCount = 1;

    user.lastStamp = now;

    if (user.stampCount >= 3) {
      user.warns++;
      warned = true;
    }
  }

  // ===== テキスト =====
  if (event.message.type === 'text') {

    const text = event.message.text;

    // ===== 管理者コマンド =====
    if (text.startsWith('/')) {

      if (!admins.includes(userId)) return reply(event, '権限なし');

      const parts = text.split(' ');
      const cmd = parts[0];
      const name = parts[1];

      // 管理者一覧
      if (cmd === '/管理者一覧') {
        const list = admins.map(id => userData[id]?.name || id).join('\n');
        return reply(event, list);
      }

      const found = findUser(name);
      if (!found) return reply(event, 'ユーザー不明');

      const [targetId, target] = found;

      if (cmd === '/管理者追加') {
        admins.push(targetId);
        save();
        return reply(event, `${target.name} を管理者に追加`);
      }

      if (cmd === '/管理者削除') {
        admins = admins.filter(id => id !== targetId);
        save();
        return reply(event, `${target.name} を削除`);
      }

      if (cmd === '/キック') {
        await client.kickoutFromGroup(groupId, [targetId]);
        return reply(event, 'キック完了');
      }
    }

    // NG
    if (ngWords.some(w => text.includes(w))) {
      user.warns++;
      warned = true;
    }

    // 連投
    if (!warned && text === user.lastMsg && now - user.lastTime < 3000) {
      user.warns++;
      warned = true;
    }

    user.lastMsg = text;
    user.lastTime = now;

    // 通報
    if (text.startsWith('通報')) {
      const name = text.split(' ')[1];
      const found = findUser(name);
      if (!found) return reply(event, '不明');

      const [, target] = found;
      target.reports++;
      if (target.reports >= 2) target.warns++;

      save();
      return reply(event, '通報受付');
    }

    // 管理画面
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

  // 警告表示
  if (warned) {
    save();
    return reply(event, `⚠️ ${user.name} 警告(${user.warns})`);
  }

  // 自動BAN
  if (user.warns >= 5 && user.reports >= 2) {
    user.permanentBan = true;
    save();
    await client.kickoutFromGroup(groupId, [userId]);
    return;
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
