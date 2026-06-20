const fs = require('fs');
const path = 'c:/Users/liman/Desktop/telegram2/server/index.js';
let code = fs.readFileSync(path, 'utf8');

// 1. Add USERS_FILE and usersProfile
const wallSaveLogic = `const WALL_FILE = path.join(__dirname, 'wall_store.json');
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
}`;

const userSaveLogic = `
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
}`;

if (!code.includes('USERS_FILE')) {
  code = code.replace(wallSaveLogic, wallSaveLogic + '\n' + userSaveLogic);
}

// 2. Load USERS_FILE
const loadWallLogic = `// Load wall posts from file
try {
  if (fs.existsSync(WALL_FILE)) {
    wallPosts = JSON.parse(fs.readFileSync(WALL_FILE, 'utf8'));
    console.log(\`Loaded \${wallPosts.length} wall posts from persistence store.\`);
  }
} catch (e) {
  console.error('Failed to load wall posts from disk:', e);
}`;

const loadUserLogic = `
// Load users profile from file
try {
  if (fs.existsSync(USERS_FILE)) {
    usersProfile = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    console.log(\`Loaded \${Object.keys(usersProfile).length} user profiles from persistence store.\`);
  }
} catch (e) {
  console.error('Failed to load users profile from disk:', e);
}`;

if (!code.includes('Load users profile from file')) {
  code = code.replace(loadWallLogic, loadWallLogic + '\n' + loadUserLogic);
}

// 3. Add Socket Handlers
const wallSocketLogic = `  // ── Profile Wall Posts ──────────────────────────────────────────────`;

const userProfileSocketLogic = `  // ── User Profile ────────────────────────────────────────────────────
  socket.on('get_user_profile', ({ username }, callback) => {
    if (typeof callback !== 'function') return;
    if (!isValidUsername(username)) return callback({ error: 'Invalid username' });
    const profile = usersProfile[username] || { aboutText: '', audioUrl: null };
    callback({ success: true, profile });
  });

  socket.on('update_user_profile', ({ aboutText, audioUrl }, callback) => {
    if (typeof callback !== 'function') return;
    const user = users.get(socket.id);
    if (!user) return callback({ error: 'Not logged in' });
    
    if (aboutText && aboutText.length > 2000) return callback({ error: 'About text too long' });
    if (audioUrl && audioUrl.length > 15000000) return callback({ error: 'Audio file too large (max 10MB)' });

    usersProfile[user.username] = {
      aboutText: aboutText || '',
      audioUrl: audioUrl || null
    };
    scheduleUsersSave();
    
    // Broadcast profile update
    io.emit('user_profile_updated', { username: user.username, profile: usersProfile[user.username] });
    callback({ success: true });
  });

`;

if (!code.includes("socket.on('get_user_profile'")) {
  code = code.replace(wallSocketLogic, userProfileSocketLogic + wallSocketLogic);
}

fs.writeFileSync(path, code, 'utf8');
console.log('Server index.js updated successfully.');
