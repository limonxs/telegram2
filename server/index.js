const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const ERROR_LOG_FILE = path.join(__dirname, 'server_error.log');
function logServerError(message, err = '') {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${message} ${err}\n`;
  console.error(logMsg.trim());
  fs.appendFile(ERROR_LOG_FILE, logMsg, (appendErr) => {
    if (appendErr) console.error('Failed to write to server error log:', appendErr);
  });
}

process.on('uncaughtException', (err) => {
  logServerError('Uncaught Exception:', err.stack || err);
});
process.on('unhandledRejection', (reason, promise) => {
  logServerError('Unhandled Rejection:', reason);
});

const BUG_REPORTS_DIR = path.join(__dirname, 'bug_reports');
if (!fs.existsSync(BUG_REPORTS_DIR)) {
  fs.mkdirSync(BUG_REPORTS_DIR);
}

app.post('/api/bug-report', (req, res) => {
  const report = req.body.report;
  if (!report) return res.status(400).json({ error: 'No report provided' });
  const filename = `report_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.json`;
  fs.writeFile(path.join(BUG_REPORTS_DIR, filename), typeof report === 'string' ? report : JSON.stringify(report, null, 2), (err) => {
    if (err) {
      logServerError('Failed to save bug report:', err);
      return res.status(500).json({ success: false, error: 'Failed to save' });
    }
    res.json({ success: true });
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), users: users.size });
});

app.use(express.static(path.join(__dirname, '../client/dist')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e8,
  pingTimeout: 30000,
  pingInterval: 10000,
  connectTimeout: 45000
});

// ═══════════════════════════════════════════════════════════════════════
// Rate Limiter — sliding window per socket
// ═══════════════════════════════════════════════════════════════════════
const rateLimits = new Map();

function checkRateLimit(socketId, type) {
  const now = Date.now();
  const windowMs = 1000;
  const limits = { message: 5, signal: 30 };

  if (!rateLimits.has(socketId)) {
    rateLimits.set(socketId, { messages: [], signals: [] });
  }

  const entry = rateLimits.get(socketId);
  const arr = type === 'message' ? entry.messages : entry.signals;

  while (arr.length > 0 && arr[0] < now - windowMs) arr.shift();

  if (arr.length >= limits[type]) return false;
  arr.push(now);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════
// Debounced async file save — replaces blocking writeFileSync
// ═══════════════════════════════════════════════════════════════════════
const CHATS_FILE = path.join(__dirname, 'chats_store.json');
let saveTimeout = null;
let savePending = false;

function scheduleSave() {
  savePending = true;
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    if (!savePending) return;
    savePending = false;
    const data = Array.from(chats.values());
    fs.writeFile(CHATS_FILE, JSON.stringify(data, null, 2), 'utf8', (err) => {
      if (err) console.error('Failed to save chats to disk:', err);
    });
  }, 1000);
}

const WALL_FILE = path.join(__dirname, 'wall_store.json');
let wallPosts = [];
let wallSaveTimeout = null;
let wallSavePending = false;

function scheduleWallSave() {
  wallSavePending = true;
  if (wallSaveTimeout) return;
  wallSaveTimeout = setTimeout(() => {
    wallSaveTimeout = null;
    if (!wallSavePending) return;
    wallSavePending = false;
    fs.writeFile(WALL_FILE, JSON.stringify(wallPosts, null, 2), 'utf8', (err) => {
      if (err) console.error('Failed to save wall posts to disk:', err);
    });
  }, 1000);
}

const FEED_FILE = path.join(__dirname, 'feed_store.json');
let feedPosts = [];
let feedSaveTimeout = null;
let feedSavePending = false;

function scheduleFeedSave() {
  feedSavePending = true;
  if (feedSaveTimeout) return;
  feedSaveTimeout = setTimeout(() => {
    feedSaveTimeout = null;
    if (!feedSavePending) return;
    feedSavePending = false;
    fs.writeFile(FEED_FILE, JSON.stringify(feedPosts, null, 2), 'utf8', (err) => {
      if (err) console.error('Failed to save feed posts to disk:', err);
    });
  }, 1000);
}

const USERS_FILE = path.join(__dirname, 'users_store.json');
let usersProfile = {}; // username -> { aboutText, audioUrl }
let usersSaveTimeout = null;
let usersSavePending = false;

function scheduleUsersSave() {
  usersSavePending = true;
  if (usersSaveTimeout) return;
  usersSaveTimeout = setTimeout(() => {
    usersSaveTimeout = null;
    if (!usersSavePending) return;
    usersSavePending = false;
    fs.writeFile(USERS_FILE, JSON.stringify(usersProfile, null, 2), 'utf8', (err) => {
      if (err) console.error('Failed to save users profile to disk:', err);
    });
  }, 1000);
}

// ═══════════════════════════════════════════════════════════════════════
// In-memory data stores
// ═══════════════════════════════════════════════════════════════════════
const users = new Map();
const chats = new Map();
const voiceUsers = new Map();
const roomActivities = new Map();

// Load chats from file
try {
  if (fs.existsSync(CHATS_FILE)) {
    const data = JSON.parse(fs.readFileSync(CHATS_FILE, 'utf8'));
    for (const chat of data) {
      chats.set(chat.id, chat);
    }
    console.log(`Loaded ${chats.size} chats from persistence store.`);
  }
} catch (e) {
  console.error('Failed to load chats from disk:', e);
}

// Load wall posts from file
try {
  if (fs.existsSync(WALL_FILE)) {
    wallPosts = JSON.parse(fs.readFileSync(WALL_FILE, 'utf8'));
    // Normalize old posts: migrate 'content' field to 'text'/'mediaUrl'
    wallPosts = wallPosts.map(post => {
      if (post.content !== undefined && post.text === undefined) {
        const normalized = { ...post };
        if (post.mediaType === 'text' || post.mediaType === null || post.mediaType === undefined) {
          normalized.text = post.content || '';
          normalized.mediaType = null;
          normalized.mediaUrl = null;
        } else {
          normalized.text = '';
          normalized.mediaType = post.mediaType;
          normalized.mediaUrl = post.content;
        }
        delete normalized.content;
        return normalized;
      }
      return post;
    });
    scheduleWallSave();
    console.log(`Loaded ${wallPosts.length} wall posts from persistence store.`);
  }
} catch (e) {
  console.error('Failed to load wall posts from disk:', e);
}

// Load users profile from file
try {
  if (fs.existsSync(USERS_FILE)) {
    usersProfile = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    console.log(`Loaded ${Object.keys(usersProfile).length} user profiles from persistence store.`);
  }
} catch (e) {
  console.error('Failed to load users profile from disk:', e);
}

// Load feed posts from file
try {
  if (fs.existsSync(FEED_FILE)) {
    feedPosts = JSON.parse(fs.readFileSync(FEED_FILE, 'utf8'));
    console.log(`Loaded ${feedPosts.length} feed posts from persistence store.`);
  }
} catch (e) {
  console.error('Failed to load feed posts from disk:', e);
}

if (!chats.has('global')) {
  chats.set('global', {
    id: 'global',
    name: 'General Chat',
    type: 'group',
    messages: []
  });
  scheduleSave();
}

// ═══════════════════════════════════════════════════════════════════════
// Collision-free message ID generator
// ═══════════════════════════════════════════════════════════════════════
let messageCounter = 0;
function generateMessageId() {
  return `${Date.now()}-${++messageCounter}-${crypto.randomBytes(4).toString('hex')}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Input validation helpers
// ═══════════════════════════════════════════════════════════════════════
const MAX_TEXT_LENGTH = 10000;
const MAX_FILE_URL_LENGTH = 20000000;
const MAX_GROUP_NAME = 100;
const MAX_USERNAME = 50;

function isValidUsername(name) {
  return typeof name === 'string' && name.trim().length > 0 && name.length <= MAX_USERNAME;
}

function isValidChatId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 200;
}

// ═══════════════════════════════════════════════════════════════════════
// Server-side game validation — chess
// ═══════════════════════════════════════════════════════════════════════
function isValidChessMove(fromR, fromC, toR, toC, piece, board) {
  if (!piece) return false;
  if (fromR === toR && fromC === toC) return false;
  if (toR < 0 || toR > 7 || toC < 0 || toC > 7) return false;

  const targetPiece = board[toR][toC];
  if (targetPiece) {
    const isOwnPiece = (piece === piece.toUpperCase()) === (targetPiece === targetPiece.toUpperCase());
    if (isOwnPiece) return false;
  }

  const rowDiff = toR - fromR;
  const colDiff = toC - fromC;
  const pType = piece.toLowerCase();

  switch (pType) {
    case 'p': {
      const isWhite = piece === 'P';
      const direction = isWhite ? -1 : 1;
      const startRow = isWhite ? 6 : 1;
      if (colDiff === 0 && rowDiff === direction && !targetPiece) return true;
      if (colDiff === 0 && fromR === startRow && rowDiff === 2 * direction && !board[fromR + direction][fromC] && !targetPiece) return true;
      if (Math.abs(colDiff) === 1 && rowDiff === direction && targetPiece) return true;
      return false;
    }
    case 'r': {
      if (rowDiff !== 0 && colDiff !== 0) return false;
      const rStep = rowDiff === 0 ? 0 : (rowDiff > 0 ? 1 : -1);
      const cStep = colDiff === 0 ? 0 : (colDiff > 0 ? 1 : -1);
      const steps = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      for (let i = 1; i < steps; i++) {
        if (board[fromR + i * rStep][fromC + i * cStep] !== null) return false;
      }
      return true;
    }
    case 'b': {
      if (Math.abs(rowDiff) !== Math.abs(colDiff)) return false;
      const rStep = rowDiff > 0 ? 1 : -1;
      const cStep = colDiff > 0 ? 1 : -1;
      for (let i = 1; i < Math.abs(rowDiff); i++) {
        if (board[fromR + i * rStep][fromC + i * cStep] !== null) return false;
      }
      return true;
    }
    case 'q': {
      if (rowDiff !== 0 && colDiff !== 0 && Math.abs(rowDiff) !== Math.abs(colDiff)) return false;
      const rStep = rowDiff === 0 ? 0 : (rowDiff > 0 ? 1 : -1);
      const cStep = colDiff === 0 ? 0 : (colDiff > 0 ? 1 : -1);
      const steps = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
      for (let i = 1; i < steps; i++) {
        if (board[fromR + i * rStep][fromC + i * cStep] !== null) return false;
      }
      return true;
    }
    case 'n': {
      return (Math.abs(rowDiff) === 2 && Math.abs(colDiff) === 1) || (Math.abs(rowDiff) === 1 && Math.abs(colDiff) === 2);
    }
    case 'k': {
      return Math.abs(rowDiff) <= 1 && Math.abs(colDiff) <= 1;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
// Server-side game validation — checkers
// ═══════════════════════════════════════════════════════════════════════
function isValidCheckersMove(fromR, fromC, toR, toC, piece, board) {
  if (!piece) return false;
  if (fromR === toR && fromC === toC) return false;
  if (toR < 0 || toR > 7 || toC < 0 || toC > 7) return false;
  if (board[toR][toC] !== null) return false;
  if ((toR + toC) % 2 !== 1) return false;

  const rowDiff = toR - fromR;
  const colDiff = toC - fromC;
  const isKing = piece === 'W' || piece === 'B';
  const isWhite = piece.toLowerCase() === 'w';

  if (!isKing) {
    const isRegularMove = (isWhite ? rowDiff === -1 : rowDiff === 1) && Math.abs(colDiff) === 1;
    if (isRegularMove) return true;

    if (Math.abs(rowDiff) === 2 && Math.abs(colDiff) === 2) {
      const midR = (fromR + toR) / 2;
      const midC = (fromC + toC) / 2;
      const midPiece = board[midR][midC];
      if (midPiece) {
        const isMidWhite = midPiece.toLowerCase() === 'w';
        return isWhite !== isMidWhite;
      }
    }
  } else {
    if (Math.abs(rowDiff) === Math.abs(colDiff)) {
      const rStep = rowDiff > 0 ? 1 : -1;
      const cStep = colDiff > 0 ? 1 : -1;
      let piecesInPath = 0;
      let lastMidPiece = null;
      const isWhiteKing = piece === 'W';

      for (let i = 1; i < Math.abs(rowDiff); i++) {
        const r = fromR + i * rStep;
        const c = fromC + i * cStep;
        const cell = board[r][c];
        if (cell !== null) {
          piecesInPath++;
          lastMidPiece = cell;
        }
      }

      if (piecesInPath === 0) return true;
      if (piecesInPath === 1) {
        const isOpponent = isWhiteKing ? lastMidPiece.toLowerCase() === 'b' : lastMidPiece.toLowerCase() === 'w';
        return isOpponent;
      }
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
// Helper: emit event only to specific users by username
// ═══════════════════════════════════════════════════════════════════════
function emitToUsers(event, data, usernames) {
  for (const [sid, u] of users.entries()) {
    if (usernames.includes(u.username)) {
      io.to(sid).emit(event, data);
    }
  }
}

// Helper: broadcast to all users in a specific voice room
function broadcastToRoom(roomId, event, payload) {
  for (const [sid, vuser] of voiceUsers.entries()) {
    if (vuser.roomId === roomId) {
      io.to(sid).emit(event, payload);
    }
  }
}

// Cleanup room activity when all users leave
function cleanupRoomIfNeeded(roomId) {
  const usersInRoom = Array.from(voiceUsers.values()).filter(v => v.roomId === roomId);
  if (usersInRoom.length === 0 && roomActivities.has(roomId)) {
    roomActivities.delete(roomId);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Socket.IO connection handler
// ═══════════════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
  const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  console.log(`User connected: ${socket.id} from ${clientIp}`);

  // ── Login ──────────────────────────────────────────────────────────
  socket.on('login', (data, callback) => {
    let username = '';
    let displayName = '';
    let avatar = null;
    if (data && typeof data === 'object') {
      username = data.username;
      displayName = data.displayName || data.username; // fallback
      avatar = data.avatar;
    } else {
      username = data;
      displayName = data;
    }

    if (!isValidUsername(username)) {
      if (typeof callback === 'function') callback({ success: false, error: 'Invalid username' });
      return;
    }

    // Check if username is already taken by another active socket
    for (const [sid, u] of users.entries()) {
      if (u.username === username && sid !== socket.id) {
        if (typeof callback === 'function') callback({ success: false, error: 'Этот юзернейм уже используется другим пользователем' });
        return;
      }
    }

    // Initialize or update user profile with displayName
    if (!usersProfile[username]) {
      usersProfile[username] = { aboutText: '', audioUrl: null, displayName };
    } else {
      usersProfile[username].displayName = displayName;
    }
    scheduleUsersSave();

    users.set(socket.id, { username, displayName, avatar, socketId: socket.id });
    console.log(`User logged in: ${displayName} (@${username}) (${socket.id})`);

    const MAX_MESSAGES_ON_LOGIN = 50;
    const userChats = Array.from(chats.values())
      .filter(c => {
        if (c.type === 'dm') {
          return c.users && c.users.includes(username);
        }
        return true;
      })
      .map(c => ({
        ...c,
        messages: (c.messages || []).slice(-MAX_MESSAGES_ON_LOGIN).map(m => ({ ...m, hasMedia: !!m.fileUrl, fileUrl: null }))
      }));

    if (typeof callback === 'function') {
      callback({
        success: true,
        chats: userChats,
        onlineUsers: Array.from(users.values()).map(u => ({ username: u.username, displayName: u.displayName, socketId: u.socketId, avatar: u.avatar }))
      });
    }

    socket.broadcast.emit('user_joined', { username, displayName, socketId: socket.id, avatar });
  });

  // ── Avatar Update ──────────────────────────────────────────────────
  socket.on('update_avatar', (avatar) => {
    const user = users.get(socket.id);
    if (!user) return;
    if (typeof avatar !== 'string' || avatar.length > 10000000) return;
    user.avatar = avatar;
    
    if (!usersProfile[user.username]) {
      usersProfile[user.username] = {};
    }
    usersProfile[user.username].avatar = avatar;
    scheduleUsersSave();

    io.emit('user_avatar_updated', { username: user.username, avatar });
  });

  // ── Get or Create DM (privacy fix: only emit to participants) ──────
  socket.on('get_or_create_dm', ({ targetUsername }, callback) => {
    if (typeof callback !== 'function') return;

    const user = users.get(socket.id);
    if (!user) return callback({ error: 'Not logged in' });
    if (!isValidUsername(targetUsername)) return callback({ error: 'Invalid target username' });

    const names = [user.username, targetUsername].sort();
    const chatId = `dm_${names[0]}_${names[1]}`;

    let chat = chats.get(chatId);
    if (!chat) {
      chat = {
        id: chatId,
        name: targetUsername,
        type: 'dm',
        users: names,
        messages: []
      };
      chats.set(chatId, chat);
      scheduleSave();
      // FIX: Only emit to the two participants, not to everyone
      emitToUsers('chat_created', chat, names);
    }

    callback({ chatId });
  });

  // ── Create Group Chat ──────────────────────────────────────────────
  socket.on('create_group', ({ name }, callback) => {
    if (typeof callback !== 'function') return;

    const user = users.get(socket.id);
    if (!user) return callback({ error: 'Not logged in' });
    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > MAX_GROUP_NAME) {
      return callback({ error: 'Invalid group name' });
    }

    const chatId = `group_${Date.now()}`;
    const chat = {
      id: chatId,
      name: name.trim(),
      type: 'group',
      messages: []
    };
    chats.set(chatId, chat);
    scheduleSave();

    io.emit('chat_created', chat);
    callback({ chatId });
  });

  // ── Update Group Chat Details ──────────────────────────────────────
  socket.on('update_group_details', ({ chatId, name, avatar }, callback) => {
    if (typeof callback !== 'function') return;

    const user = users.get(socket.id);
    if (!user) return callback({ error: 'Not logged in' });

    const chat = chats.get(chatId);
    if (!chat) return callback({ error: 'Chat not found' });
    if (chat.type !== 'group') return callback({ error: 'DMs cannot be renamed' });

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0 || name.length > MAX_GROUP_NAME) {
        return callback({ error: 'Invalid name' });
      }
      chat.name = name.trim();
    }

    if (avatar !== undefined) {
      if (avatar !== null && (typeof avatar !== 'string' || avatar.length > 200000)) {
        return callback({ error: 'Invalid avatar' });
      }
      chat.avatar = avatar;
    }

    scheduleSave();
    io.emit('group_details_updated', { chatId, name: chat.name, avatar: chat.avatar });
    callback({ success: true });
  });

  // ── User Profile ────────────────────────────────────────────────────
  socket.on('get_user_profile', ({ username }, callback) => {
    if (typeof callback !== 'function') return;
    if (!isValidUsername(username)) return callback({ error: 'Invalid username' });
    const profile = usersProfile[username] || { aboutText: '', audioUrl: null };
    callback({ success: true, profile });
  });

  socket.on('search_users', ({ query }, callback) => {
    if (typeof callback !== 'function') return;
    if (!query || typeof query !== 'string') return callback([]);
    const q = query.trim().toLowerCase();
    if (!q) return callback([]);

    const userSession = users.get(socket.id);
    const myUsername = userSession ? userSession.username : null;

    const results = [];
    for (const [uname, profile] of Object.entries(usersProfile)) {
      if (myUsername && uname === myUsername) continue;
      
      const dispName = profile.displayName || uname;
      if (uname.toLowerCase().includes(q) || dispName.toLowerCase().includes(q)) {
        results.push({
          username: uname,
          displayName: dispName,
          aboutText: profile.aboutText || '',
          audioUrl: profile.audioUrl || null
        });
      }
    }
    callback(results.slice(0, 20));
  });

  socket.on('update_user_profile', ({ aboutText, audioUrl, newUsername, newDisplayName }, callback) => {
    if (typeof callback !== 'function') return;
    const user = users.get(socket.id);
    if (!user) return callback({ error: 'Not logged in' });
    
    if (aboutText && aboutText.length > 2000) return callback({ error: 'About text too long' });
    if (audioUrl && audioUrl.length > 15000000) return callback({ error: 'Audio file too large (max 10MB)' });

    // Validate new credentials if supplied
    if (newUsername !== undefined && newUsername !== user.username) {
      if (!isValidUsername(newUsername)) {
        return callback({ error: 'Некорректный юзернейм' });
      }
      // Check collision
      for (const [sid, u] of users.entries()) {
        if (u.username === newUsername && sid !== socket.id) {
          return callback({ error: 'Этот юзернейм уже занят другим пользователем' });
        }
      }
    }

    const oldUsername = user.username;
    
    // Migrate profile maps
    if (newUsername && newUsername !== oldUsername) {
      usersProfile[newUsername] = {
        ...usersProfile[oldUsername],
        aboutText: aboutText !== undefined ? aboutText : (usersProfile[oldUsername]?.aboutText || ''),
        audioUrl: audioUrl !== undefined ? audioUrl : (usersProfile[oldUsername]?.audioUrl || null),
        displayName: newDisplayName || usersProfile[oldUsername]?.displayName || newUsername
      };
      delete usersProfile[oldUsername];
      
      // Update session username
      user.username = newUsername;

      // Migrate chats and DM chat IDs
      for (const [chatId, chat] of chats.entries()) {
        if (chat.type === 'dm' && chat.users && chat.users.includes(oldUsername)) {
          chat.users = chat.users.map(u => u === oldUsername ? newUsername : u);
          const newNames = [...chat.users].sort();
          const newChatId = `dm_${newNames[0]}_${newNames[1]}`;
          if (chatId !== newChatId) {
            chats.delete(chatId);
            chat.id = newChatId;
            chats.set(newChatId, chat);
          }
        }
        if (chat.messages) {
          chat.messages.forEach(msg => {
            if (msg.sender === oldUsername) {
              msg.sender = newUsername;
            }
          });
        }
      }
      scheduleSave();
    } else {
      // Just update current profile fields
      usersProfile[oldUsername] = {
        ...usersProfile[oldUsername],
        aboutText: aboutText !== undefined ? aboutText : (usersProfile[oldUsername]?.aboutText || ''),
        audioUrl: audioUrl !== undefined ? audioUrl : (usersProfile[oldUsername]?.audioUrl || null),
        displayName: newDisplayName || usersProfile[oldUsername]?.displayName || oldUsername
      };
    }

    if (newDisplayName) {
      user.displayName = newDisplayName;
      if (usersProfile[user.username]) {
        usersProfile[user.username].displayName = newDisplayName;
      }
    }

    scheduleUsersSave();
    
    // Broadcast updates
    if (newUsername && newUsername !== oldUsername) {
      io.emit('user_details_updated', {
        oldUsername,
        newUsername,
        displayName: user.displayName,
        socketId: socket.id
      });
    } else {
      io.emit('user_profile_updated', { username: user.username, profile: usersProfile[user.username] });
      io.emit('user_details_updated', {
        oldUsername: user.username,
        newUsername: user.username,
        displayName: user.displayName,
        socketId: socket.id
      });
    }

    callback({ success: true });
  });

  // ── Profile Wall Posts ──────────────────────────────────────────────
  socket.on('get_wall_posts', ({ targetUsername }, callback) => {
    console.log(`[ProfileWall] get_wall_posts requested for: ${targetUsername}`);
    if (typeof callback !== 'function') return;
    if (!isValidUsername(targetUsername)) return callback({ error: 'Invalid username' });
    const posts = wallPosts.filter(p => p.targetUser === targetUsername);
    posts.sort((a, b) => b.timestamp - a.timestamp);
    callback({ success: true, posts: posts.map(p => ({ ...p, hasMedia: !!p.mediaUrl, mediaUrl: null })) });
  });

  socket.on('create_wall_post', ({ targetUsername, text, mediaType, mediaUrl }, callback) => {
    const user = users.get(socket.id);
    const authorName = user ? user.username : 'Unknown';
    
    if (typeof callback !== 'function') return;
    if (!user) return callback({ error: 'Not logged in' });
    if (!isValidUsername(targetUsername)) return callback({ error: 'Invalid target username' });

    if ((!text || text.trim().length === 0) && !mediaUrl) {
      return callback({ error: 'Post content cannot be empty' });
    }

    if (text && text.length > 5000) {
      return callback({ error: 'Post content is too long' });
    }
    
    if (mediaType && !['image', 'video', 'gif', 'graffiti'].includes(mediaType)) {
      return callback({ error: 'Invalid media type' });
    }

    const post = {
      id: `post_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      author: user.username,
      targetUser: targetUsername,
      text: text ? text.trim() : '',
      mediaType: mediaType || null,
      mediaUrl: mediaUrl || null,
      timestamp: Date.now()
    };

    wallPosts.push(post);
    scheduleWallSave();

    io.emit('wall_post_created', { ...post, hasMedia: !!post.mediaUrl, mediaUrl: null });
    callback({ success: true, post });
  });

  // ── Global Feed ────────────────────────────────────────────────────
  socket.on('get_feed_posts', (callback) => {
    if (typeof callback !== 'function') return;
    const posts = [...feedPosts];
    posts.sort((a, b) => b.timestamp - a.timestamp);
    callback({ success: true, posts: posts.map(p => ({ ...p, hasMedia: !!p.mediaUrl, mediaUrl: null })) });
  });

  socket.on('create_feed_post', ({ text, mediaType, mediaUrl }, callback) => {
    const user = users.get(socket.id);
    if (typeof callback !== 'function') return;
    if (!user) return callback({ error: 'Not logged in' });

    if ((!text || text.trim().length === 0) && !mediaUrl) {
      return callback({ error: 'Post content cannot be empty' });
    }

    if (text && text.length > 5000) {
      return callback({ error: 'Post content is too long' });
    }

    const post = {
      id: `feed_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      author: user.username,
      text: text ? text.trim() : '',
      mediaType: mediaType || null,
      mediaUrl: mediaUrl || null,
      timestamp: Date.now(),
      likes: [], // Array of usernames
      comments: [] // Array of { id, author, text, timestamp }
    };

    feedPosts.push(post);
    scheduleFeedSave();

    io.emit('feed_post_created', { ...post, hasMedia: !!post.mediaUrl, mediaUrl: null });
    callback({ success: true, post });
  });

  socket.on('like_feed_post', ({ postId }, callback) => {
    const user = users.get(socket.id);
    if (typeof callback !== 'function') return;
    if (!user) return callback({ error: 'Not logged in' });

    const post = feedPosts.find(p => p.id === postId);
    if (!post) return callback({ error: 'Post not found' });

    const likeIndex = post.likes.indexOf(user.username);
    if (likeIndex === -1) {
      post.likes.push(user.username);
    } else {
      post.likes.splice(likeIndex, 1);
    }

    scheduleFeedSave();
    io.emit('feed_post_updated', { ...post, hasMedia: !!post.mediaUrl, mediaUrl: null });
    callback({ success: true, post });
  });

  socket.on('add_feed_comment', ({ postId, text }, callback) => {
    const user = users.get(socket.id);
    if (typeof callback !== 'function') return;
    if (!user) return callback({ error: 'Not logged in' });
    if (!text || text.trim().length === 0) return callback({ error: 'Comment cannot be empty' });

    const post = feedPosts.find(p => p.id === postId);
    if (!post) return callback({ error: 'Post not found' });

    const comment = {
      id: `comment_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      author: user.username,
      text: text.trim(),
      timestamp: Date.now()
    };

    post.comments.push(comment);
    scheduleFeedSave();
    io.emit('feed_post_updated', { ...post, hasMedia: !!post.mediaUrl, mediaUrl: null });
    callback({ success: true, post });
  });

  // ── Chat Message (with rate limit + validation) ────────────────────
  socket.on('chat_message', ({ chatId, text, fileUrl, fileType, fileName, transcription }) => {
    if (!checkRateLimit(socket.id, 'message')) return;

    const user = users.get(socket.id);
    if (!user) return;
    if (!isValidChatId(chatId)) return;

    const chat = chats.get(chatId);
    if (!chat) return;

    if (text && typeof text === 'string' && text.length > MAX_TEXT_LENGTH) return;
    if (fileUrl && typeof fileUrl === 'string' && fileUrl.length > MAX_FILE_URL_LENGTH) return;
    if (transcription && typeof transcription === 'string' && transcription.length > MAX_TEXT_LENGTH) return;

    const message = {
      id: generateMessageId(),
      sender: user.username,
      text: text || '',
      fileUrl: fileUrl || null,
      fileType: fileType || null,
      fileName: fileName || null,
      transcription: transcription || null,
      timestamp: Date.now()
    };

    chat.messages.push(message);

    // Cap messages per chat at 5000 to prevent unbounded growth
    if (chat.messages.length > 5000) {
      chat.messages = chat.messages.slice(-5000);
    }

    scheduleSave();
    const emittedMessage = { ...message, hasMedia: !!message.fileUrl, fileUrl: null };
    io.emit('chat_message', { chatId, message: emittedMessage });
  });

  // ── Edit Message ───────────────────────────────────────────────────
  socket.on('edit_message', ({ chatId, messageId, newText }, callback) => {
    const user = users.get(socket.id);
    if (!user) return callback && callback({ error: 'Not logged in' });
    if (!isValidChatId(chatId)) return callback && callback({ error: 'Invalid chat ID' });

    const chat = chats.get(chatId);
    if (!chat) return callback && callback({ error: 'Chat not found' });

    const message = chat.messages.find(m => m.id === messageId);
    if (!message) return callback && callback({ error: 'Message not found' });

    if (message.sender !== user.username) {
      return callback && callback({ error: 'You can only edit your own messages' });
    }

    if (newText && typeof newText === 'string' && newText.length > MAX_TEXT_LENGTH) {
      return callback && callback({ error: 'Message too long' });
    }

    message.text = newText || '';
    message.isEdited = true;

    scheduleSave();
    io.emit('message_edited', { chatId, messageId, text: message.text, isEdited: true });
    if (callback) callback({ success: true });
  });

  // ── Delete Message ─────────────────────────────────────────────────
  socket.on('delete_message', ({ chatId, messageId }, callback) => {
    const user = users.get(socket.id);
    if (!user) return callback && callback({ error: 'Not logged in' });
    if (!isValidChatId(chatId)) return callback && callback({ error: 'Invalid chat ID' });

    const chat = chats.get(chatId);
    if (!chat) return callback && callback({ error: 'Chat not found' });

    const msgIndex = chat.messages.findIndex(m => m.id === messageId);
    if (msgIndex === -1) return callback && callback({ error: 'Message not found' });

    const message = chat.messages[msgIndex];
    if (message.sender !== user.username) {
      return callback && callback({ error: 'You can only delete your own messages' });
    }

    chat.messages.splice(msgIndex, 1);
    scheduleSave();
    io.emit('message_deleted', { chatId, messageId });
    if (callback) callback({ success: true });
  });

  // ── Ping Latency Check ─────────────────────────────────────────────
  socket.on('ping_check', (callback) => {
    if (typeof callback === 'function') callback();
  });

  // ── Voice Channel Join ──────────────────────────────────────────────
  socket.on('join_voice', (status) => {
    const user = users.get(socket.id);
    if (!user) return;

    const roomId = (status && typeof status.roomId === 'string') ? status.roomId : 'global';
    voiceUsers.set(socket.id, {
      username: user.username,
      roomId,
      isMuted: (status && status.isMuted) || false,
      isDeafened: (status && status.isDeafened) || false
    });

    const othersInVoice = Array.from(voiceUsers.entries())
      .filter(([id, data]) => id !== socket.id && data.roomId === roomId)
      .map(([id, data]) => ({ id, ...data }));

    socket.emit('voice_users', othersInVoice);

    socket.broadcast.emit('user_joined_voice', {
      socketId: socket.id,
      username: user.username,
      roomId,
      isMuted: (status && status.isMuted) || false,
      isDeafened: (status && status.isDeafened) || false
    });

    const activeActivity = roomActivities.get(roomId);
    if (activeActivity) {
      socket.emit('activity_updated', activeActivity);
    }
  });

  // ── Voice Status Update (Mute/Deafen) ──────────────────────────────
  socket.on('voice_status', (status) => {
    const user = voiceUsers.get(socket.id);
    if (!user) return;
    if (!status || typeof status.isMuted !== 'boolean' || typeof status.isDeafened !== 'boolean') return;

    user.isMuted = status.isMuted;
    user.isDeafened = status.isDeafened;
    socket.broadcast.emit('user_voice_status', {
      socketId: socket.id,
      isMuted: status.isMuted,
      isDeafened: status.isDeafened
    });
  });

  // ── Voice Channel Leave ─────────────────────────────────────────────
  socket.on('leave_voice', () => {
    const vUser = voiceUsers.get(socket.id);
    if (vUser) {
      const vRoomId = vUser.roomId;
      voiceUsers.delete(socket.id);
      socket.broadcast.emit('user_left_voice', socket.id);
      cleanupRoomIfNeeded(vRoomId);
    }
  });

  // ── WebRTC Signaling ────────────────────────────────────────────────
  socket.on('webrtc_offer', (data) => {
    if (!data || typeof data.target !== 'string' || !data.sdp) return;
    io.to(data.target).emit('webrtc_offer', { caller: socket.id, sdp: data.sdp });
  });

  socket.on('webrtc_answer', (data) => {
    if (!data || typeof data.target !== 'string' || !data.sdp) return;
    io.to(data.target).emit('webrtc_answer', { caller: socket.id, sdp: data.sdp });
  });

  socket.on('webrtc_ice_candidate', (data) => {
    if (!data || typeof data.target !== 'string' || !data.candidate) return;
    io.to(data.target).emit('webrtc_ice_candidate', { caller: socket.id, candidate: data.candidate });
  });

  // ── Disconnect ──────────────────────────────────────────────────────
  
  // ── Media Fetching ──────────────────────────────────────────────────
  socket.on('request_media', ({ type, id, chatId }, callback) => {
    if (typeof callback !== 'function') return;
    let dataUrl = null;
    if (type === 'chat') {
      const chat = chats.get(chatId);
      if (chat) {
        const msg = chat.messages.find(m => m.id === id);
        if (msg) dataUrl = msg.fileUrl;
      }
    } else if (type === 'wall') {
      const post = wallPosts.find(p => p.id === id);
      if (post) dataUrl = post.mediaUrl;
    } else if (type === 'feed') {
      const post = feedPosts.find(p => p.id === id);
      if (post) dataUrl = post.mediaUrl;
    }
    callback({ success: true, dataUrl });
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`User disconnected: ${user.username} (${socket.id})`);
      socket.broadcast.emit('user_left', { username: user.username, socketId: socket.id });
    }

    if (voiceUsers.has(socket.id)) {
      const vUser = voiceUsers.get(socket.id);
      const vRoomId = vUser.roomId;
      voiceUsers.delete(socket.id);
      socket.broadcast.emit('user_left_voice', socket.id);
      cleanupRoomIfNeeded(vRoomId);
    }

    users.delete(socket.id);
    rateLimits.delete(socket.id);
  });

  // ── Start Activity ──────────────────────────────────────────────────
  socket.on('start_activity', ({ roomId, activityType }) => {
    const user = users.get(socket.id);
    if (!user) return;
    if (typeof roomId !== 'string') return;
    if (!['chess', 'checkers', 'tiktok'].includes(activityType)) return;

    let state = {};
    if (activityType === 'chess') {
      state = {
        board: [
          ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
          ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
          Array(8).fill(null),
          Array(8).fill(null),
          Array(8).fill(null),
          Array(8).fill(null),
          ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
          ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
        ],
        turn: 'white'
      };
    } else if (activityType === 'checkers') {
      const board = Array(8).fill(null).map(() => Array(8).fill(null));
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 8; c++) {
          if ((r + c) % 2 === 1) board[r][c] = 'b';
        }
      }
      for (let r = 5; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if ((r + c) % 2 === 1) board[r][c] = 'w';
        }
      }
      state = { board, turn: 'white' };
    } else if (activityType === 'tiktok') {
      state = { host: user.username };
    }

    roomActivities.set(roomId, { type: activityType, state });
    broadcastToRoom(roomId, 'activity_updated', { type: activityType, state });
  });

  // ── Activity Move (with server-side validation) ─────────────────────
  socket.on('activity_move', ({ roomId, move }) => {
    if (typeof roomId !== 'string' || !move) return;

    const act = roomActivities.get(roomId);
    if (!act || !act.state || !act.state.board) return;

    const { fromRow, fromCol, toRow, toCol, promoteTo } = move;

    if (typeof fromRow !== 'number' || typeof fromCol !== 'number' || typeof toRow !== 'number' || typeof toCol !== 'number') return;
    if (fromRow < 0 || fromRow > 7 || fromCol < 0 || fromCol > 7) return;
    if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) return;

    const board = act.state.board;
    const piece = board[fromRow][fromCol];

    if (!piece) return;

    // Turn validation
    if (act.state.turn === 'white' && piece !== piece.toUpperCase()) return;
    if (act.state.turn === 'black' && piece !== piece.toLowerCase()) return;

    // Validate the move based on game type
    let moveValid = false;
    if (act.type === 'chess') {
      moveValid = isValidChessMove(fromRow, fromCol, toRow, toCol, piece, board);
    } else if (act.type === 'checkers') {
      moveValid = isValidCheckersMove(fromRow, fromCol, toRow, toCol, piece, board);
    }

    if (!moveValid) return;

    // Apply the move
    board[fromRow][fromCol] = null;
    if (act.type === 'chess') {
      if (promoteTo && ['Q', 'R', 'B', 'N', 'q', 'r', 'b', 'n'].includes(promoteTo)) {
        board[toRow][toCol] = promoteTo;
      } else if (piece === 'P' && toRow === 0) {
        board[toRow][toCol] = 'Q';
      } else if (piece === 'p' && toRow === 7) {
        board[toRow][toCol] = 'q';
      } else {
        board[toRow][toCol] = piece;
      }
    } else if (act.type === 'checkers') {
      if (piece === 'w' && toRow === 0) {
        board[toRow][toCol] = 'W';
      } else if (piece === 'b' && toRow === 7) {
        board[toRow][toCol] = 'B';
      } else {
        board[toRow][toCol] = piece;
      }
      if (Math.abs(toRow - fromRow) === 2 && Math.abs(toCol - fromCol) === 2) {
        const midRow = (fromRow + toRow) / 2;
        const midCol = (fromCol + toCol) / 2;
        board[midRow][midCol] = null;
      }
    }

    act.state.turn = act.state.turn === 'white' ? 'black' : 'white';
    broadcastToRoom(roomId, 'activity_updated', act);
  });

  // ── Stop Activity ───────────────────────────────────────────────────
  socket.on('stop_activity', ({ roomId }) => {
    if (typeof roomId !== 'string') return;
    roomActivities.delete(roomId);
    broadcastToRoom(roomId, 'activity_updated', { type: null, state: null });
  });

  // ── TikTok Activity State Update ────────────────────────────────────
  socket.on('activity_state_update', ({ roomId, url }) => {
    if (typeof roomId !== 'string') return;
    const act = roomActivities.get(roomId);
    if (act && act.type === 'tiktok') {
      act.state.url = url;
      broadcastToRoom(roomId, 'activity_updated', act);
    }
  });

  // ── DM Call Signaling ───────────────────────────────────────────────
  socket.on('initiate_call', ({ chatId, targetUsername }) => {
    const user = users.get(socket.id);
    if (!user) return;
    if (!isValidChatId(chatId) || !isValidUsername(targetUsername)) return;

    const targetUser = Array.from(users.values()).find(u => u.username === targetUsername);
    if (targetUser && targetUser.socketId) {
      io.to(targetUser.socketId).emit('incoming_call', {
        chatId,
        callerUsername: user.username
      });
    }
  });

  socket.on('accept_call', ({ chatId, callerUsername }) => {
    const user = users.get(socket.id);
    if (!user) return;

    const callerUser = Array.from(users.values()).find(u => u.username === callerUsername);
    if (callerUser && callerUser.socketId) {
      io.to(callerUser.socketId).emit('call_accepted', { chatId, answererUsername: user.username });
    }
  });

  socket.on('decline_call', ({ chatId, callerUsername }) => {
    const user = users.get(socket.id);
    if (!user) return;

    const callerUser = Array.from(users.values()).find(u => u.username === callerUsername);
    if (callerUser && callerUser.socketId) {
      io.to(callerUser.socketId).emit('call_declined', { chatId });
    }
  });

  socket.on('cancel_call', ({ chatId, targetUsername }) => {
    if (!isValidChatId(chatId) || !isValidUsername(targetUsername)) return;
    const targetUser = Array.from(users.values()).find(u => u.username === targetUsername);
    if (targetUser && targetUser.socketId) {
      io.to(targetUser.socketId).emit('call_cancelled', { chatId });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Start Server
// ═══════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3001;
let currentPort = PORT;

function startServer(port) {
  currentPort = port;

  server.removeAllListeners('error');
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`LAN Messenger server running on port ${port}`);
    console.log('--------------------------------------------------');
    console.log('Available network interfaces on this machine:');
    const nets = os.networkInterfaces();
    let foundRadmin = false;
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          const isRadmin = name.toLowerCase().includes('radmin') || net.address.startsWith('26.');
          if (isRadmin) {
            console.log(`  => [RADMIN VPN] IP address: ${net.address} (Tell friends to connect to http://${net.address}:${port})`);
            foundRadmin = true;
          } else {
            console.log(`  => [${name}] IP address: ${net.address}`);
          }
        }
      }
    }
    if (!foundRadmin) {
      console.log('  WARNING: Could not explicitly identify a Radmin VPN IP interface (usually starts with 26.x.x.x).');
      console.log('  Make sure Radmin VPN is turned on and connected.');
    }
    console.log('--------------------------------------------------');
  });
}

startServer(PORT);

// ═══════════════════════════════════════════════════════════════════════
// Graceful shutdown
// ═══════════════════════════════════════════════════════════════════════
function flushAndExit() {
  console.log('\nShutting down gracefully...');
  let pending = 0;

  function done() {
    if (--pending <= 0) process.exit(0);
  }

  const data = Array.from(chats.values());
  pending++;
  fs.writeFile(CHATS_FILE, JSON.stringify(data, null, 2), 'utf8', (err) => {
    if (err) console.error('Failed to save chats on shutdown:', err);
    done();
  });

  pending++;
  fs.writeFile(WALL_FILE, JSON.stringify(wallPosts, null, 2), 'utf8', (err) => {
    if (err) console.error('Failed to save wall posts on shutdown:', err);
    done();
  });

  pending++;
  fs.writeFile(FEED_FILE, JSON.stringify(feedPosts, null, 2), 'utf8', (err) => {
    if (err) console.error('Failed to save feed posts on shutdown:', err);
    done();
  });

  pending++;
  fs.writeFile(USERS_FILE, JSON.stringify(usersProfile, null, 2), 'utf8', (err) => {
    if (err) console.error('Failed to save user profiles on shutdown:', err);
    done();
  });

  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', flushAndExit);
process.on('SIGTERM', flushAndExit);


