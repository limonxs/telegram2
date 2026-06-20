import React, { useState, useEffect } from 'react';
import { HeartIcon, MessageIcon as MessageCircleIcon, SendIcon, ImageIcon, VideoIcon } from './Icons';

export default function FeedView({ socket, username, appLanguage, onlineUsers, onRequestMedia }) {
  const [feedPosts, setFeedPosts] = useState([]);
  const [newPostText, setNewPostText] = useState('');
  const [newPostMedia, setNewPostMedia] = useState(null);
  const [newPostMediaType, setNewPostMediaType] = useState(null);
  const [expandedComments, setExpandedComments] = useState({});
  const [commentText, setCommentText] = useState({});

  useEffect(() => {
    if (socket) {
      socket.emit('get_feed_posts', (res) => {
        if (res.success) {
          setFeedPosts(res.posts);
        }
      });

      const onPostCreated = (post) => {
        setFeedPosts(prev => [post, ...prev]);
      };

      const onPostUpdated = (post) => {
        setFeedPosts(prev => prev.map(p => p.id === post.id ? post : p));
      };

      socket.on('feed_post_created', onPostCreated);
      socket.on('feed_post_updated', onPostUpdated);

      return () => {
        socket.off('feed_post_created', onPostCreated);
        socket.off('feed_post_updated', onPostUpdated);
      };
    }
  }, [socket]);

  const handleMediaUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const type = file.type.startsWith('video/') ? 'video' : 'image';
    const reader = new FileReader();
    reader.onload = (event) => {
      if (type === 'image') {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_SIZE = 1200;
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          setNewPostMedia(canvas.toDataURL('image/jpeg', 0.8));
          setNewPostMediaType(type);
        };
        img.src = event.target.result;
      } else {
        setNewPostMedia(event.target.result);
        setNewPostMediaType(type);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCreatePost = (e) => {
    e.preventDefault();
    if (!newPostText.trim() && !newPostMedia) return;

    socket.emit('create_feed_post', {
      text: newPostText,
      mediaType: newPostMediaType,
      mediaUrl: newPostMedia
    }, (res) => {
      if (res.success) {
        setNewPostText('');
        setNewPostMedia(null);
        setNewPostMediaType(null);
      } else {
        alert(res.error || 'Failed to create post');
      }
    });
  };

  const handleLike = (postId) => {
    socket.emit('like_feed_post', { postId });
  };

  const toggleComments = (postId) => {
    setExpandedComments(prev => ({ ...prev, [postId]: !prev[postId] }));
  };

  const submitComment = (postId, e) => {
    e.preventDefault();
    const text = commentText[postId] || '';
    if (!text.trim()) return;

    socket.emit('add_feed_comment', { postId, text }, (res) => {
      if (res.success) {
        setCommentText(prev => ({ ...prev, [postId]: '' }));
      }
    });
  };

  const getUserAvatar = (uname) => {
    const u = onlineUsers.find(u => u.username === uname);
    return u?.avatar || null;
  };

  return (
    <div className="feed-view-container" style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-main)', padding: '20px' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        
        {/* Create Post Box */}
        <div className="feed-create-post-box" style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '16px', padding: '16px', marginBottom: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <form onSubmit={handleCreatePost}>
            <textarea
              placeholder={appLanguage === 'ru' ? 'Что у вас нового?' : 'What is happening?!'}
              value={newPostText}
              onChange={(e) => setNewPostText(e.target.value)}
              style={{ width: '100%', minHeight: '80px', background: 'transparent', border: 'none', color: 'var(--text-main)', resize: 'none', outline: 'none', fontSize: '16px', marginBottom: '12px' }}
            />
            {newPostMedia && (
              <div style={{ position: 'relative', marginBottom: '12px', borderRadius: '12px', overflow: 'hidden', maxHeight: '300px' }}>
                {newPostMediaType === 'video' ? (
                  <video src={newPostMedia} controls style={{ width: '100%', maxHeight: '300px', objectFit: 'cover' }} />
                ) : (
                  <img src={newPostMedia} alt="Preview" style={{ width: '100%', maxHeight: '300px', objectFit: 'cover' }} />
                )}
                <button type="button" onClick={() => {setNewPostMedia(null); setNewPostMediaType(null)}} style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.5)', border: 'none', color: 'white', borderRadius: '50%', width: '28px', height: '28px', cursor: 'pointer' }}>✕</button>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="button" onClick={() => document.getElementById('feed-media-upload').click()} style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '6px', borderRadius: '50%', display: 'flex', alignItems: 'center' }}>
                  <ImageIcon size={20} />
                </button>
                <input type="file" id="feed-media-upload" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleMediaUpload} />
              </div>
              <button type="submit" disabled={!newPostText.trim() && !newPostMedia} style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '20px', fontWeight: 'bold', cursor: (!newPostText.trim() && !newPostMedia) ? 'not-allowed' : 'pointer', opacity: (!newPostText.trim() && !newPostMedia) ? 0.5 : 1 }}>
                {appLanguage === 'ru' ? 'Опубликовать' : 'Post'}
              </button>
            </div>
          </form>
        </div>

        {/* Feed Posts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {feedPosts.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px' }}>
              {appLanguage === 'ru' ? 'Здесь пока пусто.' : 'No posts yet.'}
            </div>
          ) : feedPosts.map(post => {
            const hasLiked = post.likes.includes(username);
            const avatar = getUserAvatar(post.author);
            return (
              <div key={post.id} className="feed-post-card" style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '16px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--accent-gradient)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '18px' }}>
                    {avatar ? <img src={avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : post.author[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{post.author}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{new Date(post.timestamp).toLocaleString()}</div>
                  </div>
                </div>

                {/* Content */}
                {post.text && <p style={{ color: 'var(--text-main)', fontSize: '15px', lineHeight: '1.5', marginBottom: '12px', whiteSpace: 'pre-wrap' }}>{post.text}</p>}
                
                {post.hasMedia && !post.mediaUrl && (
                  <div className="feed-media-placeholder" onClick={() => onRequestMedia(post.id, (url) => setFeedPosts(prev => prev.map(p => p.id === post.id ? { ...p, mediaUrl: url } : p)))} style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', padding: '40px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--primary)' }}>
                    <span style={{ color: 'var(--primary)', fontSize: '14px' }}>Кликните для загрузки медиа</span>
                  </div>
                )}
                {post.mediaUrl && (
                  <div style={{ borderRadius: '12px', overflow: 'hidden', marginBottom: '16px' }}>
                    {post.mediaType === 'video' ? (
                      <video src={post.mediaUrl} controls style={{ width: '100%', maxHeight: '400px', objectFit: 'contain', background: '#000' }} />
                    ) : (
                      <img src={post.mediaUrl} style={{ width: '100%', maxHeight: '400px', objectFit: 'contain', background: '#000' }} />
                    )}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '20px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px', marginTop: '12px' }}>
                  <button onClick={() => handleLike(post.id)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', color: hasLiked ? 'var(--ruby)' : 'var(--text-muted)', cursor: 'pointer', transition: 'color 0.2s' }}>
                    <HeartIcon size={20} fill={hasLiked ? 'var(--ruby)' : 'none'} color={hasLiked ? 'var(--ruby)' : 'currentColor'} />
                    <span style={{ fontWeight: 'bold' }}>{post.likes.length}</span>
                  </button>
                  <button onClick={() => toggleComments(post.id)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <MessageCircleIcon size={20} />
                    <span style={{ fontWeight: 'bold' }}>{post.comments.length}</span>
                  </button>
                </div>

                {/* Comments Section */}
                {expandedComments[post.id] && (
                  <div style={{ marginTop: '16px', background: 'rgba(0,0,0,0.15)', borderRadius: '12px', padding: '12px' }}>
                    {post.comments.map(comment => (
                      <div key={comment.id} style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--text-muted)', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '12px' }}>
                          {getUserAvatar(comment.author) ? <img src={getUserAvatar(comment.author)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : comment.author[0].toUpperCase()}
                        </div>
                        <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', padding: '10px 12px', borderRadius: '0 12px 12px 12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span style={{ fontWeight: 'bold', fontSize: '13px', color: 'var(--text-main)' }}>{comment.author}</span>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(comment.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <div style={{ fontSize: '14px', color: 'var(--text-main)', whiteSpace: 'pre-wrap' }}>{comment.text}</div>
                        </div>
                      </div>
                    ))}
                    
                    <form onSubmit={(e) => submitComment(post.id, e)} style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                      <input 
                        type="text" 
                        placeholder={appLanguage === 'ru' ? 'Написать комментарий...' : 'Write a comment...'} 
                        value={commentText[post.id] || ''}
                        onChange={(e) => setCommentText(prev => ({ ...prev, [post.id]: e.target.value }))}
                        style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '20px', padding: '8px 16px', color: 'white', outline: 'none' }}
                      />
                      <button type="submit" disabled={!(commentText[post.id] || '').trim()} style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', opacity: (commentText[post.id] || '').trim() ? 1 : 0.5 }}>
                        <SendIcon size={20} />
                      </button>
                    </form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
