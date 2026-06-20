const fs = require('fs');
const path = 'c:/Users/liman/Desktop/telegram2/client/src/App.jsx';
let code = fs.readFileSync(path, 'utf8');

// 1. Remove userPhone and userNickname from Settings Header
code = code.replace(
  /<span className="settings-pane-phone"[\s\S]*?\{userPhone\}<\/span>/g,
  ''
);
code = code.replace(
  /<span className="settings-pane-nickname"[\s\S]*?\{userNickname\}<\/span>/g,
  ''
);

// 2. Remove zoomLevel UI
code = code.replace(
  /<div className="settings-list-section" style={{ padding: '12px 16px', borderBottom: '1px solid var\(--border\)' }}>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*\)\s*:\s*\(/,
  '</div></div></div>) : ('
);

// 3. Add state variables for profile
const profileState = `  const [aboutMe, setAboutMe] = useState('');
  const [profileAudio, setProfileAudio] = useState(null);
`;

if (!code.includes('const [aboutMe, setAboutMe] = useState')) {
  // Insert near activeSettingsSection
  code = code.replace(
    /const \[activeSettingsSection, setActiveSettingsSection\] = useState\('account'\);/,
    `const [activeSettingsSection, setActiveSettingsSection] = useState('account');\n${profileState}`
  );
}

// Add fetch profile logic on mount/login
const fetchProfileLogic = `
  useEffect(() => {
    if (socket && connected && username) {
      socket.emit('get_user_profile', { username }, (res) => {
        if (res && res.success && res.profile) {
          setAboutMe(res.profile.aboutText || '');
          setProfileAudio(res.profile.audioUrl || null);
        }
      });
    }
  }, [socket, connected, username]);

  const saveProfileSettings = () => {
    if (socket && connected) {
      socket.emit('update_user_profile', { aboutText: aboutMe, audioUrl: profileAudio }, (res) => {
        if (res && res.success) {
          alert(appLanguage === 'ru' ? 'Профиль сохранен!' : 'Profile saved!');
        } else {
          alert((appLanguage === 'ru' ? 'Ошибка: ' : 'Error: ') + (res?.error || 'Unknown'));
        }
      });
    }
  };

  const handleProfileAudioUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert(appLanguage === 'ru' ? 'Файл слишком большой (макс 10 МБ)' : 'File too large (max 10 MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setProfileAudio(event.target.result);
    };
    reader.readAsDataURL(file);
  };
`;

if (!code.includes('saveProfileSettings = () =>')) {
  // Insert before the return statement of App function
  code = code.replace(
    /  return \(\n    <div className=\{`app-container/,
    fetchProfileLogic + '\n  return (\n    <div className={`app-container'
  );
}

// 4. Add UI for About Me and Audio to Account submenu
const accountSubmenuContent = `
                      <div style={{ width: '100%', marginTop: '20px' }}>
                        <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 'bold' }}>
                          {appLanguage === 'ru' ? 'О себе' : 'About Me'}
                        </label>
                        <textarea
                          value={aboutMe}
                          onChange={(e) => setAboutMe(e.target.value)}
                          placeholder={appLanguage === 'ru' ? 'Расскажите немного о себе...' : 'Tell something about yourself...'}
                          style={{ width: '100%', minHeight: '80px', padding: '12px', background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-main)', resize: 'vertical', fontFamily: 'inherit', marginBottom: '16px' }}
                          maxLength={500}
                        />

                        <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 'bold' }}>
                          {appLanguage === 'ru' ? 'Трек профиля' : 'Profile Track'}
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                          <button onClick={() => document.getElementById('profile-audio-upload').click()} style={{ padding: '8px 16px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                            {appLanguage === 'ru' ? 'Выбрать аудио' : 'Select Audio'}
                          </button>
                          <input type="file" id="profile-audio-upload" accept="audio/*" style={{ display: 'none' }} onChange={handleProfileAudioUpload} />
                          {profileAudio && (
                            <span style={{ fontSize: '13px', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              ✓ {appLanguage === 'ru' ? 'Загружено' : 'Uploaded'}
                              <button onClick={() => setProfileAudio(null)} style={{ background: 'transparent', border: 'none', color: 'var(--ruby)', cursor: 'pointer', marginLeft: '8px' }}>
                                <CloseIcon size={14} />
                              </button>
                            </span>
                          )}
                        </div>

                        {profileAudio && (
                          <audio controls src={profileAudio} style={{ width: '100%', height: '40px', outline: 'none', marginBottom: '16px' }} />
                        )}

                        <button onClick={saveProfileSettings} style={{ width: '100%', padding: '12px', background: 'var(--accent-gradient)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
                          {appLanguage === 'ru' ? 'Сохранить профиль' : 'Save Profile'}
                        </button>
                      </div>
`;

if (!code.includes('saveProfileSettings}')) {
  code = code.replace(
    /(<p style={{ margin: 0, fontSize: '12px', color: 'var\(--text-muted\)', lineHeight: '1\.4' }}>[\s\S]*?<\/p>\s*<\/div>)/,
    `$1\n${accountSubmenuContent}`
  );
}

fs.writeFileSync(path, code, 'utf8');
console.log('Client settings patched successfully.');
