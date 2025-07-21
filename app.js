const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const session = require('express-session');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const ejs = require('ejs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Конфигурация
const config = {
  admins: JSON.parse(fs.readFileSync('./config/admins.json', 'utf-8')),
  servers: JSON.parse(fs.readFileSync('./config/servers.json', 'utf-8')),
  users: JSON.parse(fs.readFileSync('./config/users.json', 'utf-8') || '{}'),
  bannedUsers: JSON.parse(fs.readFileSync('./config/bans.json', 'utf-8') || '{}'),
  invitationCodes: JSON.parse(fs.readFileSync('./config/invites.json', 'utf-8') || '{}'),
  messages: {
    'general': [],
    'ru1': [],
    'ru2': [],
    'en1': [],
    'en2': [],
    'appelations': [],
    'secret': []
  }
};

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Хранилище для загружаемых файлов
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, 'public/images/');
        },
        filename: (req, file, cb) => {
            cb(null, Date.now() + path.extname(file.originalname));
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

app.post('/upload', upload.single('image'), async (req, res) => {
    if (!req.session.user) {
        return res.status(403).json({ success: false, message: 'Not authenticated' });
    }

    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    try {
        // Дополнительное сжатие с помощью sharp
        const outputPath = req.file.path + '.compressed';
        await sharp(req.file.path)
            .resize(1280, 720, { 
                fit: 'inside', 
                withoutEnlargement: true 
            })
            .jpeg({ quality: 80 })
            .toFile(outputPath);

        // Заменяем оригинал сжатой версией
        fs.unlinkSync(req.file.path);
        fs.renameSync(outputPath, req.file.path);

        res.json({ 
            success: true, 
            imageUrl: `/images/${path.basename(req.file.path)}` 
        });
    } catch (err) {
        console.error('Error processing image:', err);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ 
            success: false, 
            message: 'Error processing image' 
        });
    }
});


function handleCommand(ws, message) {
    if (!message.text.startsWith('/')) return false;
    
    const parts = message.text.slice(1).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch(command) {
        case 'ban':
            if (!currentUser.isAdmin) break;
            if (args.length < 2) {
                ws.send(JSON.stringify({ type: 'error', message: 'Usage: /ban username days reason' }));
                return true;
            }
            banUser(ws, {
                username: args[0],
                duration: parseInt(args[1]) || 1,
                reason: args.slice(2).join(' ') || 'No reason provided'
            });
            return true;
            
        case 'kick':
            // Аналогично команде ban
            return true;
            
        case 'clear':
            if (!currentUser.isAdmin) break;
            config.messages[message.chat] = [];
            saveMessages();
            broadcastMessage({
                type: 'system',
                chat: message.chat,
                text: `Chat has been cleared by ${currentUser.username}`,
                timestamp: Date.now()
            });
            return true;
    }
    
    return false;
}









// WebSocket соединения
wss.on('connection', (ws) => {
  let currentUser = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received message:', data.type);

      switch(data.type) {
        case 'auth':
          currentUser = {
            username: data.username,
            isAdmin: config.admins.includes(data.username)
          };
          break;

        case 'message':
          handleMessage(ws, data);
          break;

        case 'get_history':
          sendChatHistory(ws, data.chat);
          break;

        case 'delete_message':
          deleteMessage(ws, data);
          break;

        case 'join_chat':
          handleJoinChat(ws, data.code);
          break;

        case 'generate_invite':
          generateInviteCode(ws, data.maxUses);
          break;

        case 'submit_appeal':
          handleAppeal(ws, data.appeal);
          break;

        case 'ban_user':
          banUser(ws, data);
          break;
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Обработка сообщений
function handleMessage(ws, data) {
  if (handleCommand(ws, data)) return;
  if (!currentUser) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
    return;
  }

  // Проверка бана
  if (config.bannedUsers[currentUser.username] && config.bannedUsers[currentUser.username] > Date.now()) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'You are banned and cannot send messages' 
    }));
    return;
  }

  // Проверка разрешенного чата
  if (!config.messages[data.chat] && data.chat !== 'secret') {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Invalid chat room' 
    }));
    return;
  }

  // Для секретного чата проверяем доступ
  if (data.chat === 'secret' && currentUser.username !== 'Wounsee') {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Access denied to secret chat' 
    }));
    return;
  }

  

  // Создание ID сообщения
  data.id = crypto.randomBytes(16).toString('hex');
  data.username = currentUser.username;
  data.isAdmin = currentUser.isAdmin;
  data.timestamp = Date.now();

  // Сохранение сообщения
  config.messages[data.chat].push(data);
  saveMessages();

  // Рассылка сообщения всем участникам чата
  broadcastMessage(data);
}

function broadcastMessage(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'message',
        ...message
      }));
    }
  });
}

function sendChatHistory(ws, chat) {
  if (config.messages[chat]) {
    ws.send(JSON.stringify({
      type: 'chat_history',
      messages: config.messages[chat]
    }));
  }
}

function deleteMessage(ws, data) {
  const chat = data.chat;
  const messageId = data.messageId;

  if (!config.messages[chat]) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Chat not found' 
    }));
    return;
  }

  const messageIndex = config.messages[chat].findIndex(m => m.id === messageId);
  if (messageIndex === -1) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Message not found' 
    }));
    return;
  }

  const message = config.messages[chat][messageIndex];
  
  // Проверка прав на удаление
  if (currentUser.username !== message.username && !currentUser.isAdmin) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'You are not allowed to delete this message' 
    }));
    return;
  }

  // Удаление сообщения
  config.messages[chat].splice(messageIndex, 1);
  saveMessages();

  // Уведомление всех клиентов
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'delete_message',
        chat: chat,
        messageId: messageId
      }));
    }
  });
}

function handleJoinChat(ws, code) {
  if (!currentUser) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Not authenticated' 
    }));
    return;
  }

  const invite = config.invitationCodes[code];
  if (!invite) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Invalid invitation code' 
    }));
    return;
  }

  if (invite.used >= invite.maxUses) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Invitation code has expired' 
    }));
    return;
  }

  // Увеличиваем счетчик использований
  invite.used++;
  config.invitationCodes[code] = invite;
  saveInvites();

  // Добавляем пользователя в чат (в данном случае просто отправляем уведомление)
  ws.send(JSON.stringify({ 
    type: 'notification', 
    message: `You have joined the chat with code ${code}` 
  }));
}

function generateInviteCode(ws, maxUses) {
  if (!currentUser || currentUser.username !== 'Wounsee') {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Only Wounsee can generate invite codes' 
    }));
    return;
  }

  const code = crypto.randomBytes(8).toString('hex');
  config.invitationCodes[code] = {
    maxUses: parseInt(maxUses) || 1,
    used: 0,
    createdBy: currentUser.username,
    createdAt: Date.now()
  };

  saveInvites();

  ws.send(JSON.stringify({ 
    type: 'invite_code', 
    code: code 
  }));
}

function handleAppeal(ws, appealText) {
  if (!currentUser) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Not authenticated' 
    }));
    return;
  }

  // Отправляем апелляцию в чат Appelations
  const appealMessage = {
    id: crypto.randomBytes(16).toString('hex'),
    type: 'message',
    chat: 'appelations',
    text: `APPEAL from ${currentUser.username}: ${appealText}`,
    username: 'System',
    isAdmin: true,
    timestamp: Date.now()
  };

  config.messages['appelations'].push(appealMessage);
  saveMessages();

  broadcastMessage(appealMessage);

  ws.send(JSON.stringify({ 
    type: 'notification', 
    message: 'Your appeal has been submitted' 
  }));
}

function banUser(ws, data) {
  if (!currentUser || !currentUser.isAdmin) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'You are not allowed to ban users' 
    }));
    return;
  }

  const { username, duration, reason } = data;
  
  if (!config.users[username]) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'User not found' 
    }));
    return;
  }

  if (username === 'Wounsee') {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Cannot ban Wounsee' 
    }));
    return;
  }

  const banDuration = parseInt(duration) || 1;
  const banExpires = Date.now() + banDuration * 24 * 60 * 60 * 1000;

  config.bannedUsers[username] = banExpires;
  saveBans();

  // Уведомляем забаненного пользователя
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.currentUser && client.currentUser.username === username) {
      client.send(JSON.stringify({
        type: 'user_banned',
        moderator: currentUser.username,
        duration: banDuration,
        reason: reason
      }));
    }
  });

  ws.send(JSON.stringify({ 
    type: 'notification', 
    message: `User ${username} has been banned for ${banDuration} days` 
  }));
}
function loadMessages() {
    try {
        const data = fs.readFileSync('./data/messages.json', 'utf-8');
        config.messages = JSON.parse(data);
    } catch (err) {
        console.log('No saved messages, starting fresh');
    }
}
// Сохранение данных
function saveMessages() {
  fs.writeFileSync('./data/messages.json', JSON.stringify(config.messages, null, 2));
}

function saveUsers() {
  fs.writeFileSync('./config/users.json', JSON.stringify(config.users, null, 2));
}

function saveBans() {
  fs.writeFileSync('./config/bans.json', JSON.stringify(config.bannedUsers, null, 2));
}

function saveInvites() {
  fs.writeFileSync('./config/invites.json', JSON.stringify(config.invitationCodes, null, 2));
}

// Роуты
app.get('/', (req, res) => {
  if (req.session.user) {
    res.render('chat', { 
      username: req.session.user.username,
      isAdmin: config.admins.includes(req.session.user.username)
    });
  } else {
    res.redirect('/login');
  }
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!config.users[username] || config.users[username].password !== password) {
    res.render('login', { error: 'Invalid username or password' });
    return;
  }

  // Проверка бана
  if (config.bannedUsers[username] && config.bannedUsers[username] > Date.now()) {
    const banDays = Math.ceil((config.bannedUsers[username] - Date.now()) / (24 * 60 * 60 * 1000));
    res.render('banned', { 
      username: username,
      days: banDays,
      moderator: 'Admin',
      reason: 'Violation of rules'
    });
    return;
  }

  req.session.user = { username };
  res.redirect('/');
});

app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

app.post('/register', (req, res) => {
  const { username, password } = req.body;

  if (username === 'Wounsee') {
    res.render('register', { error: 'This username is reserved' });
    return;
  }

  if (config.users[username]) {
    res.render('register', { error: 'Username already taken' });
    return;
  }

  if (username.length < 3 || username.length > 20) {
    res.render('register', { error: 'Username must be 3-20 characters long' });
    return;
  }

  if (password.length < 6) {
    res.render('register', { error: 'Password must be at least 6 characters long' });
    return;
  }

  config.users[username] = { password };
  saveUsers();

  req.session.user = { username };
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.session.user) {
    return res.status(403).json({ success: false, message: 'Not authenticated' });
  }

  try {
    // Сжатие изображения до 720p
    await sharp(req.file.path)
      .resize(1280, 720, { fit: 'inside', withoutEnlargement: true })
      .toFormat('jpeg', { quality: 80 })
      .toFile(req.file.path + '.compressed');

    // Заменяем оригинал сжатой версией
    fs.unlinkSync(req.file.path);
    fs.renameSync(req.file.path + '.compressed', req.file.path);

    res.json({ 
      success: true, 
      imageUrl: `/images/${path.basename(req.file.path)}` 
    });
  } catch (err) {
    console.error('Error processing image:', err);
    res.status(500).json({ success: false, message: 'Error processing image' });
  }
});

// Запуск сервера
server.listen(3000, () => {
  console.log('Server started on http://localhost:3000');
});