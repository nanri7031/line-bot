const express = require('express');
const line = require('@line/bot-sdk');
const fs = require('fs');

const config = {
  channelAccessToken: process.env.ACCESS_TOKEN,
  channelSecret: process.env.SECRET
};

const app = express();
const client = new line.Client(config);

// ===== 本管理（BOTも含める）=====
let adminData = {
  owner: [
    'Ud9ae0b76918ab20e33fb8b25c78a5f95',
    'BOT_USER_ID'
  ],
  sub: []
};

const ngWords = ['死ね','バカ','消えろ','アホ'];
let userData = {};

// ===== 保存 =====
function save(){
  fs.writeFileSync('data.json', JSON.stringify({userData,adminData},null,2));
}
function load(){
  if(fs.existsSync('data.json')){
    const d = JSON.parse(fs.readFileSync('data.json'));
    userData = d.userData || {};
    adminData = d.adminData || adminData;
  }
}
load();

// ===== 権限 =====
const isOwner = id => adminData.owner.includes(id);
const isAdmin = id => isOwner(id) || adminData.sub.includes(id);

// ===== 名前検索 =====
function findUser(name){
  return Object.entries(userData).find(([id,u])=>u.name===name);
}

// ===== Webhook =====
app.post('/webhook', line.middleware(config),(req,res)=>{
  Promise.all(req.body.events.map(handleEvent)).then(()=>res.end());
});

// ===== メイン =====
async function handleEvent(event){

  // ===== 新規参加 =====
  if(event.type==='memberJoined'){
    for(let m of event.joined.members){

      if(userData[m.userId]?.permanentBan){
        await client.kickoutFromGroup(event.source.groupId,[m.userId]);
        continue;
      }

      let name='ユーザー';
      try{
        const p=await client.getGroupMemberProfile(event.source.groupId,m.userId);
        name=p.displayName;
      }catch{}

      await client.replyMessage(event.replyToken,{
        type:'text',
        text:
`@${name} さん

ようこそ！
グルに参加ありがとうございます。

さて、グルに参加したら、まずルールを確認してね。
だいたいのグルは、ノートにルールが書いてあります。
ルールはノートの下の方に書いてあることが多いけど、たまに真ん中や上の方にも書いてあることがあります。出来るだけ全部目を通しましょう。確認しましたらイイね押して下さいねっ！

お時間あるメンバー様は挨拶お願い致します。`
      });
    }
    return;
  }

  // ===== ボタン操作 =====
  if(event.type==='postback'){
    const [action,id]=event.postback.data.split(':');
    const groupId=event.source.groupId;

    if(!isAdmin(event.source.userId)) return reply(event,'権限なし');

    if(action==='warn') userData[id].warns++;
    if(action==='ban') userData[id].permanentBan=true;
    if(action==='unban') userData[id].permanentBan=false;
    if(action==='kick') await client.kickoutFromGroup(groupId,[id]);

    save();
    return reply(event,'操作完了');
  }

  if(event.type!=='message') return;

  const userId=event.source.userId;
  const groupId=event.source.groupId;
  const now=Date.now();

  // ===== 初期登録 =====
  if(!userData[userId]){
    const p=await client.getProfile(userId);
    userData[userId]={
      name:p.displayName,
      warns:0,
      reports:0,
      permanentBan:false,
      lastMsg:'',
      lastTime:0,
      stampCount:0,
      lastStamp:0
    };
    save();
  }

  const user=userData[userId];

  // ===== 永久BAN =====
  if(user.permanentBan){
    await client.kickoutFromGroup(groupId,[userId]);
    return;
  }

  let warned=false;

  // ===== スタンプ =====
  if(event.message.type==='sticker'){
    if(now-user.lastStamp<3000) user.stampCount++;
    else user.stampCount=1;

    user.lastStamp=now;

    if(user.stampCount>=3){
      user.warns++;
      warned=true;
    }
  }

  // ===== テキスト =====
  if(event.message.type==='text'){
    const text=event.message.text;

    // ===== 管理コマンド =====
    if(text.startsWith('/')){

      if(!isAdmin(userId)) return reply(event,'権限なし');

      const parts=text.split(' ');
      const cmd=parts[0];
      const name=parts[1];

      if(cmd==='/管理者一覧'){
        return reply(event,
`本管理
${adminData.owner.map(id=>userData[id]?.name||id).join('\n')}

副管理
${adminData.sub.map(id=>userData[id]?.name||id).join('\n')}`
        );
      }

      const found=findUser(name);
      if(!found) return reply(event,'ユーザー不明');

      const [targetId,target]=found;

      if(cmd==='/本管理追加'){
        if(!isOwner(userId)) return reply(event,'本管理のみ');
        adminData.owner.push(targetId);
        save();
        return reply(event,'追加完了');
      }

      if(cmd==='/副管理追加'){
        if(!isOwner(userId)) return reply(event,'本管理のみ');
        adminData.sub.push(targetId);
        save();
        return reply(event,'追加完了');
      }

      if(cmd==='/管理者削除'){
        if(!isOwner(userId)) return reply(event,'本管理のみ');
        adminData.owner=adminData.owner.filter(id=>id!==targetId);
        adminData.sub=adminData.sub.filter(id=>id!==targetId);
        save();
        return reply(event,'削除完了');
      }

      if(cmd==='/キック'){
        await client.kickoutFromGroup(groupId,[targetId]);
        return reply(event,'キック完了');
      }
    }

    // NGワード
    if(ngWords.some(w=>text.includes(w))){
      user.warns++;
      warned=true;
    }

    // 連投
    if(!warned && text===user.lastMsg && now-user.lastTime<3000){
      user.warns++;
      warned=true;
    }

    user.lastMsg=text;
    user.lastTime=now;

    // 通報
    if(text.startsWith('通報')){
      const name=text.split(' ')[1];
      const found=findUser(name);
      if(!found) return reply(event,'不明');

      const [,t]=found;
      t.reports++;
      if(t.reports>=2) t.warns++;

      save();
      return reply(event,'通報受付');
    }

    // 管理UI
    if(text==='/管理'){
      if(!isAdmin(userId)) return reply(event,'権限なし');

      const bubbles=Object.entries(userData).map(([id,u])=>({
        type:'bubble',
        body:{
          type:'box',
          layout:'vertical',
          contents:[
            {type:'text',text:u.name},
            {type:'text',text:`警告:${u.warns}`},
            {
              type:'box',
              layout:'horizontal',
              contents:[
                btn('警告',`warn:${id}`),
                btn('BAN',`ban:${id}`),
                btn('解除',`unban:${id}`),
                btn('キック',`kick:${id}`)
              ]
            }
          ]
        }
      }));

      return client.replyMessage(event.replyToken,{
        type:'flex',
        altText:'管理',
        contents:{type:'carousel',contents:bubbles}
      });
    }
  }

  if(warned){
    save();
    return reply(event,`⚠️ ${user.name} 警告(${user.warns})`);
  }

  // ===== 自動キック =====
  if(user.warns>=5 && user.reports>=2){
    user.permanentBan=true;
    save();
    await client.kickoutFromGroup(groupId,[userId]);
  }
}

// ===== ボタン =====
function btn(label,data){
  return {type:'button',action:{type:'postback',label,data}};
}

// ===== 返信 =====
function reply(event,text){
  return client.replyMessage(event.replyToken,{type:'text',text});
}

app.listen(3000);
