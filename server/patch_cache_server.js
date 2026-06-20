const fs = require('fs');
const path = 'c:/Users/liman/Desktop/telegram2/server/index.js';
let code = fs.readFileSync(path, 'utf8');

// 1. Update login chat map
const loginSearch = `messages: (c.messages || []).slice(-MAX_MESSAGES_ON_LOGIN)`;
const loginReplace = `messages: (c.messages || []).slice(-MAX_MESSAGES_ON_LOGIN).map(m => ({ ...m, hasMedia: !!m.fileUrl, fileUrl: null }))`;
if (code.includes(loginSearch)) {
  code = code.replace(loginSearch, loginReplace);
}

// 2. Update chat_message emit
const chatMsgSearch = `io.emit('chat_message', { chatId, message });`;
const chatMsgReplace = `const emittedMessage = { ...message, hasMedia: !!message.fileUrl, fileUrl: null };\n    io.emit('chat_message', { chatId, message: emittedMessage });`;
if (code.includes(chatMsgSearch)) {
  code = code.replace(chatMsgSearch, chatMsgReplace);
}

// 3. Update get_wall_posts
const wallSearch = `callback({ success: true, posts });`;
const wallReplace = `callback({ success: true, posts: posts.map(p => ({ ...p, hasMedia: !!p.mediaUrl, mediaUrl: null })) });`;
if (code.includes(`socket.on('get_wall_posts'`) && code.includes(wallSearch)) {
  // Be careful not to replace feedPosts callback if it's identical
  // Actually get_feed_posts also uses `callback({ success: true, posts });`
  // We can just replace all instances of `callback({ success: true, posts });`
  // since both wall and feed have `mediaUrl`.
  code = code.split(wallSearch).join(wallReplace);
}

// 4. Update wall_post_created emit
const wallEmitSearch = `io.emit('wall_post_created', post);`;
const wallEmitReplace = `io.emit('wall_post_created', { ...post, hasMedia: !!post.mediaUrl, mediaUrl: null });`;
if (code.includes(wallEmitSearch)) {
  code = code.replace(wallEmitSearch, wallEmitReplace);
}

// 5. Update feed_post_created emit
const feedEmitSearch = `io.emit('feed_post_created', post);`;
const feedEmitReplace = `io.emit('feed_post_created', { ...post, hasMedia: !!post.mediaUrl, mediaUrl: null });`;
if (code.includes(feedEmitSearch)) {
  code = code.replace(feedEmitSearch, feedEmitReplace);
}

// 6. Update feed_post_updated emit
// Wait, feed_post_updated sends post with new likes/comments. It should also strip mediaUrl.
const feedUpdSearch = `io.emit('feed_post_updated', post);`;
const feedUpdReplace = `io.emit('feed_post_updated', { ...post, hasMedia: !!post.mediaUrl, mediaUrl: null });`;
if (code.includes(feedUpdSearch)) {
  code = code.split(feedUpdSearch).join(feedUpdReplace); // multiple occurrences
}

// 7. Add request_media handler
const requestMediaLogic = `
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
`;
if (!code.includes("socket.on('request_media'")) {
  const marker = `socket.on('disconnect', () => {`;
  code = code.replace(marker, requestMediaLogic + '\n  ' + marker);
}

fs.writeFileSync(path, code, 'utf8');
console.log('Server updated for media caching.');
