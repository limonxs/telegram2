import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './index.css';

// --- Client-side custom double encryption utilities --- //
function encryptMessage(text, chatId) {
  if (!text) return '';
  if (text.startsWith('data:')) {
    return text;
  }
  const keyA = chatId;
  const keyB = "TelecordSecureSalt2026";
  
  // Layer 1: XOR with Key A (chatId)
  let stage1 = [];
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    const keyChar = keyA.charCodeAt(i % keyA.length);
    stage1.push(charCode ^ keyChar);
  }
  
  // Layer 2: Non-linear shift & XOR with Key B (salt)
  let stage2 = [];
  for (let i = 0; i < stage1.length; i++) {
    const val = (stage1[i] + i) % 65536;
    const keyChar = keyB.charCodeAt(i % keyB.length);
    stage2.push(val ^ keyChar);
  }
  
  // Convert to Hex representation
  return stage2.map(x => x.toString(16).padStart(4, '0')).join('');
}

function decryptMessage(hexText, chatId) {
  if (!hexText) return '';
  if (hexText.startsWith('data:')) {
    return hexText;
  }
  if (hexText.length % 4 !== 0) return hexText;
  try {
    const keyA = chatId;
    const keyB = "TelecordSecureSalt2026";
    
    // Parse Hex representation
    let stage2 = [];
    for (let i = 0; i < hexText.length; i += 4) {
      stage2.push(parseInt(hexText.slice(i, i + 4), 16));
    }
    
    // Layer 2 Decryption: XOR with Key B and reverse shift
    let stage1 = [];
    for (let i = 0; i < stage2.length; i++) {
      const val = stage2[i] ^ keyB.charCodeAt(i % keyB.length);
      const originalVal = (val - (i % 65536) + 65536) % 65536;
      stage1.push(originalVal);
    }
    
    // Layer 1 Decryption: XOR with Key A
    let text = '';
    for (let i = 0; i < stage1.length; i++) {
      const charCode = stage1[i];
      const keyChar = keyA.charCodeAt(i % keyA.length);
      text += String.fromCharCode(charCode ^ keyChar);
    }
    
    return text;
  } catch (e) {
    return hexText;
  }
}

// --- Sub-components for cleaner code --- //

function VoiceUser({ id, username, stream, isMe, isMuted, isDeafened, onVolumeChange, volume, forceVideo, isScreenShare, onAvatarClick, onFocusToggle, isFocused, avatar }) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const requestRef = useRef(null);

  const hasVideo = forceVideo || (stream && stream.getVideoTracks().some(t => t.enabled && t.readyState !== 'ended' && !t.muted));

  useEffect(() => {
    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream;
      if (!isMe) {
        audioRef.current.volume = volume ?? 1.0;
      }
      
      // Hook up local and remote audio analysis for speaking detection
      if (stream.getAudioTracks().length > 0) {
        try {
          if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
          }
          const source = audioContextRef.current.createMediaStreamSource(stream);
          const analyser = audioContextRef.current.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          
          analyserRef.current = analyser;
          dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
        } catch (e) {
          console.warn("Could not create audio context for stream", e);
        }
      }
    }

    const checkSpeaking = () => {
      if (analyserRef.current && dataArrayRef.current && !isMuted) {
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        let sum = 0;
        for (let i = 0; i < dataArrayRef.current.length; i++) {
          sum += dataArrayRef.current[i];
        }
        const average = sum / dataArrayRef.current.length;
        setIsSpeaking(average > 15); // Threshold
      } else {
        setIsSpeaking(false);
      }
      requestRef.current = requestAnimationFrame(checkSpeaking);
    };

    requestRef.current = requestAnimationFrame(checkSpeaking);

    return () => {
      cancelAnimationFrame(requestRef.current);
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(e => console.log(e));
        audioContextRef.current = null;
      }
    };
  }, [stream, isMe, isMuted, volume, hasVideo]);

  // Update volume dynamically
  useEffect(() => {
    if (audioRef.current && volume !== undefined && !isMe) {
      audioRef.current.volume = volume;
    }
  }, [volume, isMe]);

  return (
    <div 
      className={`voice-tile ${hasVideo ? 'has-video' : 'audio-only'} ${isSpeaking ? 'speaking' : ''} ${isFocused ? 'focused' : ''}`}
      onClick={onFocusToggle}
      style={{ cursor: 'pointer' }}
    >
      {hasVideo ? (
        <>
          <video ref={audioRef} autoPlay playsInline muted={isMe} className="tile-video" />
          <div className="tile-overlay" onClick={e => e.stopPropagation()}>
            <span className="tile-name" onClick={(e) => { e.stopPropagation(); onAvatarClick(); }} style={{ cursor: 'pointer' }}>
              {isScreenShare && <span className="tile-badge" title="Screen share">🖥️</span>}
              {username}{isMe && ' (You)'}
            </span>
          </div>
        </>
      ) : (
        <>
          <div className={`tile-avatar ${isSpeaking ? 'speaking' : ''}`} onClick={(e) => { e.stopPropagation(); onAvatarClick(); }} style={{ cursor: 'pointer' }}>
            {avatar ? (
              <img src={avatar} alt={username} style={{width:'100%', height:'100%', borderRadius:'50%', objectFit:'cover'}} />
            ) : (
              username[0].toUpperCase()
            )}
          </div>
          <div className="tile-overlay" onClick={e => e.stopPropagation()}>
            <span className="tile-name" onClick={(e) => { e.stopPropagation(); onAvatarClick(); }} style={{ cursor: 'pointer' }}>
              {username}{isMe && ' (You)'}
            </span>
            {!isMe && (
              <input
                type="range"
                min="0" max="1" step="0.05"
                value={volume ?? 1.0}
                onChange={(e) => onVolumeChange(id, parseFloat(e.target.value))}
                className="volume-slider"
                title="User Volume"
              />
            )}
          </div>
        </>
      )}
      
      {/* Absolute top-right overlay controls for status and focusing */}
      <div className="tile-top-controls" onClick={e => e.stopPropagation()}>
        {isMuted && <span className="tile-status-icon muted" title="Muted">🔇</span>}
        {isDeafened && <span className="tile-status-icon deafened" title="Deafened">🔕</span>}
        <button 
          className="tile-focus-btn" 
          onClick={(e) => { e.stopPropagation(); onFocusToggle(); }} 
          title={isFocused ? "Свернуть" : "Развернуть на весь экран"}
        >
          {isFocused ? '🗗' : '⛶'}
        </button>
      </div>

      {!isMe && !hasVideo && <audio ref={audioRef} autoPlay />}
    </div>
  );
}

function CustomVideoPlayer({ src }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef(null);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(err => console.log(err));
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeekChange = (e) => {
    const val = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = val;
      setCurrentTime(val);
    }
  };

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const nextMuted = !isMuted;
      videoRef.current.muted = nextMuted;
      setIsMuted(nextMuted);
    }
  };

  const formatTime = (secs) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
      }
    }, 2500);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);

    return () => {
      if (video) {
        video.removeEventListener('play', onPlay);
        video.removeEventListener('pause', onPause);
      }
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="custom-player-container" onMouseMove={handleMouseMove} onClick={togglePlay}>
      <video
        ref={videoRef}
        src={src}
        className="custom-player-video"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onClick={(e) => e.stopPropagation()}
      />
      
      {!isPlaying && (
        <div className="custom-player-center-btn" onClick={(e) => { e.stopPropagation(); togglePlay(); }}>
          ▶
        </div>
      )}

      <div 
        className={`custom-player-controls ${showControls ? 'visible' : 'hidden'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="player-ctrl-btn" onClick={togglePlay}>
          {isPlaying ? '⏸' : '▶'}
        </button>

        <span className="player-time">{formatTime(currentTime)}</span>

        <input
          type="range"
          min="0"
          max={duration || 100}
          value={currentTime}
          onChange={handleSeekChange}
          className="player-seek-bar"
        />

        <span className="player-time">{formatTime(duration)}</span>

        <button className="player-ctrl-btn" onClick={toggleMute}>
          {isMuted ? '🔇' : '🔊'}
        </button>

        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={isMuted ? 0 : volume}
          onChange={handleVolumeChange}
          className="player-volume-slider"
        />
      </div>
    </div>
  );
}

function VoiceMessagePlayer({ src, fileName, msgId }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const getDefaultWaveform = (seedStr) => {
    const result = [];
    const length = 35;
    const seed = seedStr || 'defaultseed';
    for (let i = 0; i < length; i++) {
      const base = Math.sin((i / length) * Math.PI) * 16 + 4;
      const charCode = seed.charCodeAt(i % seed.length) || 1;
      const rnd = (charCode % 5) - 2;
      result.push(Math.max(4, Math.min(22, Math.round(base + rnd))));
    }
    return result;
  };

  const parseWaveform = (name, id) => {
    if (!name) return getDefaultWaveform(id);
    const parts = name.split('|WAVEFORM:');
    if (parts.length > 1) {
      const waveStr = parts[1];
      return waveStr.split(',').map(Number);
    }
    return getDefaultWaveform(name || id);
  };

  const waveform = parseWaveform(fileName, msgId);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(e => console.log(e));
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleWaveformClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = clickX / rect.width;
    if (audioRef.current && duration) {
      const nextTime = percent * duration;
      audioRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
    }
  };

  const formatTime = (secs) => {
    if (isNaN(secs) || !isFinite(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      if (audio) {
        audio.removeEventListener('play', onPlay);
        audio.removeEventListener('pause', onPause);
        audio.removeEventListener('ended', onEnded);
      }
    };
  }, []);

  const playbackProgress = duration ? (currentTime / duration) : 0;

  return (
    <div className="bubble-voice-player" onClick={e => e.stopPropagation()}>
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
      />
      <button type="button" className={`voice-play-btn ${isPlaying ? 'playing' : ''}`} onClick={togglePlay}>
        {isPlaying ? '⏸' : '▶'}
      </button>
      <div className="voice-progress-container">
        <div className="voice-waveform-container" onClick={handleWaveformClick}>
          {waveform.map((val, idx) => {
            const barProgress = idx / waveform.length;
            const isActive = barProgress < playbackProgress;
            return (
              <div 
                key={idx} 
                className="voice-wave-bar" 
                style={{ 
                  height: `${val}px`, 
                  backgroundColor: isActive ? 'var(--primary)' : undefined 
                }} 
              />
            );
          })}
        </div>
        <div className="voice-meta-row">
          <span>{isPlaying ? formatTime(currentTime) : formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

const isValidCheckersMove = (fromR, fromC, toR, toC, boardPiece, boardState) => {
  if (boardState[toR][toC] !== null) return false;
  if ((toR + toC) % 2 !== 1) return false;

  const rowDiff = toR - fromR;
  const colDiff = toC - fromC;
  const isKing = boardPiece === 'W' || boardPiece === 'B';

  if (!isKing) {
    const isWhite = boardPiece === 'w';
    const isRegularMove = (isWhite ? rowDiff === -1 : rowDiff === 1) && Math.abs(colDiff) === 1;
    if (isRegularMove) return true;

    if (Math.abs(rowDiff) === 2 && Math.abs(colDiff) === 2) {
      const midR = (fromR + toR) / 2;
      const midC = (fromC + toC) / 2;
      const midPiece = boardState[midR][midC];
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
      let isWhiteKing = boardPiece === 'W';

      for (let i = 1; i < Math.abs(rowDiff); i++) {
        const r = fromR + i * rStep;
        const c = fromC + i * cStep;
        const cell = boardState[r][c];
        if (cell !== null) {
          piecesInPath++;
          lastMidPiece = cell;
        }
      }

      if (piecesInPath === 0) return true;
      if (piecesInPath === 1) {
        const isOpponent = (isWhiteKing ? lastMidPiece.toLowerCase() === 'b' : lastMidPiece.toLowerCase() === 'w');
        return isOpponent;
      }
    }
  }
  return false;
};

const isValidChessMove = (fromR, fromC, toR, toC, piece, boardState) => {
  const targetPiece = boardState[toR][toC];
  if (targetPiece) {
    const isOwnPiece = (piece === piece.toUpperCase()) === (targetPiece === targetPiece.toUpperCase());
    if (isOwnPiece) return false;
  }

  const rowDiff = toR - fromR;
  const colDiff = toC - fromC;
  const pType = piece.toLowerCase();

  switch (pType) {
    case 'p':
      const isWhite = piece === 'P';
      const direction = isWhite ? -1 : 1;
      const startRow = isWhite ? 6 : 1;
      
      if (colDiff === 0 && rowDiff === direction && !targetPiece) {
        return true;
      }
      if (colDiff === 0 && fromR === startRow && rowDiff === 2 * direction && !boardState[fromR + direction][fromC] && !targetPiece) {
        return true;
      }
      if (Math.abs(colDiff) === 1 && rowDiff === direction && targetPiece) {
        return true;
      }
      return false;

    case 'r':
      if (rowDiff === 0 || colDiff === 0) {
        const rStep = rowDiff === 0 ? 0 : (rowDiff > 0 ? 1 : -1);
        const cStep = colDiff === 0 ? 0 : (colDiff > 0 ? 1 : -1);
        const steps = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
        for (let i = 1; i < steps; i++) {
          if (boardState[fromR + i * rStep][fromC + i * cStep] !== null) return false;
        }
        return true;
      }
      return false;

    case 'b':
      if (Math.abs(rowDiff) === Math.abs(colDiff)) {
        const rStep = rowDiff > 0 ? 1 : -1;
        const cStep = colDiff > 0 ? 1 : -1;
        for (let i = 1; i < Math.abs(rowDiff); i++) {
          if (boardState[fromR + i * rStep][fromC + i * cStep] !== null) return false;
        }
        return true;
      }
      return false;

    case 'q':
      if (rowDiff === 0 || colDiff === 0 || Math.abs(rowDiff) === Math.abs(colDiff)) {
        const rStep = rowDiff === 0 ? 0 : (rowDiff > 0 ? 1 : -1);
        const cStep = colDiff === 0 ? 0 : (colDiff > 0 ? 1 : -1);
        const steps = Math.max(Math.abs(rowDiff), Math.abs(colDiff));
        for (let i = 1; i < steps; i++) {
          if (boardState[fromR + i * rStep][fromC + i * cStep] !== null) return false;
        }
        return true;
      }
      return false;

    case 'n':
      if ((Math.abs(rowDiff) === 2 && Math.abs(colDiff) === 1) || (Math.abs(rowDiff) === 1 && Math.abs(colDiff) === 2)) {
        return true;
      }
      return false;

    case 'k':
      if (Math.abs(rowDiff) <= 1 && Math.abs(colDiff) <= 1) {
        return true;
      }
      return false;
  }
  return false;
};

function ActivityBoard({ activity, onMove, onStop, isTheater }) {
  const [selectedCell, setSelectedCell] = useState(null);

  const { type, state } = activity;
  if (!type || !state || !state.board) return null;

  const board = state.board;
  const turn = state.turn;

  const handleCellClick = (r, c) => {
    const piece = board[r][c];

    if (selectedCell) {
      if (selectedCell.row === r && selectedCell.col === c) {
        setSelectedCell(null);
        return;
      }

      const selectedPiece = board[selectedCell.row][selectedCell.col];
      let isValid = false;
      if (type === 'checkers') {
        isValid = isValidCheckersMove(selectedCell.row, selectedCell.col, r, c, selectedPiece, board);
      } else if (type === 'chess') {
        isValid = isValidChessMove(selectedCell.row, selectedCell.col, r, c, selectedPiece, board);
      }

      if (isValid) {
        onMove({
          fromRow: selectedCell.row,
          fromCol: selectedCell.col,
          toRow: r,
          toCol: c
        });
      } else {
        if (piece) {
          if (type === 'chess') {
            const isWhitePiece = piece === piece.toUpperCase();
            if ((turn === 'white' && isWhitePiece) || (turn === 'black' && !isWhitePiece)) {
              setSelectedCell({ row: r, col: c });
              return;
            }
          } else if (type === 'checkers') {
            const isWhitePiece = piece.toLowerCase() === 'w';
            if ((turn === 'white' && isWhitePiece) || (turn === 'black' && !isWhitePiece)) {
              setSelectedCell({ row: r, col: c });
              return;
            }
          }
        }
      }
      setSelectedCell(null);
    } else {
      if (!piece) return;

      if (type === 'chess') {
        const isWhitePiece = piece === piece.toUpperCase();
        if ((turn === 'white' && isWhitePiece) || (turn === 'black' && !isWhitePiece)) {
          setSelectedCell({ row: r, col: c });
        }
      } else if (type === 'checkers') {
        const isWhitePiece = piece.toLowerCase() === 'w';
        if ((turn === 'white' && isWhitePiece) || (turn === 'black' && !isWhitePiece)) {
          setSelectedCell({ row: r, col: c });
        }
      }
    }
  };

  const chessSymbols = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
  };

  const renderCellContent = (r, c, val) => {
    if (!val) return null;
    if (type === 'chess') {
      return chessSymbols[val] || val;
    } else if (type === 'checkers') {
      const isKing = val === 'W' || val === 'B';
      const colorClass = (val.toLowerCase() === 'w') ? 'white' : 'black';
      return (
        <div className={`checker-piece ${colorClass} ${isKing ? 'king' : ''}`} />
      );
    }
    return null;
  };

  return (
    <div className="activity-board-container" onClick={e => e.stopPropagation()}>
      <div className="activity-game-meta">
        <span>Ход: {turn === 'white' ? 'Белые ⚪' : 'Черные ⚫'}</span>
        <button className="activity-stop-btn" onClick={onStop}>Завершить</button>
      </div>
      <div className="activity-board">
        {board.map((rowArr, rIdx) => 
          rowArr.map((cellVal, cIdx) => {
            const isDark = (rIdx + cIdx) % 2 === 1;
            const isSelected = selectedCell && selectedCell.row === rIdx && selectedCell.col === cIdx;
            return (
              <div
                key={`${rIdx}-${cIdx}`}
                className={`board-cell ${isDark ? 'dark' : 'light'} ${isSelected ? 'selected' : ''}`}
                onClick={() => handleCellClick(rIdx, cIdx)}
              >
                {renderCellContent(rIdx, cIdx, cellVal)}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function TikTokActivityView({ activity, voiceUsers, username, localDisplayStream, isSharingScreen, onStop }) {
  const host = activity.state?.host;
  const isMe = host === username;
  const videoRef = useRef(null);

  // If not me, we need to find the host's screen-share video track
  let hostStream = null;
  if (!isMe) {
    const hostUser = voiceUsers.find(u => u.username === host);
    if (hostUser && hostUser.stream) {
      const hasVideo = hostUser.stream.getVideoTracks().length > 0;
      if (hasVideo) {
        hostStream = hostUser.stream;
      }
    }
  } else {
    hostStream = localDisplayStream;
  }

  useEffect(() => {
    if (videoRef.current && hostStream) {
      videoRef.current.srcObject = hostStream;
    }
  }, [hostStream]);

  return (
    <div className="tiktok-activity-container" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifySelf: 'stretch', justifyContent: 'center', background: '#000', position: 'relative', borderRadius: '12px', overflow: 'hidden' }}>
      <div className="tiktok-activity-header" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '40px', background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 15px', zIndex: 10 }}>
        <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>🎵</span> Совместный TikTok (Ведущий: {isMe ? 'Вы' : host})
        </span>
        <button 
          onClick={onStop} 
          style={{ background: '#da373c', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 'bold', transition: 'background-color 0.2s' }}
          onMouseOver={e => e.target.style.background = '#c12a2f'}
          onMouseOut={e => e.target.style.background = '#da373c'}
        >
          Завершить
        </button>
      </div>

      {isMe ? (
        <div style={{ textAlign: 'center', color: '#fff', padding: '20px' }}>
          <div style={{ fontSize: '48px', marginBottom: '15px', animation: 'speaker-pulse 1.8s infinite' }}>🎵</div>
          <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Вы транслируете TikTok!</h3>
          <p style={{ color: '#a0a0ab', fontSize: '13px', marginTop: '10px', maxWidth: '320px', lineHeight: '1.5' }}>
            У вас открыто отдельное вертикальное окно с мобильной версией TikTok. 
            Листайте ленту там, а остальные участники увидят трансляцию здесь.
          </p>
        </div>
      ) : hostStream ? (
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} 
        />
      ) : (
        <div style={{ textAlign: 'center', color: '#fff', padding: '20px' }}>
          <div style={{ fontSize: '32px', marginBottom: '15px', animation: 'speaker-pulse 1.5s infinite' }}>⏳</div>
          <h3 style={{ fontSize: '16px', fontWeight: '600' }}>Ожидание трансляции TikTok от {host}...</h3>
          <p style={{ color: '#a0a0ab', fontSize: '12px', marginTop: '8px' }}>
            Трансляция появится здесь автоматически в течение секунды.
          </p>
        </div>
      )}
    </div>
  );
}

// --- Main App Component --- //

function App() {
  const [serverIp, setServerIp] = useState(localStorage.getItem('savedServerIp') || 'localhost');
  const [username, setUsername] = useState('');
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('idle'); // 'idle' | 'connecting' | 'connected' | 'error'
  const [connectionError, setConnectionError] = useState('');
  
  const [userAvatar, setUserAvatar] = useState(localStorage.getItem('savedAvatar') || null);
  const [isChangingAccount, setIsChangingAccount] = useState(false);
  
  // Voice recording state
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [recordingWaveform, setRecordingWaveform] = useState([]);
  const recordingAnalyserRef = useRef(null);
  const recordingVolumeIntervalRef = useRef(null);
  const fullWaveformRef = useRef([]);

  const [socket, setSocket] = useState(null);
  const [inputText, setInputText] = useState('');
  
  // Telegram Chats & Navigation State
  const [chats, setChats] = useState([]);
  const [selectedChatId, setSelectedChatId] = useState('global');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [activeTab, setActiveTab] = useState('chats'); // 'chats' | 'contacts'
  const [isMidnightMode, setIsMidnightMode] = useState(localStorage.getItem('midnightMode') === 'true');
  const [newGroupName, setNewGroupName] = useState('');
  const [showProfile, setShowProfile] = useState(null); // User details
  
  // Voice Call State
  const [inVoice, setInVoice] = useState(false);
  const [activeCallChatId, setActiveCallChatId] = useState(null);
  const [showVoiceStage, setShowVoiceStage] = useState(false); // overlay
  const [voiceUsers, setVoiceUsers] = useState([]); // { id, username, isMuted, isDeafened, stream, volume }
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  
  // Screen Sharing Custom Picker State
  const [showScreenPicker, setShowScreenPicker] = useState(false);
  const [screenSources, setScreenSources] = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [focusedUserId, setFocusedUserId] = useState(null);
  const [screenQuality, setScreenQuality] = useState('original');
  const [shareScreenAudio, setShareScreenAudio] = useState(false);
  const [attachment, setAttachment] = useState(null); // { fileUrl, fileType, fileName }
  const [showMediaViewer, setShowMediaViewer] = useState(null); // { fileUrl, fileType, fileName, sender }
  const [failedThumbnails, setFailedThumbnails] = useState([]);

  // Webcam video stream states
  const [isSharingWebcam, setIsSharingWebcam] = useState(false);
  const [webcamStream, setWebcamStream] = useState(null);

  // Activities states
  const [activeActivity, setActiveActivity] = useState({ type: null, state: null });
  const [showActivityPicker, setShowActivityPicker] = useState(false);

  // Calling system states
  const [outgoingCall, setOutgoingCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);

  const [mutedChats, setMutedChats] = useState(JSON.parse(localStorage.getItem('mutedChats') || '[]'));
  const [showPinsPopup, setShowPinsPopup] = useState(false);
  const [headerSearchQuery, setHeaderSearchQuery] = useState('');
  const [pinnedMessages, setPinnedMessages] = useState(JSON.parse(localStorage.getItem('pinnedMessages') || '{}'));

  const togglePinMessage = (msg) => {
    if (!selectedChatId) return;
    const currentPins = pinnedMessages[selectedChatId] || [];
    const isAlreadyPinned = currentPins.some(p => p.id === msg.id || (p.timestamp === msg.timestamp && p.sender === msg.sender));
    let newPins;
    if (isAlreadyPinned) {
      newPins = currentPins.filter(p => !(p.id === msg.id || (p.timestamp === msg.timestamp && p.sender === msg.sender)));
    } else {
      newPins = [...currentPins, msg];
    }
    const updated = { ...pinnedMessages, [selectedChatId]: newPins };
    setPinnedMessages(updated);
    localStorage.setItem('pinnedMessages', JSON.stringify(updated));
  };

  const isPinned = (msg) => {
    if (!selectedChatId) return false;
    const currentPins = pinnedMessages[selectedChatId] || [];
    return currentPins.some(p => p.id === msg.id || (p.timestamp === msg.timestamp && p.sender === msg.sender));
  };

  const ringtoneIntervalRef = useRef(null);
  const ringtoneAudioCtxRef = useRef(null);
  
  // Heartbeat Latency (Ping)
  const [ping, setPing] = useState(0);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [audioInputs, setAudioInputs] = useState([]);
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [selectedInput, setSelectedInput] = useState(localStorage.getItem('selectedInput') || 'default');
  const [selectedOutput, setSelectedOutput] = useState(localStorage.getItem('selectedOutput') || 'default');
  const [noiseSuppression, setNoiseSuppression] = useState(localStorage.getItem('noiseSuppression') !== 'false');
  const [bitrate, setBitrate] = useState(parseInt(localStorage.getItem('bitrate')) || 64);
  
  // Custom Telegram Settings States
  const [userPhone, setUserPhone] = useState(localStorage.getItem('savedPhone') || '+7 993 182 8958');
  const [userNickname, setUserNickname] = useState(localStorage.getItem('savedNickname') || '@JiUmoH_3aBo3uT');
  const [activeSettingsSection, setActiveSettingsSection] = useState('account');
  const [accentColor, setAccentColor] = useState(localStorage.getItem('accentColor') || 'slate');
  const [accentGradient, setAccentGradient] = useState(localStorage.getItem('accentGradient') || 'solid');
  const [appLanguage, setAppLanguage] = useState(localStorage.getItem('appLanguage') || 'ru');
  const [enableConnectSound, setEnableConnectSound] = useState(localStorage.getItem('soundConnect') !== 'false');
  const [enableJoinSound, setEnableJoinSound] = useState(localStorage.getItem('soundJoin') !== 'false');
  const [enableLeaveSound, setEnableLeaveSound] = useState(localStorage.getItem('soundLeave') !== 'false');
  const [enableMsgSound, setEnableMsgSound] = useState(localStorage.getItem('soundMsg') !== 'false');

  // Unified settings states
  const [activeSettingsSubmenu, setActiveSettingsSubmenu] = useState(null); // null means main Settings menu list
  const [zoomLevel, setZoomLevel] = useState(parseInt(localStorage.getItem('zoomLevel')) || 100);
  const [themeMode, setThemeMode] = useState(localStorage.getItem('themeMode') || 'dark'); // dark, midnight, light
  const [enableAnimations, setEnableAnimations] = useState(localStorage.getItem('enableAnimations') !== 'false');
  const [phoneConfirmed, setPhoneConfirmed] = useState(localStorage.getItem('phoneConfirmed') === 'true');
  const [starsCount, setStarsCount] = useState(parseInt(localStorage.getItem('starsCount')) || 150);
  const [businessAutoReply, setBusinessAutoReply] = useState(localStorage.getItem('businessAutoReply') || 'Привет! Я сейчас занят, отвечу позже.');
  const [customPrimaryColor, setCustomPrimaryColor] = useState(localStorage.getItem('customPrimaryColor') || '#708090');
  const [customGradientColor2, setCustomGradientColor2] = useState(localStorage.getItem('customGradientColor2') || '#4f5b66');
  const [selectedFolder, setSelectedFolder] = useState('all');
  const [visibleFolders, setVisibleFolders] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('visibleFolders')) || { all: true, personal: true, groups: true };
    } catch(e) {
      return { all: true, personal: true, groups: true };
    }
  });

  const adjustColorBrightness = (hex, percent) => {
    let R = parseInt(hex.substring(1, 3), 16);
    let G = parseInt(hex.substring(3, 5), 16);
    let B = parseInt(hex.substring(5, 7), 16);

    R = parseInt(R * (100 + percent) / 100);
    G = parseInt(G * (100 + percent) / 100);
    B = parseInt(B * (100 + percent) / 100);

    R = (R < 255) ? R : 255;
    G = (G < 255) ? G : 255;
    B = (B < 255) ? B : 255;

    R = (R > 0) ? R : 0;
    G = (G > 0) ? G : 0;
    B = (B > 0) ? B : 0;

    const rHex = R.toString(16).padStart(2, '0');
    const gHex = G.toString(16).padStart(2, '0');
    const bHex = B.toString(16).padStart(2, '0');

    return `#${rHex}${gHex}${bHex}`;
  };
  const hexToRgbA = (hex, alpha) => {
    let c;
    if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)){
        c= hex.substring(1).split('');
        if(c.length== 3){
            c= [c[0], c[0], c[1], c[1], c[2], c[2]];
        }
        c= '0x' + c.join('');
        return 'rgba('+[(c>>16)&255, (c>>8)&255, c&255].join(',')+','+alpha+')';
    }
    return `rgba(139, 92, 246, ${alpha})`;
  };

  const applyThemeCustomization = (color, gradient, midnight, theme = themeMode, zoom = zoomLevel, animations = enableAnimations, customPri = customPrimaryColor, customGrad2 = customGradientColor2) => {
    const root = document.documentElement;
    let primary = '#708090'; // Default slate gray
    let primaryHover = '#5c6c7b';
    let primaryGlow = 'rgba(112, 128, 144, 0.35)';
    
    if (color === 'blue') {
      primary = '#3b82f6';
      primaryHover = '#2563eb';
      primaryGlow = 'rgba(59, 130, 246, 0.35)';
    } else if (color === 'emerald') {
      primary = '#10b981';
      primaryHover = '#059669';
      primaryGlow = 'rgba(16, 185, 129, 0.35)';
    } else if (color === 'amber') {
      primary = '#f59e0b';
      primaryHover = '#d97706';
      primaryGlow = 'rgba(245, 158, 11, 0.35)';
    } else if (color === 'ruby') {
      primary = '#ef4444';
      primaryHover = '#dc2626';
      primaryGlow = 'rgba(239, 68, 68, 0.35)';
    } else if (color === 'violet') {
      primary = '#8b5cf6';
      primaryHover = '#7c3aed';
      primaryGlow = 'rgba(139, 92, 246, 0.35)';
    } else if (color === 'custom') {
      primary = customPri;
      primaryHover = adjustColorBrightness(customPri, -15);
      primaryGlow = hexToRgbA(customPri, 0.35);
    }
    
    root.style.setProperty('--primary', primary);
    root.style.setProperty('--primary-hover', primaryHover);
    root.style.setProperty('--primary-glow', primaryGlow);
    
    let accentGrad = primary; // Default solid grey/accent
    if (gradient === 'indigo') {
      accentGrad = `linear-gradient(135deg, ${primary}, #4f46e5)`;
    } else if (gradient === 'cyan') {
      accentGrad = `linear-gradient(135deg, ${primary}, #06b6d4)`;
    } else if (gradient === 'orange') {
      accentGrad = `linear-gradient(135deg, #ec4899, #f97316)`;
    } else if (gradient === 'custom') {
      accentGrad = `linear-gradient(135deg, ${primary}, ${customGrad2})`;
    }
    root.style.setProperty('--accent-gradient', accentGrad);

    // Apply Zoom factor to layout
    document.body.style.zoom = zoom / 100;

    // Apply theme mode class
    const container = document.querySelector('.app-container');
    if (container) {
      container.classList.remove('midnight-theme', 'light-theme');
      if (theme === 'midnight') {
        container.classList.add('midnight-theme');
      } else if (theme === 'light') {
        container.classList.add('light-theme');
      }
    }

    // Apply animation disabling class
    const body = document.body;
    if (animations) {
      body.classList.remove('no-animations');
    } else {
      body.classList.add('no-animations');
    }
  };

  useEffect(() => {
    applyThemeCustomization(accentColor, accentGradient, isMidnightMode, themeMode, zoomLevel, enableAnimations, customPrimaryColor, customGradientColor2);
  }, [accentColor, accentGradient, isMidnightMode, themeMode, zoomLevel, enableAnimations, customPrimaryColor, customGradientColor2]);

  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const peersRef = useRef({}); // socketId -> RTCPeerConnection
  const videoSendersRef = useRef({}); // socketId -> RTCRtpSender (for screen share)
  const screenAudioSendersRef = useRef({}); // socketId -> RTCRtpSender (for screen audio)
  const webcamStreamRef = useRef(null);
  const webcamSendersRef = useRef({}); // socketId -> RTCRtpSender (for webcam video)
  const socketRef = useRef(null);

  // Web Audio Synth Chimes
  const playConnectSound = () => {
    if (localStorage.getItem('soundConnect') === 'false') return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(440, ctx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(554.37, ctx.currentTime + 0.08);
      gain1.gain.setValueAtTime(0.08, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start();
      osc1.stop(ctx.currentTime + 0.2);
      
      setTimeout(() => {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(659.25, ctx.currentTime);
        osc2.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
        gain2.gain.setValueAtTime(0.08, ctx.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start();
        osc2.stop(ctx.currentTime + 0.3);
      }, 80);
    } catch (e) {}
  };

  const playDisconnectSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(554.37, ctx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(329.63, ctx.currentTime + 0.2);
      gain1.gain.setValueAtTime(0.08, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start();
      osc1.stop(ctx.currentTime + 0.25);
    } catch (e) {}
  };

  const playUserJoinSound = () => {
    if (localStorage.getItem('soundJoin') === 'false') return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch (e) {}
  };

  const playUserLeaveSound = () => {
    if (localStorage.getItem('soundLeave') === 'false') return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch (e) {}
  };

  const playMessageSound = () => {
    if (localStorage.getItem('soundMsg') === 'false') return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08); // A5
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {}
  };

  // Ping heartbeat check
  useEffect(() => {
    if (!socket) return;
    const interval = setInterval(() => {
      const start = Date.now();
      socket.emit('ping_check', () => {
        setPing(Date.now() - start);
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [socket]);

  // Device enumeration
  useEffect(() => {
    const getDevices = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioInputs(devices.filter(d => d.kind === 'audioinput'));
        setAudioOutputs(devices.filter(d => d.kind === 'audiooutput'));
      } catch (err) {
        console.error("Could not enumerate devices", err);
      }
    };
    getDevices();
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', getDevices);
      return () => navigator.mediaDevices.removeEventListener('devicechange', getDevices);
    }
  }, []);

  // Handle sink ID changes for remote audio elements
  useEffect(() => {
    if (!selectedOutput || selectedOutput === 'default') return;
    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach(audio => {
      if (typeof audio.setSinkId === 'function') {
        audio.setSinkId(selectedOutput).catch(e => console.warn("setSinkId failed", e));
      }
    });
  }, [selectedOutput, voiceUsers]);

  // Update local constraints dynamically
  useEffect(() => {
    if (!inVoice || !localStreamRef.current) return;
    
    const updateLocalStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedInput && selectedInput !== 'default' ? { exact: selectedInput } : undefined,
            noiseSuppression: noiseSuppression,
            echoCancellation: noiseSuppression,
            autoGainControl: noiseSuppression
          }
        });
        
        const newAudioTrack = stream.getAudioTracks()[0];
        
        if (isMuted || isDeafened) {
          newAudioTrack.enabled = false;
        }

        Object.values(peersRef.current).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
          if (sender) {
            sender.replaceTrack(newAudioTrack);
            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = bitrate * 1000;
            sender.setParameters(params).catch(e => console.warn("Could not set maxBitrate", e));
          }
        });

        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = stream;
        setLocalStream(stream);
      } catch (e) {
        console.error("Failed to apply new audio constraints", e);
      }
    };
    updateLocalStream();
  }, [selectedInput, noiseSuppression, bitrate]);

  // Handle Mute/Deafen toggles
  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !(isMuted || isDeafened);
      });
    }
    
    if (socket && inVoice) {
      socket.emit('voice_status', { isMuted: (isMuted || isDeafened), isDeafened });
    }
    
    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach(audio => {
      audio.muted = isDeafened;
    });
  }, [isMuted, isDeafened, socket, inVoice]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (socket) socket.disconnect();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
      }
      Object.values(peersRef.current).forEach(pc => pc.close());
      stopRingtone();
    };
  }, [socket]);

  useEffect(() => {
    const savedUser = localStorage.getItem('savedUsername');
    const savedIp = localStorage.getItem('savedServerIp');
    if (savedUser) {
      setUsername(savedUser);
    }
    if (savedIp) {
      setServerIp(savedIp);
    }
  }, []);

  useEffect(() => {
    setHeaderSearchQuery('');
    setShowPinsPopup(false);
  }, [selectedChatId]);

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Запись звука не поддерживается или заблокирована.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Set up Audio Context and AnalyserNode for real visualizer feedback
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const sourceNode = audioCtx.createMediaStreamSource(stream);
        const analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 64;
        sourceNode.connect(analyserNode);

        recordingAnalyserRef.current = { audioContext: audioCtx, analyser: analyserNode, source: sourceNode };
        fullWaveformRef.current = [];
        setRecordingWaveform(Array(20).fill(4));

        const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
        recordingVolumeIntervalRef.current = setInterval(() => {
          analyserNode.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          // Normalize volume levels to pixel heights between 3px and 22px
          const val = Math.max(3, Math.min(22, Math.round((avg / 255) * 19 + 3)));
          
          fullWaveformRef.current.push(val);
          setRecordingWaveform(prev => {
            const next = [...prev, val];
            if (next.length > 25) {
              return next.slice(next.length - 25);
            }
            return next;
          });
        }, 100);
      } catch (e) {
        console.warn("Could not start volume analysis node:", e);
      }

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (audioChunksRef.current.length === 0) return;
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = reader.result;
          if (socket && selectedChatId) {
            // Downsample full recorded waveform to a standard 35 bars representation
            const rawWave = fullWaveformRef.current;
            let targetWave = [];
            const targetLength = 35;
            if (rawWave.length > 0) {
              if (rawWave.length <= targetLength) {
                targetWave = [...rawWave];
                while (targetWave.length < targetLength) {
                  targetWave.push(3);
                }
              } else {
                for (let i = 0; i < targetLength; i++) {
                  const idx = Math.floor((i / targetLength) * rawWave.length);
                  targetWave.push(rawWave[idx]);
                }
              }
            } else {
              targetWave = Array(targetLength).fill(4);
            }

            const serializedName = `VoiceMessage.webm|WAVEFORM:${targetWave.join(',')}`;
            const encryptedFileUrl = encryptMessage(base64Audio, selectedChatId);
            const encryptedFileName = encryptMessage(serializedName, selectedChatId);
            socket.emit('chat_message', {
              chatId: selectedChatId,
              text: '',
              fileUrl: encryptedFileUrl,
              fileType: 'audio',
              fileName: encryptedFileName
            });
          }
        };
        reader.readAsDataURL(audioBlob);

        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Failed to start voice recording", err);
      alert("Не удалось получить доступ к микрофону для записи.");
    }
  };

  const stopRecording = (shouldSend) => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;

    clearInterval(recordingTimerRef.current);
    setRecording(false);

    // Stop live visualizer intervals and disconnect nodes
    if (recordingVolumeIntervalRef.current) {
      clearInterval(recordingVolumeIntervalRef.current);
      recordingVolumeIntervalRef.current = null;
    }
    if (recordingAnalyserRef.current) {
      const { audioContext, source } = recordingAnalyserRef.current;
      try {
        source.disconnect();
        audioContext.close();
      } catch (e) {}
      recordingAnalyserRef.current = null;
    }

    if (shouldSend) {
      mediaRecorderRef.current.stop();
    } else {
      mediaRecorderRef.current.onstop = () => {
        const stream = mediaRecorderRef.current.stream;
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
      };
      mediaRecorderRef.current.stop();
    }
  };

  const handleAvatarUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target.result;
      setUserAvatar(base64);
      localStorage.setItem('savedAvatar', base64);
      if (socket && connected) {
        socket.emit('update_avatar', base64);
      }
    };
    reader.readAsDataURL(file);
  };

  const connect = async (e) => {
    e.preventDefault();
    const savedUser = localStorage.getItem('savedUsername');
    const nameToUse = (savedUser && !isChangingAccount) ? savedUser : username;

    if (!nameToUse || !serverIp) return;

    // Show connecting state immediately
    setConnectionStatus('connecting');
    setConnectionError('');

    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    if (socket) {
      socket.disconnect();
    }

    setUsername(nameToUse);

    // Health check — verify server is reachable before opening socket
    try {
      const controller = new AbortController();
      const healthTimeout = setTimeout(() => controller.abort(), 8000);
      const healthRes = await fetch(`http://${serverIp}:3001/health`, { signal: controller.signal });
      clearTimeout(healthTimeout);
      if (!healthRes.ok) throw new Error('Server returned error');
    } catch (err) {
      setConnectionStatus('error');
      if (err.name === 'AbortError') {
        setConnectionError('Сервер не отвечает. Проверь IP адрес и убедись что сервер запущен.');
      } else {
        setConnectionError(`Не удалось связаться с сервером (${serverIp}:3001). Проверь: 1) IP адрес правильный 2) Сервер запущен 3) Вы в одной сети Radmin VPN`);
      }
      return;
    }

    const newSocket = io(`http://${serverIp}:3001`, {
      transports: ['websocket', 'polling'], // Prefer websocket, fallback to polling
      timeout: 15000,           // 15s connection timeout
      reconnectionAttempts: 5,  // Don't retry forever
      reconnectionDelay: 2000,  // 2s between retries
      forceNew: true            // Always create fresh connection
    });
    socketRef.current = newSocket;
    setSocket(newSocket);
    
    // Connection timeout — if socket doesn't connect in 15s, show error
    const connectTimeout = setTimeout(() => {
      if (!newSocket.connected) {
        newSocket.disconnect();
        setConnectionStatus('error');
        setConnectionError('Таймаут подключения. Сервер доступен, но WebSocket не смог подключиться. Возможно блокирует брандмауэр.');
      }
    }, 15000);

    newSocket.on('connect', () => {
      clearTimeout(connectTimeout);
      newSocket.emit('login', { username: nameToUse, avatar: userAvatar }, (res) => {
        if (res && res.success) {
          localStorage.setItem('savedUsername', nameToUse);
          localStorage.setItem('savedServerIp', serverIp);
          
          // Decrypt historical messages
          const decryptedChats = (res.chats || []).map(chat => ({
            ...chat,
            messages: (chat.messages || []).map(msg => ({
              ...msg,
              text: decryptMessage(msg.text, chat.id),
              fileUrl: msg.fileUrl ? decryptMessage(msg.fileUrl, chat.id) : null,
              fileName: msg.fileName ? decryptMessage(msg.fileName, chat.id) : null
            }))
          }));

          setConnected(true);
          setConnectionStatus('connected');
          setChats(decryptedChats);
          
          const uniqueOnlineUsers = [];
          const seenUsers = new Set();
          for (const u of (res.onlineUsers || [])) {
            if (!seenUsers.has(u.username)) {
              seenUsers.add(u.username);
              uniqueOnlineUsers.push(u);
            }
          }
          setOnlineUsers(uniqueOnlineUsers);
        } else {
          setConnectionStatus('error');
          setConnectionError('Сервер отклонил авторизацию.');
        }
      });
    });

    newSocket.on('connect_error', (err) => {
      clearTimeout(connectTimeout);
      console.error('Socket connect_error:', err.message);
      setConnectionStatus('error');
      setConnectionError(`Ошибка подключения: ${err.message}. Проверь IP адрес и брандмауэр.`);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setConnected(false);
      setConnectionStatus('idle');
      setSocket(null);
      socketRef.current = null;
      setVoiceUsers([]);
      setInVoice(false);
      setActiveCallChatId(null);
    });

    newSocket.on('chat_message', ({ chatId, message }) => {
      const decryptedMsg = {
        ...message,
        text: decryptMessage(message.text, chatId),
        fileUrl: message.fileUrl ? decryptMessage(message.fileUrl, chatId) : null,
        fileName: message.fileName ? decryptMessage(message.fileName, chatId) : null
      };
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: [...c.messages, decryptedMsg] } : c));
      
      if (message.sender !== nameToUse) {
        playMessageSound();
      }
    });

    newSocket.on('chat_created', (newChat) => {
      setChats(prev => {
        if (prev.some(c => c.id === newChat.id)) return prev;
        return [...prev, newChat];
      });
    });

    newSocket.on('user_joined', (user) => {
      setOnlineUsers(prev => {
        if (prev.some(u => u.username === user.username)) {
          return prev.map(u => u.username === user.username ? { ...u, socketId: user.socketId, avatar: user.avatar } : u);
        }
        return [...prev, user];
      });
    });

    newSocket.on('user_left', (user) => {
      setOnlineUsers(prev => prev.filter(u => u.username !== user.username));
    });

    newSocket.on('user_avatar_updated', ({ username: targetUser, avatar: newAvatar }) => {
      setOnlineUsers(prev => prev.map(u => u.username === targetUser ? { ...u, avatar: newAvatar } : u));
      setShowProfile(prev => (prev && prev.username === targetUser) ? { ...prev, avatar: newAvatar } : prev);
    });

    // WebRTC Signaling Handlers
    newSocket.on('voice_users', async (users) => {
      const initializedUsers = users.map(u => ({ ...u, volume: 1.0, stream: null }));
      setVoiceUsers(initializedUsers);
      for (const user of initializedUsers) {
        await createPeerConnection(user.id, true, newSocket);
      }
    });

    newSocket.on('user_joined_voice', (user) => {
      playUserJoinSound();
      setVoiceUsers(prev => [...prev, { id: user.socketId, username: user.username, isMuted: user.isMuted, isDeafened: user.isDeafened, volume: 1.0, stream: null }]);
    });
    
    newSocket.on('user_voice_status', (data) => {
      setVoiceUsers(prev => prev.map(u => u.id === data.socketId ? { ...u, isMuted: data.isMuted, isDeafened: data.isDeafened } : u));
    });

    newSocket.on('user_left_voice', (socketId) => {
      playUserLeaveSound();
      setVoiceUsers(prev => prev.filter(u => u.id !== socketId));
      if (peersRef.current[socketId]) {
        peersRef.current[socketId].close();
        delete peersRef.current[socketId];
      }
      if (videoSendersRef.current[socketId]) {
        delete videoSendersRef.current[socketId];
      }
      if (webcamSendersRef.current[socketId]) {
        delete webcamSendersRef.current[socketId];
      }
      setFocusedUserId(prev => prev === socketId ? null : prev);
    });

    newSocket.on('activity_updated', (data) => {
      setActiveActivity(data);
      if (data && data.type) {
        setFocusedUserId('activity');
      } else {
        setFocusedUserId(prev => prev === 'activity' ? null : prev);
      }
    });

    newSocket.on('webrtc_offer', async ({ caller, sdp }) => {
      const pc = await createPeerConnection(caller, false, newSocket);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      newSocket.emit('webrtc_answer', { target: caller, sdp: answer });
    });

    newSocket.on('webrtc_answer', async ({ caller, sdp }) => {
      const pc = peersRef.current[caller];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    });

    newSocket.on('webrtc_ice_candidate', async ({ caller, candidate }) => {
      const pc = peersRef.current[caller];
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    newSocket.on('incoming_call', ({ chatId, callerUsername }) => {
      setIncomingCall({ chatId, callerUsername });
      playIncomingRingtone();
    });

    newSocket.on('call_accepted', ({ chatId, answererUsername }) => {
      setOutgoingCall(null);
      stopRingtone();
      startVoiceCall(chatId);
    });

    newSocket.on('call_declined', ({ chatId }) => {
      setOutgoingCall(null);
      stopRingtone();
      alert('Звонок отклонен пользователем.');
    });

    newSocket.on('call_cancelled', ({ chatId }) => {
      setIncomingCall(null);
      stopRingtone();
    });

    setSocket(newSocket);
  };

  const createPeerConnection = async (targetId, isOffer, socketInstance) => {
    const existing = peersRef.current[targetId];
    if (existing) {
      return existing;
    }

    const pc = new RTCPeerConnection({
      iceServers: [ { urls: 'stun:stun.l.google.com:19302' } ]
    });

    peersRef.current[targetId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => {
        const sender = pc.addTrack(track, screenStreamRef.current);
        if (track.kind === 'video') {
          videoSendersRef.current[targetId] = sender;
        } else if (track.kind === 'audio') {
          screenAudioSendersRef.current[targetId] = sender;
        }
      });
    }

    if (webcamStreamRef.current) {
      webcamStreamRef.current.getVideoTracks().forEach(track => {
        const sender = pc.addTrack(track, webcamStreamRef.current);
        webcamSendersRef.current[targetId] = sender;
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketInstance.emit('webrtc_ice_candidate', { target: targetId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      const track = event.track;
      console.log(`Track received from ${targetId}: ${track.kind}`);

      const handleTrackChange = () => {
        setVoiceUsers(prev => {
          const userExists = prev.some(u => u.id === targetId);
          if (!userExists) return prev;

          return prev.map(u => {
            if (u.id === targetId) {
              const newStream = new MediaStream();
              if (u.stream) {
                u.stream.getTracks().forEach(t => {
                  if (t.readyState !== 'ended') {
                    newStream.addTrack(t);
                  }
                });
              }
              if (!newStream.getTracks().some(t => t.id === track.id) && track.readyState !== 'ended') {
                newStream.addTrack(track);
              }
              return { ...u, stream: newStream };
            }
            return u;
          });
        });
      };

      track.onmute = handleTrackChange;
      track.onunmute = handleTrackChange;
      track.onended = handleTrackChange;

      handleTrackChange();
    };

    if (isOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketInstance.emit('webrtc_offer', { target: targetId, sdp: offer });
    }

    return pc;
  };

  const renegotiate = async (targetId, socketInstance) => {
    const pc = peersRef.current[targetId];
    if (!pc) return;
    if (pc.signalingState !== 'stable') return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketInstance.emit('webrtc_offer', { target: targetId, sdp: offer });
    } catch (e) {
      console.warn('Renegotiation failed for', targetId, e);
    }
  };

  const startVoiceCall = async (chatId) => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Камера/микрофон заблокированы. Убедитесь, что используете приложение.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedInput && selectedInput !== 'default' ? { exact: selectedInput } : undefined,
          noiseSuppression: noiseSuppression,
          echoCancellation: noiseSuppression,
          autoGainControl: noiseSuppression
        }
      });
      
      if (isMuted || isDeafened) {
        stream.getAudioTracks().forEach(t => t.enabled = false);
      }
      
      localStreamRef.current = stream;
      setLocalStream(stream);
      setInVoice(true);
      setActiveCallChatId(chatId);
      setShowVoiceStage(true); // Automatically show call screen
      playConnectSound();
      
      const activeSocket = socketRef.current || socket;
      if (activeSocket) {
        activeSocket.emit('join_voice', { roomId: chatId, isMuted: (isMuted || isDeafened), isDeafened });
      }
    } catch (err) {
      console.error('Error starting voice call:', err);
      alert('Could not access microphone.');
    }
  };

  const endVoiceCall = () => {
    const activeSocket = socketRef.current || socket;
    if (activeSocket) {
      activeSocket.emit('leave_voice');
    }
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('close-tiktok-window');
    }
    playDisconnectSound();
    setInVoice(false);
    setActiveCallChatId(null);
    setShowVoiceStage(false);
    setVoiceUsers([]);
    setFocusedUserId(null);
    setActiveActivity({ type: null, state: null });
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
      setIsSharingScreen(false);
    }
    setScreenStream(null);
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
      setIsSharingWebcam(false);
    }
    setWebcamStream(null);
    Object.values(peersRef.current).forEach(pc => pc.close());
    peersRef.current = {};
    videoSendersRef.current = {};
    screenAudioSendersRef.current = {};
    webcamSendersRef.current = {};
  };

  const handleCallClick = (chatId) => {
    if (activeChat && activeChat.type === 'dm') {
      if (inVoice) {
        if (activeCallChatId === chatId) {
          setShowVoiceStage(!showVoiceStage);
        } else {
          endVoiceCall();
          startVoiceCall(chatId);
        }
      } else {
        const partnerName = getChatName(activeChat);
        socket.emit('initiate_call', { chatId, targetUsername: partnerName });
        setOutgoingCall({ chatId, targetUsername: partnerName });
        playOutgoingRingtone();
      }
    } else {
      if (inVoice) {
        if (activeCallChatId === chatId) {
          setShowVoiceStage(!showVoiceStage);
        } else {
          endVoiceCall();
          startVoiceCall(chatId);
        }
      } else {
        startVoiceCall(chatId);
      }
    }
  };

  const openScreenPicker = async () => {
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      const sources = await ipcRenderer.invoke('get-screen-sources');
      setScreenSources(sources);
      setFailedThumbnails([]);
      if (sources.length > 0) {
        setSelectedSourceId(sources[0].id);
      }
      setShowScreenPicker(true);
    } else {
      alert('Захват экрана доступен только в настольном приложении.');
    }
  };

  const startScreenShare = async (sourceId, forceAudio = false) => {
    setShowScreenPicker(false);
    try {
      let videoConstraints = {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId
      };

      if (screenQuality !== 'original') {
        let maxWidth = 1280;
        let maxHeight = 720;
        let maxFrameRate = 30;

        if (screenQuality === '1080p') {
          maxWidth = 1920;
          maxHeight = 1080;
          maxFrameRate = 30;
        } else if (screenQuality === '720p') {
          maxWidth = 1280;
          maxHeight = 720;
          maxFrameRate = 30;
        } else if (screenQuality === '480p') {
          maxWidth = 854;
          maxHeight = 480;
          maxFrameRate = 30;
        } else if (screenQuality === '240p') {
          maxWidth = 426;
          maxHeight = 240;
          maxFrameRate = 15;
        }

        videoConstraints.maxWidth = maxWidth;
        videoConstraints.maxHeight = maxHeight;
        videoConstraints.maxFrameRate = maxFrameRate;
      } else {
        videoConstraints.maxFrameRate = 30;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: (shareScreenAudio || forceAudio) ? {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId
          }
        } : false,
        video: {
          mandatory: videoConstraints
        }
      });
      screenStreamRef.current = stream;
      setScreenStream(stream);
      setIsSharingScreen(true);

      // Add or replace both video and audio tracks on all peers
      stream.getTracks().forEach(async (track) => {
        for (const [targetId, pc] of Object.entries(peersRef.current)) {
          if (track.kind === 'video') {
            const existingSender = videoSendersRef.current[targetId];
            if (existingSender) {
              existingSender.replaceTrack(track).catch(e => console.warn('replaceTrack video failed', e));
            } else {
              const sender = pc.addTrack(track, screenStreamRef.current);
              videoSendersRef.current[targetId] = sender;
            }
          } else if (track.kind === 'audio') {
            const existingSender = screenAudioSendersRef.current[targetId];
            if (existingSender) {
              existingSender.replaceTrack(track).catch(e => console.warn('replaceTrack screen audio failed', e));
            } else {
              const sender = pc.addTrack(track, screenStreamRef.current);
              screenAudioSendersRef.current[targetId] = sender;
            }
          }
          await renegotiate(targetId, socket);
        }
      });

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }
    } catch (err) {
      console.error("Error starting screen share:", err);
      setIsSharingScreen(false);
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    setScreenStream(null);
    setIsSharingScreen(false);

    Object.entries(peersRef.current).forEach(([targetId, pc]) => {
      const vSender = videoSendersRef.current[targetId];
      if (vSender) {
        try {
          pc.removeTrack(vSender);
        } catch (e) {
          console.warn('removeTrack video failed', e);
        }
        delete videoSendersRef.current[targetId];
      }

      const aSender = screenAudioSendersRef.current[targetId];
      if (aSender) {
        try {
          pc.removeTrack(aSender);
        } catch (e) {
          console.warn('removeTrack screen audio failed', e);
        }
        delete screenAudioSendersRef.current[targetId];
      }

      renegotiate(targetId, socket);
    });
  };

  const startTikTokActivity = async () => {
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('open-tiktok-window');
      socket.emit('start_activity', { roomId: activeCallChatId, activityType: 'tiktok' });
      
      // Automatic capture delay to allow BrowserWindow to boot
      setTimeout(async () => {
        const sources = await ipcRenderer.invoke('get-screen-sources');
        const tiktokSource = sources.find(s => s.name.includes('TikTok') || s.name.includes('Telecord Activity'));
        if (tiktokSource) {
          startScreenShare(tiktokSource.id, true);
          setFocusedUserId('activity');
        } else {
          alert('Не удалось автоматически захватить окно TikTok. Пожалуйста, запустите трансляцию вручную через демонстрацию экрана.');
        }
      }, 1500);
    } else {
      alert('Активности доступны только в настольном приложении.');
    }
  };

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 30 }
      });
      webcamStreamRef.current = stream;
      setWebcamStream(stream);
      setIsSharingWebcam(true);

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        for (const [targetId, pc] of Object.entries(peersRef.current)) {
          const existingSender = webcamSendersRef.current[targetId];
          if (existingSender) {
            existingSender.replaceTrack(videoTrack).catch(e => console.warn('replaceTrack webcam failed', e));
          } else {
            const sender = pc.addTrack(videoTrack, webcamStreamRef.current);
            webcamSendersRef.current[targetId] = sender;
          }
          await renegotiate(targetId, socket);
        }
      }
    } catch (err) {
      console.error("Error starting webcam:", err);
      setIsSharingWebcam(false);
      alert("Не удалось запустить веб-камеру. Проверьте подключение.");
    }
  };

  const stopWebcam = () => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
    }
    setWebcamStream(null);
    setIsSharingWebcam(false);

    Object.entries(peersRef.current).forEach(async ([targetId, pc]) => {
      const sender = webcamSendersRef.current[targetId];
      if (sender) {
        try {
          pc.removeTrack(sender);
        } catch (e) {
          console.warn('removeTrack webcam failed', e);
        }
        delete webcamSendersRef.current[targetId];
      }
      await renegotiate(targetId, socket);
    });
  };

  const playOutgoingRingtone = () => {
    stopRingtone();
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ringtoneAudioCtxRef.current = ctx;
      
      const playBeep = () => {
        if (ctx.state === 'closed') return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 1.2);
      };

      playBeep();
      ringtoneIntervalRef.current = setInterval(playBeep, 2000);
    } catch (e) {}
  };

  const playIncomingRingtone = () => {
    stopRingtone();
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ringtoneAudioCtxRef.current = ctx;

      const playRing = () => {
        if (ctx.state === 'closed') return;
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(480, ctx.currentTime);
        gain1.gain.setValueAtTime(0.05, ctx.currentTime);
        gain1.gain.setValueAtTime(0.05, ctx.currentTime + 0.4);
        gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start();
        osc1.stop(ctx.currentTime + 0.8);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(440, ctx.currentTime);
        gain2.gain.setValueAtTime(0.05, ctx.currentTime);
        gain2.gain.setValueAtTime(0.05, ctx.currentTime + 0.4);
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start();
        osc2.stop(ctx.currentTime + 0.8);
      };

      playRing();
      ringtoneIntervalRef.current = setInterval(playRing, 2000);
    } catch (e) {}
  };

  const stopRingtone = () => {
    if (ringtoneIntervalRef.current) {
      clearInterval(ringtoneIntervalRef.current);
      ringtoneIntervalRef.current = null;
    }
    if (ringtoneAudioCtxRef.current) {
      ringtoneAudioCtxRef.current.close().catch(e => {});
      ringtoneAudioCtxRef.current = null;
    }
  };

  const acceptCall = () => {
    if (incomingCall && socket) {
      socket.emit('accept_call', { chatId: incomingCall.chatId, callerUsername: incomingCall.callerUsername });
      const targetChatId = incomingCall.chatId;
      setIncomingCall(null);
      stopRingtone();
      startVoiceCall(targetChatId);
    }
  };

  const declineCall = () => {
    if (incomingCall && socket) {
      socket.emit('decline_call', { chatId: incomingCall.chatId, callerUsername: incomingCall.callerUsername });
      setIncomingCall(null);
      stopRingtone();
    }
  };

  const cancelCall = () => {
    if (outgoingCall && socket) {
      socket.emit('cancel_call', { chatId: outgoingCall.chatId, targetUsername: outgoingCall.targetUsername });
      setOutgoingCall(null);
      stopRingtone();
    }
  };

  const handleVolumeChange = (targetId, newVol) => {
    setVoiceUsers(prev => prev.map(u => u.id === targetId ? { ...u, volume: newVol } : u));
  };

  const startPrivateDM = (targetUser) => {
    setShowProfile(null);
    socket.emit('get_or_create_dm', { targetUsername: targetUser }, (res) => {
      if (res.chatId) {
        setSelectedChatId(res.chatId);
      }
    });
  };

  const handleCreateGroupSubmit = () => {
    if (newGroupName.trim()) {
      socket.emit('create_group', { name: newGroupName.trim() }, (res) => {
        if (res.chatId) {
          setSelectedChatId(res.chatId);
          setNewGroupName('');
          setShowCreateGroup(false);
        }
      });
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Ограничение на размер файла: 14 МБ (согласно ограничению сервера на 20 млн символов base64)
    const MAX_SIZE = 14 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert("Файл слишком большой. Максимальный размер для отправки — 14 МБ.");
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      let fileType = 'file';
      if (file.type.startsWith('image/')) {
        fileType = 'image';
      } else if (file.type.startsWith('video/')) {
        fileType = 'video';
      }

      setAttachment({
        fileUrl: event.target.result,
        fileType,
        fileName: file.name
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if ((inputText.trim() || attachment) && socket && selectedChatId) {
      const encryptedText = encryptMessage(inputText.trim(), selectedChatId);
      const encryptedFileUrl = attachment ? encryptMessage(attachment.fileUrl, selectedChatId) : null;
      const encryptedFileName = attachment ? encryptMessage(attachment.fileName, selectedChatId) : null;

      socket.emit('chat_message', {
        chatId: selectedChatId,
        text: encryptedText,
        fileUrl: encryptedFileUrl,
        fileType: attachment ? attachment.fileType : null,
        fileName: encryptedFileName
      });
      setInputText('');
      setAttachment(null);
    }
  };

  // UI Setup
  const getChatName = (c) => {
    if (!c) return '';
    if (c.type === 'dm' && c.users) {
      return c.users.find(u => u !== username) || c.name;
    }
    return c.name;
  };

  const isTheaterMode = focusedUserId !== null && (focusedUserId === 'me' || voiceUsers.some(u => u.id === focusedUserId));

  const savedUser = localStorage.getItem('savedUsername');
  const savedAvatar = localStorage.getItem('savedAvatar');

  if (!connected) {
    return (
      <div className="login-screen">
        <div className="login-box">
          <div style={{ textAlign: 'center', marginBottom: '10px' }}>
            <img src="/logo.png" style={{width: '64px', height: '64px', borderRadius: '50%', marginBottom: '10px'}} alt="Logo" />
            <h1>Telecord</h1>
          </div>

          {/* Connection status and error banner */}
          {connectionStatus === 'connecting' && (
            <div style={{
              background: 'rgba(88, 101, 242, 0.15)',
              border: '1px solid rgba(88, 101, 242, 0.3)',
              color: '#5865F2',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              animation: 'pulse 1.5s infinite ease-in-out'
            }}>
              <div className="connection-spinner"></div>
              <span>Подключение к серверу...</span>
            </div>
          )}
          {connectionStatus === 'error' && connectionError && (
            <div style={{
              background: 'rgba(218, 55, 60, 0.15)',
              border: '1px solid rgba(218, 55, 60, 0.3)',
              color: '#f38080',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '13px',
              lineHeight: '1.4',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: '#ff4d4d' }}>
                <span>⚠️ Ошибка подключения</span>
              </div>
              <span style={{ fontSize: '12px' }}>{connectionError}</span>
            </div>
          )}

          {savedUser && !isChangingAccount ? (
            <form onSubmit={connect} style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.04)', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '18px', overflow: 'hidden' }}>
                  {savedAvatar ? <img src={savedAvatar} alt="avatar" style={{width:'100%', height:'100%', objectFit:'cover'}} /> : savedUser[0].toUpperCase()}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={{ fontWeight: '600', color: '#fff', fontSize: '14px' }}>{savedUser}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Вход сохранен</span>
                </div>
              </div>
              <div>
                <label style={{fontSize: '12px', color: 'var(--text-muted)'}}>IP сервера (Radmin VPN)</label>
                <input 
                  type="text" placeholder="например, 26.12.34.56 или localhost" value={serverIp} 
                  onChange={(e) => setServerIp(e.target.value)} required style={{width: '100%', marginTop: '5px'}}
                />
              </div>
              <button type="submit">Подключиться</button>
              <button type="button" style={{ background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', padding: '5px', border: 'none', cursor: 'pointer', fontWeight: 'normal', textDecoration: 'underline' }} onClick={() => setIsChangingAccount(true)}>
                Сменить аккаунт
              </button>
            </form>
          ) : (
            <form onSubmit={connect} style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
              <div>
                <label style={{fontSize: '12px', color: 'var(--text-muted)'}}>Имя пользователя</label>
                <input 
                  type="text" placeholder="Введите имя" value={username} 
                  onChange={(e) => setUsername(e.target.value)} required style={{width: '100%', marginTop: '5px'}}
                />
              </div>
              <div>
                <label style={{fontSize: '12px', color: 'var(--text-muted)'}}>IP сервера (Radmin VPN)</label>
                <input 
                  type="text" placeholder="например, 26.12.34.56 или localhost" value={serverIp} 
                  onChange={(e) => setServerIp(e.target.value)} required style={{width: '100%', marginTop: '5px'}}
                />
              </div>
              <button type="submit">Подключиться</button>
              {savedUser && (
                <button type="button" style={{ background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', padding: '5px', border: 'none', cursor: 'pointer', fontWeight: 'normal', textDecoration: 'underline' }} onClick={() => setIsChangingAccount(false)}>
                  Вернуться
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    );
  }

  // Filter chats by search query
  const filteredChats = chats.filter(c => {
    return getChatName(c).toLowerCase().includes(searchQuery.toLowerCase());
  });
  const activeChat = chats.find(c => c.id === selectedChatId);

  // Filter messages in selected chat based on header search query
  const displayedMessages = activeChat ? (activeChat.messages || []).filter(msg => {
    if (!headerSearchQuery.trim()) return true;
    return msg.text && msg.text.toLowerCase().includes(headerSearchQuery.toLowerCase());
  }) : [];

  // Self preview setup
  const localDisplayStream = isSharingScreen && screenStream
    ? screenStream
    : (isSharingWebcam && webcamStream ? webcamStream : localStream);
  const localHasVideo = (isSharingScreen && !!(screenStream?.getVideoTracks().length)) || (isSharingWebcam && !!(webcamStream?.getVideoTracks().length));

  return (
    <div className={`app-container ${isMidnightMode ? 'midnight-theme' : ''}`}>
      {/* Sliding Drawer Menu */}
      {showDrawer && (
        <div className="drawer-overlay" onClick={() => setShowDrawer(false)}>
          <div className="drawer-menu" onClick={e => e.stopPropagation()}>
            {/* Drawer Header */}
            <div className="drawer-header" onClick={() => {
              // Trigger avatar change
              document.getElementById('settings-avatar-file-input').click();
            }} title="Сменить аватар">
              <div className="drawer-avatar-wrapper">
                {userAvatar ? (
                  <img src={userAvatar} alt="avatar" className="drawer-avatar" />
                ) : (
                  <div className="drawer-avatar-text">{username ? username[0].toUpperCase() : '👤'}</div>
                )}
                <div className="drawer-avatar-hover-overlay">📷</div>
              </div>
              <div className="drawer-user-info">
                <span className="drawer-username">{username}</span>
                <span className="drawer-status">Сменить фото профиля</span>
              </div>
            </div>

            {/* Drawer Body / Menu Options */}
            <div className="drawer-body">
              <button className="drawer-menu-item" onClick={() => {
                setShowDrawer(false);
                setShowProfile({ username, avatar: userAvatar, self: true });
              }}>
                <span className="drawer-menu-icon">👤</span>
                <span className="drawer-menu-label">Мой профиль</span>
              </button>

              <button className="drawer-menu-item" onClick={() => {
                setShowDrawer(false);
                setShowCreateGroup(true);
              }}>
                <span className="drawer-menu-icon">👥</span>
                <span className="drawer-menu-label">Создать группу</span>
              </button>

              <button className="drawer-menu-item" onClick={() => {
                setShowDrawer(false);
                if (inVoice) {
                  setShowVoiceStage(true);
                } else {
                  alert("Вы не подключены к звонку. Зайдите в голосовой канал чата!");
                }
              }}>
                <span className="drawer-menu-icon">📞</span>
                <span className="drawer-menu-label">Звонки {inVoice && "• Активен"}</span>
              </button>

              <button className="drawer-menu-item" onClick={() => {
                setShowDrawer(false);
                setShowSettings(true);
              }}>
                <span className="drawer-menu-icon">⚙️</span>
                <span className="drawer-menu-label">Настройки</span>
              </button>

              <div className="drawer-menu-item drawer-menu-toggle">
                <span className="drawer-menu-icon">🌙</span>
                <span className="drawer-menu-label">Ночной режим</span>
                <label className="drawer-switch">
                  <input 
                    type="checkbox" 
                    checked={isMidnightMode} 
                    onChange={(e) => {
                      const val = e.target.checked;
                      setIsMidnightMode(val);
                      localStorage.setItem('midnightMode', val ? 'true' : 'false');
                      const newTheme = val ? 'midnight' : 'dark';
                      setThemeMode(newTheme);
                      localStorage.setItem('themeMode', newTheme);
                    }}
                  />
                  <span className="drawer-slider"></span>
                </label>
              </div>

              <div style={{ height: '1px', background: 'var(--border)', margin: '10px 0' }}></div>

              <button className="drawer-menu-item drawer-menu-logout" onClick={() => {
                setShowDrawer(false);
                if (socket) socket.disconnect();
              }}>
                <span className="drawer-menu-icon" style={{ color: 'var(--danger)' }}>🚪</span>
                <span className="drawer-menu-label" style={{ color: 'var(--danger)' }}>Выйти из аккаунта</span>
              </button>
            </div>

            {/* Drawer Footer */}
            <div className="drawer-footer">
              <span>Telecord Desktop</span>
              <span>Версия 1.0.3 — Параметры в норме</span>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar Panel */}
      <div className="sidebar" style={{ display: 'flex', flexDirection: 'row', width: '340px' }}>
        {/* Left Narrow Tabs Panel */}
        <div className="sidebar-nav-tabs">
          <button className="nav-tab-btn hamburger-btn" onClick={() => setShowDrawer(true)} title="Меню">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          </button>
          
          <button 
            className={`nav-tab-btn ${activeTab === 'chats' ? 'active' : ''}`} 
            onClick={() => setActiveTab('chats')} 
            title="Все чаты"
          >
            <div className="tab-icon-wrapper">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
              {chats.length > 0 && <span className="tab-badge">{chats.length}</span>}
            </div>
            <span className="nav-tab-label">Чаты</span>
          </button>
          
          <button 
            className={`nav-tab-btn ${activeTab === 'contacts' ? 'active' : ''}`} 
            onClick={() => setActiveTab('contacts')} 
            title="В сети"
          >
            <div className="tab-icon-wrapper">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              {onlineUsers.length > 0 && <span className="tab-badge">{onlineUsers.length}</span>}
            </div>
            <span className="nav-tab-label">В сети</span>
          </button>
          
          <button className="nav-tab-btn" onClick={() => setShowSettings(true)} title="Настройки">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            <span className="nav-tab-label">Настройки</span>
          </button>
          
          <button className="nav-tab-btn" onClick={() => setShowProfile({ username, avatar: userAvatar, self: true })} title="Мой профиль" style={{ marginTop: 'auto', marginBottom: '15px' }}>
            <div className="tab-avatar-wrapper">
              {userAvatar ? (
                <img src={userAvatar} alt="me" className="nav-tab-avatar" />
              ) : (
                <div className="nav-tab-avatar-text">{username ? username[0].toUpperCase() : '👤'}</div>
              )}
            </div>
            <span className="nav-tab-label">Профиль</span>
          </button>
        </div>

        {/* Right Sidebar Body */}
        <div className="sidebar-main-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Global Search and Chat Controls */}
          <div className="sidebar-search">
            <input 
              type="text" 
              placeholder="Поиск..." 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
              style={{ borderRadius: '8px' }}
            />
            <button className="create-group-btn" onClick={() => setShowCreateGroup(true)} title="Создать группу" style={{ borderRadius: '8px', minWidth: '32px' }}>+</button>
          </div>

          {activeTab === 'chats' ? (
            <>
              {/* Folder Tabs removed */}

              {/* Chats List */}
              <div className="sidebar-section-title" style={{ padding: '8px 15px 4px' }}>{appLanguage === 'ru' ? 'Чаты' : 'Chats'} ({filteredChats.length})</div>
              <div className="chats-list scrollable" style={{ flex: 1 }}>
                {filteredChats.map(chat => {
                  const isCallActive = inVoice && activeCallChatId === chat.id;
                  return (
                    <div 
                      key={chat.id} 
                      className={`chat-item ${selectedChatId === chat.id ? 'active' : ''}`}
                      onClick={() => setSelectedChatId(chat.id)}
                    >
                      <div className="chat-avatar">
                        {(() => {
                          if (chat.type === 'dm') {
                            const partnerName = getChatName(chat);
                            const partnerUser = onlineUsers.find(u => u.username === partnerName);
                            if (partnerUser && partnerUser.avatar) {
                              return <img src={partnerUser.avatar} alt="avatar" style={{width:'100%', height:'100%', borderRadius:'50%', objectFit:'cover'}} />;
                            }
                            return partnerName ? partnerName[0].toUpperCase() : '👤';
                          }
                          return '👥';
                        })()}
                      </div>
                      <div className="chat-info">
                        <div className="chat-name-row">
                          <span className="chat-name">{getChatName(chat)}</span>
                          {isCallActive && <span className="call-active-indicator" title="Активный звонок">🔊</span>}
                        </div>
                        <span className="chat-last-message">
                          {chat.messages && chat.messages.length > 0 
                            ? `${chat.messages[chat.messages.length - 1].sender}: ${chat.messages[chat.messages.length - 1].text}`
                            : 'Нет сообщений'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              {/* Online Users Contacts List */}
              <div className="sidebar-section-title" style={{ padding: '8px 15px 4px' }}>В сети ({onlineUsers.length})</div>
              <div className="contacts-list scrollable" style={{ flex: 1 }}>
                {onlineUsers.map(u => (
                  <div 
                    key={u.socketId} 
                    className="chat-item"
                    onClick={() => setShowProfile(u)}
                  >
                    <div className="chat-avatar">
                      {u.avatar ? (
                        <img src={u.avatar} alt={u.username} style={{width:'100%', height:'100%', borderRadius:'50%', objectFit:'cover'}} />
                      ) : (
                        u.username[0].toUpperCase()
                      )}
                    </div>
                    <div className="chat-info">
                      <span className="chat-name" style={{ fontWeight: 500 }}>{u.username} {u.username === username && '(Вы)'}</span>
                      <span className="chat-last-message" style={{ color: 'var(--success)' }}>● в сети</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Messaging Area */}
      {activeChat ? (
        <div className="main-chat-panel">
          {/* Chat Header */}
          <div className="chat-header discord-style-header">
            <div className="discord-header-left">
              <span className="discord-channel-icon">
                {activeChat.type === 'dm' ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"></path></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line></svg>
                )}
              </span>
              <h2 className="discord-channel-name">{getChatName(activeChat)}</h2>
              <div className="discord-header-divider"></div>
              <span className="discord-channel-description">
                {activeChat.type === 'dm' ? 'Личные сообщения' : 'Групповой чат'}
                {ping > 0 && <span className={`discord-ping-badge ${ping < 60 ? 'good' : ping < 150 ? 'warning' : 'poor'}`}>📶 {ping} ms</span>}
              </span>
            </div>

            <div className="discord-header-right">
              {/* Notification Bell */}
              <button 
                className={`discord-header-icon-btn ${mutedChats.includes(activeChat.id) ? 'muted' : ''}`}
                onClick={() => {
                  const updated = mutedChats.includes(activeChat.id)
                    ? mutedChats.filter(id => id !== activeChat.id)
                    : [...mutedChats, activeChat.id];
                  setMutedChats(updated);
                  localStorage.setItem('mutedChats', JSON.stringify(updated));
                }}
                title={mutedChats.includes(activeChat.id) ? 'Включить уведомления' : 'Заглушить канал'}
              >
                {mutedChats.includes(activeChat.id) ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"></path><path d="M18.63 13A17.89 17.89 0 0 1 18 8"></path><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"></path><path d="M18 8a6 6 0 0 0-9.33-5"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                )}
              </button>

              {/* Pin/Pinned Messages Toggle */}
              <div style={{ position: 'relative' }}>
                <button 
                  className={`discord-header-icon-btn ${showPinsPopup ? 'active' : ''}`}
                  onClick={() => setShowPinsPopup(!showPinsPopup)}
                  title="Закрепленные сообщения"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="8" x2="22" y2="12"></line><line x1="12" y1="2" x2="22" y2="12"></line><path d="M12 2 2 12h5l9 9v-5z"></path></svg>
                </button>
                {showPinsPopup && (
                  <div className="discord-pins-popup" onClick={e => e.stopPropagation()}>
                    <div className="pins-popup-header">
                      <h3>Закрепленные сообщения</h3>
                      <button onClick={() => setShowPinsPopup(false)}>✕</button>
                    </div>
                    <div className="pins-popup-body scrollable">
                      {(pinnedMessages[activeChat.id] || []).length > 0 ? (
                        (pinnedMessages[activeChat.id] || []).map((pMsg, idx) => (
                          <div className="pinned-message-popup-item" key={pMsg.id || idx}>
                            <div className="pinned-msg-meta">
                              <span className="pinned-msg-sender">{pMsg.sender}</span>
                              <span className="pinned-msg-time">
                                {new Date(pMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div className="pinned-msg-text">
                              {pMsg.text || (pMsg.fileType === 'image' ? '🖼️ Фото' : pMsg.fileType === 'video' ? '🎥 Видео' : pMsg.fileType === 'audio' ? '🎙️ Голосовое сообщение' : '📁 Файл')}
                            </div>
                            <button className="unpin-msg-btn" onClick={() => togglePinMessage(pMsg)} title="Открепить">✕</button>
                          </div>
                        ))
                      ) : (
                        <div className="pins-popup-empty">
                          <span style={{ fontSize: '32px' }}>📌</span>
                          <p>В этом чате пока нет закрепленных сообщений.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Voice Call Button */}
              <button 
                className={`discord-header-icon-btn call-btn-style ${inVoice && activeCallChatId === activeChat.id ? 'active-call' : ''}`}
                onClick={() => handleCallClick(activeChat.id)}
                title={inVoice && activeCallChatId === activeChat.id ? 'Управление звонком' : 'Начать звонок'}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
              </button>
            </div>
          </div>

          {/* Active call persistent bar (when call stage is hidden) */}
          {inVoice && !showVoiceStage && (
            <div className="active-call-bar" onClick={() => setShowVoiceStage(true)}>
              <div className="call-bar-left">
                <span className="pulse-dot"></span>
                <span>Вы подключены к звонку в чате <strong>{getChatName(chats.find(c => c.id === activeCallChatId))}</strong></span>
              </div>
              <div className="call-bar-actions" onClick={e => e.stopPropagation()}>
                <button className="mute-btn-small" onClick={() => setIsMuted(!isMuted)}>
                  {isMuted ? '🔇' : '🎙️'}
                </button>
                <button className="disconnect-btn-small" onClick={endVoiceCall}>
                  Отключиться
                </button>
              </div>
            </div>
          )}

          {/* Collapsible Voice Grid/Stage Overlay */}
          {inVoice && showVoiceStage && activeCallChatId === activeChat.id && (
            <div className="voice-stage overlay-stage">
              <div className="voice-stage-header">
                <div className="voice-stage-header-left">
                  <span className="voice-stage-title">📞 Звонок: {getChatName(activeChat)}</span>
                  <span className="voice-stage-subtitle">{1 + voiceUsers.length} участник(ов)</span>
                </div>
                <div className="voice-stage-header-actions">
                  {isTheaterMode && (
                    <button className="grid-view-btn" onClick={() => setFocusedUserId(null)} title="Вернуться к сетке">
                      🎚️ Режим сетки
                    </button>
                  )}
                  <button className="minimize-btn" onClick={() => setShowVoiceStage(false)} title="Свернуть в чат">💬 Свернуть</button>
                </div>
              </div>

              {isTheaterMode ? (
                <div className="voice-theater-layout">
                  {/* Large Main Viewport */}
                  <div className="voice-focused-main">
                    {focusedUserId === 'me' ? (
                      <VoiceUser
                        id="me" username={username}
                        stream={localDisplayStream}
                        isMe={true}
                        isMuted={isMuted || isDeafened} isDeafened={isDeafened}
                        forceVideo={localHasVideo}
                        isScreenShare={isSharingScreen}
                        onAvatarClick={() => setShowProfile({ username, socketId: 'me' })}
                        onFocusToggle={() => setFocusedUserId(null)}
                        isFocused={true}
                        avatar={userAvatar}
                      />
                    ) : focusedUserId === 'activity' ? (
                      <div 
                        className="voice-tile activity-tile focused"
                        style={{ width: '100%', height: '100%', border: 'none' }}
                      >
                        <div className="activity-tile-content" onClick={e => e.stopPropagation()}>
                          {activeActivity.type === 'tiktok' ? (
                            <TikTokActivityView 
                              activity={activeActivity} 
                              voiceUsers={voiceUsers} 
                              username={username}
                              localDisplayStream={localDisplayStream}
                              isSharingScreen={isSharingScreen}
                              onStop={() => {
                                socket.emit('stop_activity', { roomId: activeCallChatId });
                                if (activeActivity.state?.host === username) {
                                  stopScreenShare();
                                  if (window.require) {
                                    const { ipcRenderer } = window.require('electron');
                                    ipcRenderer.send('close-tiktok-window');
                                  }
                                }
                              }}
                            />
                          ) : (
                            <ActivityBoard 
                              activity={activeActivity} 
                              onMove={(move) => {
                                socket.emit('activity_move', { roomId: activeCallChatId, move });
                              }}
                              onStop={() => {
                                socket.emit('stop_activity', { roomId: activeCallChatId });
                              }}
                              isTheater={true}
                            />
                          )}
                        </div>
                      </div>
                    ) : (() => {
                      const fu = voiceUsers.find(u => u.id === focusedUserId);
                      if (!fu) return null;
                      const uData = onlineUsers.find(o => o.username === fu.username);
                      return (
                        <VoiceUser
                          key={fu.id} id={fu.id} username={fu.username} stream={fu.stream}
                          isMe={false} isMuted={fu.isMuted} isDeafened={fu.isDeafened}
                          volume={fu.volume} onVolumeChange={handleVolumeChange}
                          isScreenShare={fu.stream && fu.stream.getVideoTracks().some(t => t.enabled && t.readyState !== 'ended' && !t.muted)}
                          onAvatarClick={() => setShowProfile({ username: fu.username, socketId: fu.id, avatar: uData?.avatar })}
                          onFocusToggle={() => setFocusedUserId(null)}
                          isFocused={true}
                          avatar={uData?.avatar}
                        />
                      );
                    })()}
                  </div>

                  {/* Horizontal Strip of all participants */}
                  <div className="voice-focused-strip scrollable">
                    <VoiceUser
                      id="me" username={username}
                      stream={localDisplayStream}
                      isMe={true}
                      isMuted={isMuted || isDeafened} isDeafened={isDeafened}
                      forceVideo={localHasVideo}
                      isScreenShare={isSharingScreen}
                      onAvatarClick={() => setShowProfile({ username, socketId: 'me' })}
                      onFocusToggle={() => setFocusedUserId(focusedUserId === 'me' ? null : 'me')}
                      isFocused={focusedUserId === 'me'}
                      avatar={userAvatar}
                    />
                    {voiceUsers.map(user => {
                      const uData = onlineUsers.find(o => o.username === user.username);
                      return (
                        <VoiceUser
                          key={user.id} id={user.id} username={user.username} stream={user.stream}
                          isMe={false} isMuted={user.isMuted} isDeafened={user.isDeafened}
                          volume={user.volume} onVolumeChange={handleVolumeChange}
                          isScreenShare={user.stream && user.stream.getVideoTracks().some(t => t.enabled && t.readyState !== 'ended' && !t.muted)}
                          onAvatarClick={() => setShowProfile({ username: user.username, socketId: user.id, avatar: uData?.avatar })}
                          onFocusToggle={() => setFocusedUserId(focusedUserId === user.id ? null : user.id)}
                          isFocused={focusedUserId === user.id}
                          avatar={uData?.avatar}
                        />
                      );
                    })}
                    {activeActivity && activeActivity.type && (
                      <div 
                        className={`voice-tile activity-tile strip-tile ${focusedUserId === 'activity' ? 'focused' : ''}`}
                        onClick={() => setFocusedUserId(focusedUserId === 'activity' ? null : 'activity')}
                        style={{ minHeight: '80px', width: '120px', aspectRatio: '16/9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                      >
                        <div style={{ fontSize: '24px' }}>🎮</div>
                        <span style={{ fontSize: '11px', fontWeight: 'bold', marginTop: '4px' }}>Активность</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="voice-grid" style={{ '--tile-count': 1 + voiceUsers.length + (activeActivity?.type ? 1 : 0) }}>
                  <VoiceUser
                    id="me" username={username}
                    stream={localDisplayStream}
                    isMe={true}
                    isMuted={isMuted || isDeafened} isDeafened={isDeafened}
                    forceVideo={localHasVideo}
                    isScreenShare={isSharingScreen}
                    onAvatarClick={() => setShowProfile({ username, socketId: 'me' })}
                    onFocusToggle={() => setFocusedUserId(focusedUserId === 'me' ? null : 'me')}
                    isFocused={false}
                    avatar={userAvatar}
                  />
                  {voiceUsers.map(user => {
                    const uData = onlineUsers.find(o => o.username === user.username);
                    return (
                      <VoiceUser
                        key={user.id} id={user.id} username={user.username} stream={user.stream}
                        isMe={false} isMuted={user.isMuted} isDeafened={user.isDeafened}
                        volume={user.volume} onVolumeChange={handleVolumeChange}
                        isScreenShare={user.stream && user.stream.getVideoTracks().some(t => t.enabled && t.readyState !== 'ended' && !t.muted)}
                        onAvatarClick={() => setShowProfile({ username: user.username, socketId: user.id, avatar: uData?.avatar })}
                        onFocusToggle={() => setFocusedUserId(focusedUserId === user.id ? null : user.id)}
                        isFocused={false}
                        avatar={uData?.avatar}
                      />
                    );
                  })}
                  {activeActivity && activeActivity.type && (
                    <div 
                      className={`voice-tile activity-tile ${focusedUserId === 'activity' ? 'focused' : ''}`}
                      onClick={() => setFocusedUserId(focusedUserId === 'activity' ? null : 'activity')}
                    >
                      <div className="activity-tile-content" onClick={e => e.stopPropagation()}>
                        {activeActivity.type === 'tiktok' ? (
                          <TikTokActivityView 
                            activity={activeActivity} 
                            voiceUsers={voiceUsers} 
                            username={username}
                            localDisplayStream={localDisplayStream}
                            isSharingScreen={isSharingScreen}
                            onStop={() => {
                              socket.emit('stop_activity', { roomId: activeCallChatId });
                              if (activeActivity.state?.host === username) {
                                stopScreenShare();
                                if (window.require) {
                                  const { ipcRenderer } = window.require('electron');
                                  ipcRenderer.send('close-tiktok-window');
                                }
                              }
                            }}
                          />
                        ) : (
                          <ActivityBoard 
                            activity={activeActivity} 
                            onMove={(move) => {
                              socket.emit('activity_move', { roomId: activeCallChatId, move });
                            }}
                            onStop={() => {
                              socket.emit('stop_activity', { roomId: activeCallChatId });
                            }}
                            isTheater={false}
                          />
                        )}
                      </div>
                      <div className="tile-top-controls" onClick={e => e.stopPropagation()}>
                        <button 
                          className="tile-focus-btn" 
                          onClick={(e) => { e.stopPropagation(); setFocusedUserId(focusedUserId === 'activity' ? null : 'activity'); }} 
                          title={focusedUserId === 'activity' ? "Свернуть" : "Развернуть на весь экран"}
                        >
                          {focusedUserId === 'activity' ? '🗗' : '⛶'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="voice-controls-bar">
                <div className="voice-controls-self">
                  <div className={`avatar ${(!isMuted && !isDeafened) ? '' : 'muted'}`}>
                    {userAvatar ? (
                      <img src={userAvatar} alt="avatar" style={{width:'100%', height:'100%', borderRadius:'50%', objectFit:'cover'}} />
                    ) : (
                      username[0].toUpperCase()
                    )}
                  </div>
                  <div className="voice-controls-name">
                    <span className="vcn-name">{username}</span>
                    <span className="vcn-status">
                      {(isMuted || isDeafened) ? 'Выкл' : 'В эфире'}
                    </span>
                  </div>
                </div>

                <div className="voice-controls-buttons">
                  <button
                    className={`ctrl-btn ${isMuted ? 'on' : ''}`}
                    onClick={() => setIsMuted(!isMuted)}
                    title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
                  >
                    {isMuted ? '🔇' : '🎙️'}
                  </button>
                  <button
                    className={`ctrl-btn ${isDeafened ? 'on' : ''}`}
                    onClick={() => setIsDeafened(!isDeafened)}
                    title={isDeafened ? 'Включить звук' : 'Выключить звук'}
                  >
                    {isDeafened ? '🔕' : '🎧'}
                  </button>
                  <button
                    className={`ctrl-btn ${isSharingWebcam ? 'active-share' : ''}`}
                    onClick={isSharingWebcam ? stopWebcam : startWebcam}
                    title={isSharingWebcam ? 'Выключить камеру' : 'Включить камеру'}
                  >
                    📷
                  </button>
                  <button
                    className={`ctrl-btn ${isSharingScreen ? 'active-share' : ''}`}
                    onClick={isSharingScreen ? stopScreenShare : openScreenPicker}
                    title={isSharingScreen ? 'Остановить демонстрацию' : 'Демонстрация экрана'}
                  >
                    🖥️
                  </button>
                  <button
                    className="ctrl-btn"
                    onClick={() => setShowActivityPicker(true)}
                    title="Запустить активность"
                  >
                    🎮
                  </button>
                  <button
                    className="ctrl-btn danger"
                    onClick={endVoiceCall}
                    title="Положить трубку"
                  >
                    📞
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Messages Area (Telegram bubble styling) */}
          <div className="messages scrollable">
            {displayedMessages.map((msg, idx) => {
              const isOwn = msg.sender === username;
              const msgPinned = isPinned(msg);
              return (
                <div className={`message-bubble-row ${isOwn ? 'own' : 'other'}`} key={msg.id || idx}>
                  {!isOwn && (() => {
                    const uData = onlineUsers.find(u => u.username === msg.sender);
                    return (
                      <div 
                        className="message-avatar"
                        onClick={() => setShowProfile({ username: msg.sender, socketId: 'msg', avatar: uData?.avatar })}
                      >
                        {uData && uData.avatar ? (
                          <img src={uData.avatar} alt={msg.sender} style={{width:'100%', height:'100%', borderRadius:'50%', objectFit:'cover'}} />
                        ) : (
                          msg.sender[0].toUpperCase()
                        )}
                      </div>
                    );
                  })()}
                  <div className={`message-bubble ${msgPinned ? 'is-pinned-style' : ''}`}>
                    {!isOwn && <span className="message-sender-name">{msg.sender}</span>}
                    
                    {msg.fileUrl && (
                      msg.fileType === 'audio' ? (
                        <VoiceMessagePlayer src={msg.fileUrl} fileName={msg.fileName} msgId={msg.id} />
                      ) : (
                        <div className="message-media-container" onClick={() => setShowMediaViewer({
                          fileUrl: msg.fileUrl,
                          fileType: msg.fileType,
                          fileName: msg.fileName,
                          sender: msg.sender
                        })}>
                          {msg.fileType === 'image' ? (
                            <img src={msg.fileUrl} alt={msg.fileName} className="message-bubble-image" />
                          ) : msg.fileType === 'video' ? (
                            <div className="message-bubble-video-placeholder">
                              <video src={msg.fileUrl} className="message-bubble-video-preview" muted playsInline />
                              <div className="video-play-overlay-icon">▶</div>
                            </div>
                          ) : (
                            <div style={{ padding: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <span>📁</span>
                              <span style={{ fontSize: '13px', textDecoration: 'underline' }}>{msg.fileName}</span>
                            </div>
                          )}
                        </div>
                      )
                    )}

                    {msg.text && <div className="message-text">{msg.text}</div>}
                    
                    {msgPinned && (
                      <span className="pinned-indicator-tag" title="Закрепленное сообщение">📌</span>
                    )}

                    <span className="message-time-label">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>

                    {/* Hover Pin Action Button */}
                    <button 
                      className="message-pin-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePinMessage(msg);
                      }}
                      title={msgPinned ? "Открепить сообщение" : "Закрепить сообщение"}
                    >
                      📌
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Message Input Box */}
          <div className="chat-input-area" style={{ padding: 0 }}>
            {attachment && (
              <div className="attachment-preview-bar">
                <div className="attachment-preview-thumb-container">
                  {attachment.fileType === 'image' ? (
                    <img src={attachment.fileUrl} alt="preview" className="attachment-preview-thumb" />
                  ) : attachment.fileType === 'video' ? (
                    <video src={attachment.fileUrl} className="attachment-preview-thumb" muted />
                  ) : (
                    <span style={{ fontSize: '24px' }}>📁</span>
                  )}
                </div>
                <div className="attachment-preview-info">
                  <span className="attachment-preview-name">{attachment.fileName}</span>
                  <span className="attachment-preview-type">
                    {attachment.fileType === 'image' ? 'Изображение' : attachment.fileType === 'video' ? 'Видео' : 'Файл'}
                  </span>
                </div>
                <button type="button" className="attachment-preview-cancel-btn" onClick={() => setAttachment(null)}>
                  ✕
                </button>
              </div>
            )}
            {recording ? (
              <form onSubmit={(e) => { e.preventDefault(); stopRecording(true); }} className="chat-input-form" style={{ padding: '15px 20px' }}>
                <div className="voice-recording-panel">
                  <div className="recording-pulse-dot"></div>
                  <div className="recording-timer">
                    {(() => {
                      const m = Math.floor(recordingTime / 60);
                      const s = Math.floor(recordingTime % 60);
                      return `${m}:${s < 10 ? '0' : ''}${s}`;
                    })()}
                  </div>
                  <div className="recording-wave-container">
                    {(recordingWaveform.length > 0 ? recordingWaveform : Array(20).fill(4)).map((val, idx) => (
                      <div 
                        key={idx} 
                        className="recording-wave-bar" 
                        style={{ height: `${val}px` }} 
                      />
                    ))}
                  </div>
                  <button type="button" className="recording-cancel-btn" onClick={() => stopRecording(false)}>Отмена</button>
                  <button type="submit" className="send-msg-btn" title="Отправить голосовое сообщение">✈️</button>
                </div>
              </form>
            ) : (
              <form onSubmit={sendMessage} className="chat-input-form" style={{ padding: '15px 20px' }}>
                <input 
                  type="file" 
                  id="file-attachment-input" 
                  accept="image/*,video/*" 
                  onChange={handleFileChange} 
                  style={{ display: 'none' }} 
                />
                <button 
                  type="button" 
                  className="send-msg-btn" 
                  style={{ background: 'transparent', fontSize: '20px', width: 'auto', height: 'auto', padding: '0 5px', minWidth: '40px', boxShadow: 'none' }}
                  onClick={() => document.getElementById('file-attachment-input').click()}
                  title="Прикрепить файл"
                >
                  📎
                </button>
                <input 
                  type="text" 
                  placeholder="Напишите сообщение..." 
                  value={inputText} 
                  onChange={(e) => setInputText(e.target.value)} 
                  style={{ flex: 1 }}
                />
                {inputText.trim() || attachment ? (
                  <button type="submit" className="send-msg-btn" title="Отправить">✈️</button>
                ) : (
                  <button type="button" className="send-msg-btn" onClick={startRecording} title="Записать голосовое сообщение">🎙️</button>
                )}
              </form>
            )}
          </div>
        </div>
      ) : (
        <div className="no-chat-selected">
          <div className="empty-state-card">
            <img src="/logo.png" style={{width: '96px', height: '96px', borderRadius: '50%', marginBottom: '16px'}} alt="Logo" />
            <h3>Выберите чат, чтобы начать общение</h3>
          </div>
        </div>
      )}

      {/* Screen Capturer Source Selector Modal */}
      {showScreenPicker && (
        <div className="modal-overlay" onClick={() => setShowScreenPicker(false)}>
          <div className="modal-content screen-picker-modal" onClick={e => e.stopPropagation()}>
            <h2>Выбор экрана для демонстрации</h2>
            <div className="screen-sources-grid scrollable">
              {screenSources.map(source => {
                const hasFailed = failedThumbnails.includes(source.id);
                const isScreen = source.id.startsWith('screen');
                return (
                  <div 
                    key={source.id} 
                    className={`screen-source-card ${selectedSourceId === source.id ? 'selected' : ''}`}
                    onClick={() => setSelectedSourceId(source.id)}
                  >
                    <div className="source-thumbnail-container">
                      {!isScreen && (
                        <div className="source-window-header">
                          <div className="source-window-dots">
                            <span className="dot red"></span>
                            <span className="dot yellow"></span>
                            <span className="dot green"></span>
                          </div>
                          <span className="source-window-title">{source.name}</span>
                        </div>
                      )}
                      {!hasFailed && source.thumbnail ? (
                        <img 
                          src={source.thumbnail} 
                          alt={source.name} 
                          className="source-thumbnail" 
                          onError={() => setFailedThumbnails(prev => [...prev, source.id])}
                        />
                      ) : (
                        <div className="source-thumbnail-fallback">
                          <span className="fallback-icon">{isScreen ? '🖥️' : '🗖'}</span>
                        </div>
                      )}
                      {source.appIcon && <img src={source.appIcon} alt="app icon" className="source-app-icon" />}
                    </div>
                    <span className="source-name" title={source.name}>{source.name}</span>
                  </div>
                );
              })}
            </div>
            <div className="settings-group screen-quality-selector-group" style={{ marginTop: '15px' }}>
              <label style={{ fontWeight: '600', fontSize: '14px', color: 'var(--text-muted)', marginBottom: '5px', display: 'block' }}>Качество трансляции</label>
              <select
                value={screenQuality}
                onChange={e => setScreenQuality(e.target.value)}
                className="screen-quality-select"
                style={{
                  width: '100%',
                  background: 'var(--bg-dark)',
                  color: 'white',
                  border: '1px solid var(--border)',
                  padding: '10px',
                  borderRadius: '6px',
                  outline: 'none',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                <option value="original">Оригинальное (по монитору) — Рекомендуется</option>
                <option value="1080p">1080p (Full HD, 30 fps)</option>
                <option value="720p">720p (HD, 30 fps)</option>
                <option value="480p">480p (Среднее, 30 fps)</option>
                <option value="240p">240p (Низкое, 15 fps)</option>
              </select>
            </div>
            <div className="settings-group screen-audio-selector-group" style={{ marginTop: '15px', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="share-screen-audio-chk"
                checked={shareScreenAudio}
                onChange={e => setShareScreenAudio(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <label htmlFor="share-screen-audio-chk" style={{ fontWeight: '600', fontSize: '14px', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                Транслировать системный звук
              </label>
            </div>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setShowScreenPicker(false)}>Отмена</button>
              <button className="start-btn" onClick={() => startScreenShare(selectedSourceId)}>Начать трансляцию</button>
            </div>
          </div>
        </div>
      )}

      {/* Activity Selector Modal */}
      {showActivityPicker && (
        <div className="modal-overlay" onClick={() => setShowActivityPicker(false)}>
          <div className="modal-content activity-picker-modal" onClick={e => e.stopPropagation()}>
            <h2>Выберите активность</h2>
            <div className="activity-options-list">
              <div 
                className="activity-card"
                onClick={() => {
                  socket.emit('start_activity', { roomId: activeCallChatId, activityType: 'chess' });
                  setShowActivityPicker(false);
                  setFocusedUserId('activity');
                }}
              >
                <div className="activity-icon">♟️</div>
                <div className="activity-info">
                  <span className="activity-title">Шахматы</span>
                  <span className="activity-description">Сыграйте в классические шахматы с друзьями.</span>
                </div>
              </div>
              
              <div 
                className="activity-card"
                onClick={() => {
                  socket.emit('start_activity', { roomId: activeCallChatId, activityType: 'checkers' });
                  setShowActivityPicker(false);
                  setFocusedUserId('activity');
                }}
              >
                <div className="activity-icon">🔴</div>
                <div className="activity-info">
                  <span className="activity-title">Русские шашки</span>
                  <span className="activity-description">Двигайтесь по диагонали и бейте шашки противника!</span>
                </div>
              </div>

              <div 
                className="activity-card"
                onClick={() => {
                  startTikTokActivity();
                  setShowActivityPicker(false);
                }}
              >
                <div className="activity-icon">🎵</div>
                <div className="activity-info">
                  <span className="activity-title">Совместный TikTok</span>
                  <span className="activity-description">Смотрите TikTok вместе! Ведущий листает ленту, остальные смотрят.</span>
                </div>
              </div>
            </div>
            <div className="modal-actions" style={{ marginTop: '10px' }}>
              <button className="cancel-btn" onClick={() => setShowActivityPicker(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* Group Chat Creation Modal */}
      {showCreateGroup && (
        <div className="modal-overlay" onClick={() => setShowCreateGroup(false)}>
          <div className="modal-content create-group-modal" onClick={e => e.stopPropagation()}>
            <h2>Создать групповой чат</h2>
            <div className="settings-group">
              <label>Название группы</label>
              <input 
                type="text" 
                placeholder="Введите название" 
                value={newGroupName} 
                onChange={e => setNewGroupName(e.target.value)} 
                required 
              />
            </div>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setShowCreateGroup(false)}>Отмена</button>
              <button className="start-btn" onClick={handleCreateGroupSubmit}>Создать</button>
            </div>
          </div>
        </div>
      )}

      {/* Mini-Profile Modal Card */}
      {showProfile && (
        <div className="modal-overlay" onClick={() => setShowProfile(null)}>
          <div className="modal-content profile-modal" onClick={e => e.stopPropagation()}>
            <div className="profile-header">
              <div className="profile-avatar">
                {showProfile.avatar ? (
                  <img src={showProfile.avatar} alt={showProfile.username} style={{width:'100%', height:'100%', borderRadius:'50%', objectFit:'cover'}} />
                ) : (
                  showProfile.username[0].toUpperCase()
                )}
              </div>
              <h2>{showProfile.username}</h2>
              <span className="profile-status">
                {onlineUsers.some(u => u.username === showProfile.username) || showProfile.username === username ? '🟢 В сети' : '⚫ Не в сети'}
              </span>
            </div>
            <div className="profile-details">
              <div className="detail-item">
                <span className="detail-label">Имя пользователя:</span>
                <span className="detail-value">@{showProfile.username.toLowerCase()}</span>
              </div>
            </div>
            <div className="profile-actions">
              {showProfile.username !== username && (
                <button className="start-dm-btn" onClick={() => startPrivateDM(showProfile.username)}>
                  💬 Начать диалог
                </button>
              )}
              <button className="close-profile-btn" onClick={() => setShowProfile(null)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {/* Voice Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content settings-telegram-modal" onClick={e => e.stopPropagation()} style={{ width: '420px', height: '650px', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: '12px' }}>
            
            {activeSettingsSubmenu === null ? (
              /* --- Main Settings Panel --- */
              <div className="settings-main-menu" style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
                {/* Header */}
                <div className="settings-header" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '18px', fontWeight: 'bold', fontFamily: 'Outfit' }}>{appLanguage === 'ru' ? 'Настройки' : 'Settings'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button className="settings-header-icon-btn" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px' }} title={appLanguage === 'ru' ? 'Поиск' : 'Search'}>🔍</button>
                    <button className="settings-header-icon-btn" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px' }} title={appLanguage === 'ru' ? 'Опции' : 'Options'}>⋮</button>
                    <button className="settings-close-x" onClick={() => setShowSettings(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '16px', cursor: 'pointer', padding: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  </div>
                </div>

                {/* Body Content - Scrollable */}
                <div className="settings-body scrollable" style={{ flex: 1, overflowY: 'auto' }}>
                  {/* Profile Section */}
                  <div className="settings-profile-header-new" onClick={() => document.getElementById('settings-avatar-file-input').click()} style={{ padding: '16px', display: 'flex', gap: '16px', alignItems: 'center', cursor: 'pointer', borderBottom: '1px solid var(--border)' }} title={appLanguage === 'ru' ? 'Сменить аватар' : 'Change Avatar'}>
                    <div className="settings-avatar-container" style={{ width: '64px', height: '64px', borderRadius: '50%', overflow: 'hidden', position: 'relative', background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {userAvatar ? (
                        <img src={userAvatar} alt="avatar" className="settings-pane-avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div className="settings-pane-avatar-text" style={{ fontSize: '24px', fontWeight: '800', color: '#fff', fontFamily: 'Outfit' }}>{username ? username[0].toUpperCase() : '👤'}</div>
                      )}
                      <div className="settings-avatar-overlay" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px', opacity: 0, transition: 'opacity 0.2s' }}>📷</div>
                    </div>
                    <div className="settings-header-user-info" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      <span className="settings-pane-username" style={{ fontWeight: '700', fontSize: '16px', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{username}</span>
                      <span className="settings-pane-phone" style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>{userPhone}</span>
                      <span className="settings-pane-nickname" style={{ fontSize: '12px', color: 'var(--primary)', marginTop: '2px', fontWeight: '600' }}>{userNickname}</span>
                    </div>
                    <input 
                      type="file" 
                      id="settings-avatar-file-input" 
                      accept="image/*" 
                      style={{display: 'none'}} 
                      onChange={handleAvatarUpload} 
                    />
                  </div>

                  {/* Phone confirmation banner */}
                  {!phoneConfirmed && (
                    <div className="settings-number-confirm-box" style={{ background: 'var(--primary-glow)', borderBottom: '1px solid var(--border)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--primary)' }}>
                        {userPhone} {appLanguage === 'ru' ? 'всё ещё Ваш номер?' : 'still your number?'}
                      </span>
                      <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-main)', lineHeight: '1.4' }}>
                        {appLanguage === 'ru' 
                          ? 'Чтобы Вы всегда могли зайти в Telecord, важно указать актуальный номер телефона.'
                          : 'To ensure you can always access Telecord, it is important to keep your phone number up to date.'}
                      </p>
                      <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                        <button onClick={() => {
                          setPhoneConfirmed(true);
                          localStorage.setItem('phoneConfirmed', 'true');
                        }} style={{ padding: '6px 16px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', fontWeight: 'bold' }}>
                          {appLanguage === 'ru' ? 'Да' : 'Yes'}
                        </button>
                        <button onClick={() => {
                          setActiveSettingsSubmenu('account');
                        }} style={{ padding: '6px 16px', background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', fontWeight: 'bold' }}>
                          {appLanguage === 'ru' ? 'Нет' : 'No'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Settings Category Links */}
                  <div className="settings-list-section" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <button className="settings-list-item-row" onClick={() => setActiveSettingsSubmenu('account')}>
                      <span className="settings-list-item-icon">👤</span>
                      <span className="settings-list-item-label">
                        {appLanguage === 'ru' ? 'Мой аккаунт' : appLanguage === 'ua' ? 'Мій акаунт' : 'My Account'}
                      </span>
                    </button>
                    <button className="settings-list-item-row" onClick={() => setActiveSettingsSubmenu('sounds')}>
                      <span className="settings-list-item-icon">🔔</span>
                      <span className="settings-list-item-label">
                        {appLanguage === 'ru' ? 'Уведомления и звуки' : appLanguage === 'ua' ? 'Сповіщення та звуки' : 'Notifications & Sounds'}
                      </span>
                    </button>
                    <button className="settings-list-item-row" onClick={() => setActiveSettingsSubmenu('chats')}>
                      <span className="settings-list-item-icon">💬</span>
                      <span className="settings-list-item-label">
                        {appLanguage === 'ru' ? 'Настройки чатов' : appLanguage === 'ua' ? 'Налаштування чатів' : 'Chat Settings'}
                      </span>
                    </button>
                    <button className="settings-list-item-row" onClick={() => setActiveSettingsSubmenu('advanced')}>
                      <span className="settings-list-item-icon">⚙️</span>
                      <span className="settings-list-item-label">
                        {appLanguage === 'ru' ? 'Продвинутые настройки' : appLanguage === 'ua' ? 'Додаткові налаштування' : 'Advanced'}
                      </span>
                    </button>
                    <button className="settings-list-item-row" onClick={() => setActiveSettingsSubmenu('audio')}>
                      <span className="settings-list-item-icon">🔊</span>
                      <span className="settings-list-item-label">
                        {appLanguage === 'ru' ? 'Звук и камера' : appLanguage === 'ua' ? 'Звук та камера' : 'Sound & Camera'}
                      </span>
                    </button>
                    <button className="settings-list-item-row" onClick={() => setActiveSettingsSubmenu('language')}>
                      <span className="settings-list-item-icon">🌐</span>
                      <div style={{ display: 'flex', justifyContent: 'space-between', flex: 1, alignItems: 'center' }}>
                        <span className="settings-list-item-label">
                          {appLanguage === 'ru' ? 'Язык' : appLanguage === 'ua' ? 'Мова' : 'Language'}
                        </span>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginRight: '16px' }}>
                          {appLanguage === 'ru' ? 'Русский' : appLanguage === 'ua' ? 'Українська' : 'English'}
                        </span>
                      </div>
                    </button>
                  </div>

                  {/* Scale block */}
                  <div className="settings-list-section" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '18px' }}>👁️</span>
                      <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{appLanguage === 'ru' ? 'Масштаб по умолчанию' : 'Default Scale'}</span>
                      <span style={{ fontSize: '12px', color: 'var(--primary)', marginLeft: 'auto', fontWeight: 'bold' }}>{zoomLevel}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="100" 
                      max="150" 
                      step="10" 
                      value={zoomLevel} 
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setZoomLevel(val);
                        localStorage.setItem('zoomLevel', val);
                        applyThemeCustomization(accentColor, accentGradient, isMidnightMode, themeMode, val, enableAnimations, customPrimaryColor, customGradientColor2);
                      }}
                      style={{ width: '100%', cursor: 'pointer' }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              /* --- Submenu Panel --- */
              <div className="settings-submenu-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
                {/* Header */}
                <div className="settings-header" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                  <button className="settings-back-btn" onClick={() => setActiveSettingsSubmenu(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', fontSize: '18px', cursor: 'pointer', marginRight: '16px', padding: '4px' }}>←</button>
                  <span style={{ fontSize: '16px', fontWeight: 'bold', fontFamily: 'Outfit', flex: 1 }}>
                    {activeSettingsSubmenu === 'account' && (appLanguage === 'ru' ? 'Мой аккаунт' : appLanguage === 'ua' ? 'Мій акаунт' : 'My Account')}
                    {activeSettingsSubmenu === 'sounds' && (appLanguage === 'ru' ? 'Уведомления и звуки' : appLanguage === 'ua' ? 'Сповіщення та звуки' : 'Notifications & Sounds')}
                    {activeSettingsSubmenu === 'chats' && (appLanguage === 'ru' ? 'Настройки чатов' : appLanguage === 'ua' ? 'Налаштування чатів' : 'Chat Settings')}
                    {activeSettingsSubmenu === 'advanced' && (appLanguage === 'ru' ? 'Продвинутые настройки' : appLanguage === 'ua' ? 'Додаткові налаштування' : 'Advanced')}
                    {activeSettingsSubmenu === 'audio' && (appLanguage === 'ru' ? 'Звук и камера' : appLanguage === 'ua' ? 'Звук та камера' : 'Sound & Camera')}
                    {activeSettingsSubmenu === 'language' && (appLanguage === 'ru' ? 'Язык' : appLanguage === 'ua' ? 'Мова' : 'Language')}
                  </span>
                  <button className="settings-close-x" onClick={() => setShowSettings(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '16px', cursor: 'pointer', padding: '5px' }}>✕</button>
                </div>

                {/* Submenu Body - Scrollable */}
                <div className="settings-submenu-body scrollable" style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
                  
                  {/* Submenu 1: Account */}
                  {activeSettingsSubmenu === 'account' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', padding: '10px 0' }}>
                      <div className="settings-avatar-container" onClick={() => document.getElementById('settings-avatar-file-input-sub').click()} style={{ width: '80px', height: '80px', borderRadius: '50%', overflow: 'hidden', position: 'relative', background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} title={appLanguage === 'ru' ? 'Сменить аватар' : 'Change Avatar'}>
                        {userAvatar ? (
                          <img src={userAvatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ fontSize: '32px', fontWeight: '800', color: '#fff', fontFamily: 'Outfit' }}>{username ? username[0].toUpperCase() : '👤'}</div>
                        )}
                        <div className="settings-avatar-overlay" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '18px', opacity: 0, transition: 'opacity 0.2s' }}>📷</div>
                      </div>
                      <input 
                        type="file" 
                        id="settings-avatar-file-input-sub" 
                        accept="image/*" 
                        style={{display: 'none'}} 
                        onChange={handleAvatarUpload} 
                      />
                      
                      <div style={{ textAlign: 'center', width: '100%' }}>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-main)', marginBottom: '4px' }}>{username}</div>
                        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{appLanguage === 'ru' ? 'Имя вашего профиля' : 'Profile display name'}</div>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '10px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', width: '100%', marginTop: '10px' }}>
                        <span style={{ fontSize: '16px' }}>ℹ️</span>
                        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                          {appLanguage === 'ru' 
                            ? 'Вы можете сменить свой аватар профиля, нажав на фото выше.'
                            : 'You can change your profile avatar by clicking on the image above.'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Submenu 2: Sounds */}
                  {activeSettingsSubmenu === 'sounds' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div className="settings-group row-group">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button onClick={playConnectSound} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '14px', padding: 0 }} title="Тест">🔊</button>
                          <label style={{ margin: 0 }}>{appLanguage === 'ru' ? 'Звук подключения к серверу' : 'Server Connection Sound'}</label>
                        </div>
                        <label className="drawer-switch">
                          <input 
                            type="checkbox" 
                            checked={enableConnectSound} 
                            onChange={e => {
                              setEnableConnectSound(e.target.checked);
                              localStorage.setItem('soundConnect', e.target.checked ? 'true' : 'false');
                            }}
                          />
                          <span className="drawer-slider"></span>
                        </label>
                      </div>
                      <div className="settings-group row-group">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button onClick={playUserJoinSound} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '14px', padding: 0 }} title="Тест">🔊</button>
                          <label style={{ margin: 0 }}>{appLanguage === 'ru' ? 'Звук подключения к звонку' : 'User Join Call Sound'}</label>
                        </div>
                        <label className="drawer-switch">
                          <input 
                            type="checkbox" 
                            checked={enableJoinSound} 
                            onChange={e => {
                              setEnableJoinSound(e.target.checked);
                              localStorage.setItem('soundJoin', e.target.checked ? 'true' : 'false');
                            }}
                          />
                          <span className="drawer-slider"></span>
                        </label>
                      </div>
                      <div className="settings-group row-group">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button onClick={playUserLeaveSound} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '14px', padding: 0 }} title="Тест">🔊</button>
                          <label style={{ margin: 0 }}>{appLanguage === 'ru' ? 'Звук выхода из звонка' : 'User Leave Call Sound'}</label>
                        </div>
                        <label className="drawer-switch">
                          <input 
                            type="checkbox" 
                            checked={enableLeaveSound} 
                            onChange={e => {
                              setEnableLeaveSound(e.target.checked);
                              localStorage.setItem('soundLeave', e.target.checked ? 'true' : 'false');
                            }}
                          />
                          <span className="drawer-slider"></span>
                        </label>
                      </div>
                      <div className="settings-group row-group">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button onClick={playMessageSound} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '14px', padding: 0 }} title="Тест">🔊</button>
                          <label style={{ margin: 0 }}>{appLanguage === 'ru' ? 'Звук входящих сообщений' : 'Incoming Message Sound'}</label>
                        </div>
                        <label className="drawer-switch">
                          <input 
                            type="checkbox" 
                            checked={enableMsgSound} 
                            onChange={e => {
                              setEnableMsgSound(e.target.checked);
                              localStorage.setItem('soundMsg', e.target.checked ? 'true' : 'false');
                            }}
                          />
                          <span className="drawer-slider"></span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Privacy Submenu removed */}

                  {/* Submenu 4: Chat Settings (Appearance) */}
                  {activeSettingsSubmenu === 'chats' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      {/* Theme Options */}
                      <div className="settings-group">
                        <label>{appLanguage === 'ru' ? 'Тема оформления' : 'Theme Option'}</label>
                        <div className="theme-options-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '5px' }}>
                          <button 
                            className={`theme-card-btn dark-card ${themeMode === 'dark' ? 'active' : ''}`}
                            onClick={() => {
                              setThemeMode('dark');
                              localStorage.setItem('themeMode', 'dark');
                              setIsMidnightMode(false);
                              localStorage.setItem('midnightMode', 'false');
                              applyThemeCustomization(accentColor, accentGradient, false, 'dark', zoomLevel, enableAnimations, customPrimaryColor, customGradientColor2);
                            }}
                            style={{ 
                              background: '#14141c', 
                              border: themeMode === 'dark' ? '2px solid var(--primary)' : '1px solid var(--border)', 
                              borderRadius: '8px', padding: '10px', color: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold'
                            }}
                          >
                            {appLanguage === 'ru' ? 'Темная' : 'Dark'}
                          </button>
                          <button 
                            className={`theme-card-btn midnight-card ${themeMode === 'midnight' ? 'active' : ''}`}
                            onClick={() => {
                              setThemeMode('midnight');
                              localStorage.setItem('themeMode', 'midnight');
                              setIsMidnightMode(true);
                              localStorage.setItem('midnightMode', 'true');
                              applyThemeCustomization(accentColor, accentGradient, true, 'midnight', zoomLevel, enableAnimations, customPrimaryColor, customGradientColor2);
                            }}
                            style={{ 
                              background: '#000000', 
                              border: themeMode === 'midnight' ? '2px solid var(--primary)' : '1px solid var(--border)', 
                              borderRadius: '8px', padding: '10px', color: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold'
                            }}
                          >
                            {appLanguage === 'ru' ? 'Ночная' : 'Midnight'}
                          </button>
                          <button 
                            className={`theme-card-btn light-card ${themeMode === 'light' ? 'active' : ''}`}
                            onClick={() => {
                              setThemeMode('light');
                              localStorage.setItem('themeMode', 'light');
                              setIsMidnightMode(false);
                              localStorage.setItem('midnightMode', 'false');
                              applyThemeCustomization(accentColor, accentGradient, false, 'light', zoomLevel, enableAnimations, customPrimaryColor, customGradientColor2);
                            }}
                            style={{ 
                              background: '#ffffff', 
                              border: themeMode === 'light' ? '2px solid var(--primary)' : '1px solid var(--border)', 
                              borderRadius: '8px', padding: '10px', color: '#333', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold'
                            }}
                          >
                            {appLanguage === 'ru' ? 'Светлая' : 'Light'}
                          </button>
                        </div>
                      </div>

                      {/* Accent Color presets */}
                      <div className="settings-group">
                        <label>{appLanguage === 'ru' ? 'Цветовой акцент' : 'Accent Color'}</label>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
                          {[
                            { key: 'slate', val: '#708090', label: appLanguage === 'ru' ? 'Серый' : 'Grey' },
                            { key: 'violet', val: '#8b5cf6', label: appLanguage === 'ru' ? 'Фиолетовый' : 'Violet' },
                            { key: 'blue', val: '#3b82f6', label: appLanguage === 'ru' ? 'Синий' : 'Blue' },
                            { key: 'emerald', val: '#10b981', label: appLanguage === 'ru' ? 'Изумрудный' : 'Emerald' },
                            { key: 'amber', val: '#f59e0b', label: appLanguage === 'ru' ? 'Янтарный' : 'Amber' },
                            { key: 'ruby', val: '#ef4444', label: appLanguage === 'ru' ? 'Рубиновый' : 'Ruby' }
                          ].map(preset => (
                            <button
                              key={preset.key}
                              onClick={() => {
                                setAccentColor(preset.key);
                                localStorage.setItem('accentColor', preset.key);
                                applyThemeCustomization(preset.key, accentGradient, isMidnightMode, themeMode, zoomLevel, enableAnimations, customPrimaryColor, customGradientColor2);
                              }}
                              style={{ 
                                width: '30px', height: '30px', borderRadius: '50%', background: preset.val, 
                                border: accentColor === preset.key ? '3px solid var(--text-main)' : '2px solid transparent', 
                                cursor: 'pointer', boxShadow: '0 2px 5px rgba(0,0,0,0.3)', padding: 0
                              }}
                              title={preset.label}
                            />
                          ))}

                          {/* Custom Color Button */}
                          <button
                            onClick={() => {
                              setAccentColor('custom');
                              localStorage.setItem('accentColor', 'custom');
                              setAccentGradient('custom');
                              localStorage.setItem('accentGradient', 'custom');
                              applyThemeCustomization('custom', 'custom', isMidnightMode, themeMode, zoomLevel, enableAnimations, customPrimaryColor, customGradientColor2);
                            }}
                            style={{ 
                              width: '30px', height: '30px', borderRadius: '50%', 
                              background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)', 
                              border: (accentColor === 'custom' || accentGradient === 'custom') ? '3px solid var(--text-main)' : '2px solid transparent', 
                              cursor: 'pointer', boxShadow: '0 2px 5px rgba(0,0,0,0.3)', padding: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#fff', fontWeight: 'bold'
                            }}
                            title={appLanguage === 'ru' ? 'Свой цвет' : 'Custom Color'}
                          >
                            🎨
                          </button>
                        </div>
                      </div>

                      {/* Accent Button Gradient */}
                      <div className="settings-group">
                        <label>{appLanguage === 'ru' ? 'Градиент кнопок' : 'Accent Button Gradient'}</label>
                        <div className="gradient-presets-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginTop: '5px' }}>
                          {[
                            { key: 'solid', label: appLanguage === 'ru' ? 'Сплошной цвет' : 'Solid Accent' },
                            { key: 'indigo', label: appLanguage === 'ru' ? 'Серый-Синий' : 'Grey-Indigo' },
                            { key: 'cyan', label: appLanguage === 'ru' ? 'Серый-Голубой' : 'Grey-Cyan' },
                            { key: 'orange', label: appLanguage === 'ru' ? 'Розовый-Оранжевый' : 'Pink-Orange' },
                            { key: 'custom', label: appLanguage === 'ru' ? 'Свой градиент 🎨' : 'Custom Gradient 🎨' }
                          ].map(grad => (
                            <button
                              key={grad.key}
                              className={`gradient-card-btn ${accentGradient === grad.key ? 'active' : ''}`}
                              onClick={() => {
                                setAccentGradient(grad.key);
                                localStorage.setItem('accentGradient', grad.key);
                                applyThemeCustomization(accentColor, grad.key, isMidnightMode, themeMode, zoomLevel, enableAnimations, customPrimaryColor, customGradientColor2);
                              }}
                              style={{ 
                                background: 'rgba(255, 255, 255, 0.02)',
                                border: accentGradient === grad.key ? '2px solid var(--primary)' : '1px solid var(--border)',
                                borderRadius: '6px', padding: '8px', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold'
                              }}
                            >
                              {grad.label}
                            </button>
                          ))}
                        </div>

                        {/* Custom Gradient Builder (Two Small Squares Side-by-Side) */}
                        {(accentColor === 'custom' || accentGradient === 'custom') && (
                          <div className="custom-gradient-builder-card" style={{ marginTop: '12px', background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                              <span style={{ fontSize: '12px', fontWeight: 'bold' }}>
                                {appLanguage === 'ru' ? 'Настройка своего градиента:' : 'Custom Gradient Builder:'}
                              </span>
                              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                {/* Square 1 (Start) */}
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                                  <div style={{ position: 'relative', width: '32px', height: '32px', border: '2px solid var(--text-main)', borderRadius: '6px', overflow: 'hidden', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', backgroundColor: customPrimaryColor }}>
                                    <input 
                                      type="color" 
                                      value={customPrimaryColor} 
                                      onChange={e => {
                                        setCustomPrimaryColor(e.target.value);
                                        localStorage.setItem('customPrimaryColor', e.target.value);
                                        setAccentColor('custom');
                                        localStorage.setItem('accentColor', 'custom');
                                        applyThemeCustomization('custom', accentGradient, isMidnightMode, themeMode, zoomLevel, enableAnimations, e.target.value, customGradientColor2);
                                      }}
                                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                                    />
                                  </div>
                                  <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{appLanguage === 'ru' ? 'Цвет 1' : 'Color 1'}</span>
                                </div>

                                {/* Square 2 (End) */}
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                                  <div style={{ position: 'relative', width: '32px', height: '32px', border: '2px solid var(--text-main)', borderRadius: '6px', overflow: 'hidden', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', backgroundColor: customGradientColor2 }}>
                                    <input 
                                      type="color" 
                                      value={customGradientColor2} 
                                      onChange={e => {
                                        setCustomGradientColor2(e.target.value);
                                        localStorage.setItem('customGradientColor2', e.target.value);
                                        setAccentGradient('custom');
                                        localStorage.setItem('accentGradient', 'custom');
                                        applyThemeCustomization(accentColor, 'custom', isMidnightMode, themeMode, zoomLevel, enableAnimations, customPrimaryColor, e.target.value);
                                      }}
                                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                                    />
                                  </div>
                                  <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{appLanguage === 'ru' ? 'Цвет 2' : 'Color 2'}</span>
                                </div>
                              </div>
                            </div>
                            
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                {customPrimaryColor.toUpperCase()} → {customGradientColor2.toUpperCase()}
                              </span>
                              <div style={{ flex: 1, height: '12px', borderRadius: '3px', background: `linear-gradient(135deg, ${customPrimaryColor}, ${customGradientColor2})`, boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)' }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Folders Submenu removed */}

                  {/* Submenu 6: Advanced */}
                  {activeSettingsSubmenu === 'advanced' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div className="settings-group">
                        <label>{appLanguage === 'ru' ? 'Информация о сети' : 'Network Info'}</label>
                        <div style={{ background: 'rgba(255,255,255,0.01)', padding: '12px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div>Status: <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>Connected 🟢</span></div>
                          <div>WebSocket Latency: <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{ping} ms</span></div>
                          <div>Server Target IP: <span>{serverIp}</span></div>
                        </div>
                      </div>

                      <div className="settings-group">
                        <label>{appLanguage === 'ru' ? 'Аппаратное ускорение' : 'Hardware Acceleration'}</label>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                          {appLanguage === 'ru' 
                            ? 'Используется аппаратное ускорение графического процессора для плавного рендеринга WebRTC звонков и трансляций экрана.'
                            : 'GPU hardware acceleration is enabled for smooth WebRTC rendering of voice calls and screen streams.'}
                        </div>
                      </div>

                      <div style={{ height: '1px', background: 'var(--border)', margin: '10px 0' }}></div>
                      
                      <button 
                        onClick={() => {
                          const conf = window.confirm(appLanguage === 'ru' ? 'Вы уверены, что хотите очистить кэш и настройки приложения? Это приведет к выходу из аккаунта.' : 'Are you sure you want to clear app cache and settings? You will be logged out.');
                          if (conf) {
                            localStorage.clear();
                            window.location.reload();
                          }
                        }}
                        style={{ padding: '12px', background: 'var(--danger)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        {appLanguage === 'ru' ? 'Очистить кэш и сбросить настройки' : 'Clear Cache & Reset App'}
                      </button>
                    </div>
                  )}

                  {/* Submenu 7: Audio & Camera */}
                  {activeSettingsSubmenu === 'audio' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                      <div className="settings-group">
                        <label>{appLanguage === 'ru' ? 'Устройство ввода (Микрофон)' : 'Input Device (Microphone)'}</label>
                        <select
                          value={selectedInput}
                          onChange={e => {
                            setSelectedInput(e.target.value);
                            localStorage.setItem('selectedInput', e.target.value);
                          }}
                        >
                          <option value="default">{appLanguage === 'ru' ? 'По умолчанию' : 'Default'}</option>
                          {audioInputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Микрофон ${d.deviceId.slice(0,5)}`}</option>)}
                        </select>
                      </div>

                      <div className="settings-group">
                        <label>{appLanguage === 'ru' ? 'Устройство вывода (Динамики)' : 'Output Device (Speakers)'}</label>
                        <select
                          value={selectedOutput}
                          onChange={e => {
                            setSelectedOutput(e.target.value);
                            localStorage.setItem('selectedOutput', e.target.value);
                          }}
                        >
                          <option value="default">{appLanguage === 'ru' ? 'По умолчанию' : 'Default'}</option>
                          {audioOutputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Динамик ${d.deviceId.slice(0,5)}`}</option>)}
                        </select>
                      </div>

                      <div className="settings-group row-group">
                        <label>{appLanguage === 'ru' ? 'Шумоподавление и эхоподавление' : 'Noise & Echo Suppression'}</label>
                        <label className="drawer-switch">
                          <input
                            type="checkbox"
                            checked={noiseSuppression}
                            onChange={e => {
                              setNoiseSuppression(e.target.checked);
                              localStorage.setItem('noiseSuppression', e.target.checked ? 'true' : 'false');
                            }}
                          />
                          <span className="drawer-slider"></span>
                        </label>
                      </div>

                      <div className="settings-group">
                        <label>{appLanguage === 'ru' ? 'Битрейт аудио' : 'Audio Bitrate'}: {bitrate} kbps</label>
                        <input
                          type="range" min="32" max="128" step="32"
                          value={bitrate}
                          onChange={e => {
                            setBitrate(parseInt(e.target.value));
                            localStorage.setItem('bitrate', e.target.value);
                          }}
                          style={{ cursor: 'pointer', width: '100%' }}
                        />
                        <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)'}}>
                          <span>{appLanguage === 'ru' ? 'Низкий' : 'Low'}</span>
                          <span>{appLanguage === 'ru' ? 'Нормальный' : 'Normal'}</span>
                          <span>{appLanguage === 'ru' ? 'Высокий' : 'High'}</span>
                          <span>{appLanguage === 'ru' ? 'Максимальный' : 'Max'}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Battery Submenu removed */}

                  {/* Submenu 9: Language */}
                  {activeSettingsSubmenu === 'language' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                      <div className="settings-group">
                        <label>{appLanguage === 'ru' ? 'Выберите язык интерфейса' : 'Select Interface Language'}</label>
                        <div className="language-options" style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                          {[
                            { key: 'ru', label: 'Русский (Russian)' },
                            { key: 'ua', label: 'Українська (Ukrainian)' },
                            { key: 'en', label: 'English' }
                          ].map(lang => (
                            <button
                              key={lang.key}
                              onClick={() => {
                                setAppLanguage(lang.key);
                                localStorage.setItem('appLanguage', lang.key);
                              }}
                              style={{
                                background: 'rgba(255,255,255,0.02)',
                                border: appLanguage === lang.key ? '2px solid var(--primary)' : '1px solid var(--border)',
                                borderRadius: '8px',
                                padding: '12px 16px',
                                textAlign: 'left',
                                color: 'white',
                                cursor: 'pointer',
                                fontWeight: appLanguage === lang.key ? '700' : '500'
                              }}
                            >
                              {lang.label} {appLanguage === lang.key && '✓'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}



                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Fullscreen Telegram-style Media Viewer */}
      {showMediaViewer && (
        <div className="media-viewer-overlay" onClick={() => setShowMediaViewer(null)}>
          <div className="media-viewer-header" onClick={e => e.stopPropagation()}>
            <div className="media-viewer-header-info">
              <span className="media-viewer-sender">{showMediaViewer.sender}</span>
              <span className="media-viewer-filename">{showMediaViewer.fileName}</span>
            </div>
            <button className="media-viewer-close-btn" onClick={() => setShowMediaViewer(null)}>✕</button>
          </div>
          <div className="media-viewer-content" onClick={e => e.stopPropagation()}>
            {showMediaViewer.fileType === 'image' ? (
              <img src={showMediaViewer.fileUrl} alt={showMediaViewer.fileName} className="media-viewer-image" />
            ) : showMediaViewer.fileType === 'video' ? (
              <CustomVideoPlayer src={showMediaViewer.fileUrl} />
            ) : null}
          </div>
        </div>
      )}
      {/* Outgoing Call Modal Overlay */}
      {outgoingCall && (
        <div className="modal-overlay">
          <div className="modal-content call-modal" style={{ width: '300px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div className="call-avatar-container">
              <div className="call-avatar pulse">
                {outgoingCall.targetUsername[0].toUpperCase()}
              </div>
            </div>
            <h3>Звонок пользователю {outgoingCall.targetUsername}...</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '5px' }}>Исходящий вызов</p>
            <div style={{ marginTop: '20px', width: '100%' }}>
              <button className="cancel-btn danger" style={{ width: '100%' }} onClick={cancelCall}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Incoming Call Modal Overlay */}
      {incomingCall && (
        <div className="modal-overlay">
          <div className="modal-content call-modal" style={{ width: '300px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div className="call-avatar-container">
              <div className="call-avatar pulse-incoming">
                {incomingCall.callerUsername[0].toUpperCase()}
              </div>
            </div>
            <h3>Вам звонит {incomingCall.callerUsername}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '5px' }}>Входящий вызов</p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', width: '100%' }}>
              <button className="start-btn" style={{ flex: 1, background: 'var(--success)' }} onClick={acceptCall}>
                Принять
              </button>
              <button className="cancel-btn danger" style={{ flex: 1 }} onClick={declineCall}>
                Отклонить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
