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
    let avatar = null;
    if (data && typeof data === 'object') {
      username = data.username;
      avatar = data.avatar;
    } else {
      username = data;
    }

    if (!isValidUsername(username)) {
      if (typeof callback === 'function') callback({ success: false, error: 'Invalid username' });
      return;
    }

    // Enforce single active socket per username
    for (const [sid, u] of users.entries()) {
      if (u.username === username && sid !== socket.id) {
        console.log(`Force disconnecting duplicate session for user ${username} (${sid})`);
        const oldSocket = io.sockets.sockets.get(sid);
        if (oldSocket) {
          if (voiceUsers.has(sid)) {
            const vUser = voiceUsers.get(sid);
            const vRoomId = vUser.roomId;
            voiceUsers.delete(sid);
            for (const [otherSid, otherVUser] of voiceUsers.entries()) {
              if (otherVUser.roomId === vRoomId) {
                io.to(otherSid).emit('user_left_voice', sid);
              }
            }
            cleanupRoomIfNeeded(vRoomId);
          }
          oldSocket.disconnect(true);
        }
        users.delete(sid);
      }
    }

    users.set(socket.id, { username, avatar, socketId: socket.id });
    console.log(`User logged in: ${username} (${socket.id})`);

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
        messages: (c.messages || []).slice(-MAX_MESSAGES_ON_LOGIN)
      }));

    if (typeof callback === 'function') {
      callback({
        success: true,
        chats: userChats,
        onlineUsers: Array.from(users.values()).map(u => ({ username: u.username, socketId: u.socketId, avatar: u.avatar }))
      });
    }

    socket.broadcast.emit('user_joined', { username, socketId: socket.id, avatar });
  });

  // ── Avatar Update ──────────────────────────────────────────────────
  socket.on('update_avatar', (avatar) => {
    const user = users.get(socket.id);
    if (!user) return;
    if (typeof avatar !== 'string' || avatar.length > 100000) return;
    user.avatar = avatar;
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

  // ── Chat Message (with rate limit + validation) ────────────────────
  socket.on('chat_message', ({ chatId, text, fileUrl, fileType, fileName }) => {
    if (!checkRateLimit(socket.id, 'message')) return;

    const user = users.get(socket.id);
    if (!user) return;
    if (!isValidChatId(chatId)) return;

    const chat = chats.get(chatId);
    if (!chat) return;

    if (text && typeof text === 'string' && text.length > MAX_TEXT_LENGTH) return;
    if (fileUrl && typeof fileUrl === 'string' && fileUrl.length > MAX_FILE_URL_LENGTH) return;

    const message = {
      id: generateMessageId(),
      sender: user.username,
      text: text || '',
      fileUrl: fileUrl || null,
      fileType: fileType || null,
      fileName: fileName || null,
      timestamp: Date.now()
    };

    chat.messages.push(message);

    // Cap messages per chat at 5000 to prevent unbounded growth
    if (chat.messages.length > 5000) {
      chat.messages = chat.messages.slice(-5000);
    }

    scheduleSave();
    io.emit('chat_message', { chatId, message });
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
server.listen(PORT, '0.0.0.0', () => {
  console.log(`LAN Messenger server running on port ${PORT}`);
  console.log('--------------------------------------------------');
  console.log('Available network interfaces on this machine:');
  const nets = os.networkInterfaces();
  let foundRadmin = false;
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const isRadmin = name.toLowerCase().includes('radmin') || net.address.startsWith('26.');
        if (isRadmin) {
          console.log(`  => [RADMIN VPN] IP address: ${net.address} (Tell friends to connect to http://${net.address}:3001)`);
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
