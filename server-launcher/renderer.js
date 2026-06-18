const { ipcRenderer } = require('electron');

// === State ===
let isRunning = false;
let isStarting = false;
let serverStartTime = null;
let uptimeInterval = null;
let connectionCount = 0;

// === DOM Elements ===
const serverLogo = document.getElementById('serverLogo');
const statusTitle = document.getElementById('statusTitle');
const statusSubtitle = document.getElementById('statusSubtitle');
const actionBtn = document.getElementById('actionBtn');
const btnIconPlay = document.getElementById('btnIconPlay');
const btnIconStop = document.getElementById('btnIconStop');
const btnText = document.getElementById('btnText');
const uptimeValue = document.getElementById('uptimeValue');
const connectionsValue = document.getElementById('connectionsValue');
const memoryValue = document.getElementById('memoryValue');
const portValue = document.getElementById('portValue');
const ipList = document.getElementById('ipList');
const logBody = document.getElementById('logBody');

// === Initialize ===
async function init() {
  // Load system info
  const info = await ipcRenderer.invoke('get-system-info');
  renderNetworkInfo(info.ips);
  memoryValue.textContent = `${info.freeMemory}/${info.totalMemory} GB`;
  
  // Check if server is already running
  const status = await ipcRenderer.invoke('get-server-status');
  if (status.running) {
    setRunningState();
  }

  // Start memory monitor
  setInterval(async () => {
    const info = await ipcRenderer.invoke('get-system-info');
    memoryValue.textContent = `${info.freeMemory}/${info.totalMemory} GB`;
  }, 5000);
}

// === Network Info ===
function renderNetworkInfo(ips) {
  if (!ips || ips.length === 0) {
    ipList.innerHTML = '<div class="ip-item"><span class="ip-name">Нет сетевых интерфейсов</span></div>';
    return;
  }
  
  ipList.innerHTML = ips.map(ip => `
    <div class="ip-item" onclick="copyIP(this, '${ip.address}:3001')" title="Нажмите чтобы скопировать">
      <div>
        <div class="ip-name">${ip.name}</div>
        <div class="ip-address">${ip.address}:3001</div>
      </div>
      <span class="copy-hint">📋 Скопировать</span>
    </div>
  `).join('');
}

// === Copy IP ===
function copyIP(el, text) {
  navigator.clipboard.writeText(text).then(() => {
    el.classList.add('copied');
    const hint = el.querySelector('.copy-hint');
    const oldText = hint.textContent;
    hint.textContent = '✓ Скопировано!';
    setTimeout(() => {
      el.classList.remove('copied');
      hint.textContent = oldText;
    }, 2000);
  });
}

// === Server Toggle ===
async function toggleServer() {
  if (isStarting) return;
  
  if (isRunning) {
    await stopServer();
  } else {
    await startServer();
  }
}

async function startServer() {
  isStarting = true;
  setStartingState();
  addLog('system', 'Запуск сервера Telecord...');
  
  // Animated startup sequence
  addLog('info', '● Проверка конфигурации...');
  await delay(400);
  addLog('info', '● Инициализация Socket.IO...');
  await delay(300);
  addLog('info', '● Загрузка хранилища чатов...');
  await delay(300);
  
  const result = await ipcRenderer.invoke('start-server');
  
  if (result.success) {
    isStarting = false;
    setRunningState();
    addLog('success', '✓ Сервер успешно запущен на порту 3001');
    addLog('info', '● Ожидание подключений клиентов...');
  } else {
    isStarting = false;
    setStoppedState();
    addLog('error', `✗ Ошибка запуска: ${result.error}`);
  }
}

async function stopServer() {
  addLog('system', 'Остановка сервера...');
  
  const result = await ipcRenderer.invoke('stop-server');
  
  if (result.success) {
    setStoppedState();
    addLog('success', '✓ Сервер остановлен');
  } else {
    addLog('error', `✗ Ошибка остановки: ${result.error}`);
  }
}

// === State Management ===
function setStartingState() {
  serverLogo.className = 'server-logo starting';
  statusTitle.textContent = 'Запуск сервера...';
  statusTitle.style.color = '#ffd740';
  statusSubtitle.textContent = 'Инициализация компонентов';
  actionBtn.className = 'action-btn starting';
  btnText.textContent = 'Запуск...';
}

function setRunningState() {
  isRunning = true;
  serverStartTime = Date.now();
  
  serverLogo.className = 'server-logo running';
  statusTitle.textContent = 'Сервер активен';
  statusTitle.style.color = '#00e676';
  statusSubtitle.textContent = 'Обработка подключений';
  
  actionBtn.className = 'action-btn running';
  btnIconPlay.style.display = 'none';
  btnIconStop.style.display = 'block';
  btnText.textContent = 'Остановить сервер';
  
  // Start uptime counter
  if (uptimeInterval) clearInterval(uptimeInterval);
  uptimeInterval = setInterval(updateUptime, 1000);
  updateUptime();
}

function setStoppedState() {
  isRunning = false;
  serverStartTime = null;
  connectionCount = 0;
  
  serverLogo.className = 'server-logo';
  statusTitle.textContent = 'Сервер остановлен';
  statusTitle.style.color = '';
  statusSubtitle.textContent = 'Нажмите кнопку для запуска';
  
  actionBtn.className = 'action-btn';
  btnIconPlay.style.display = 'block';
  btnIconStop.style.display = 'none';
  btnText.textContent = 'Запустить сервер';
  
  uptimeValue.textContent = '--:--:--';
  connectionsValue.textContent = '0';
  
  if (uptimeInterval) {
    clearInterval(uptimeInterval);
    uptimeInterval = null;
  }
}

// === Uptime ===
function updateUptime() {
  if (!serverStartTime) return;
  const elapsed = Math.floor((Date.now() - serverStartTime) / 1000);
  const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  uptimeValue.textContent = `${h}:${m}:${s}`;
}

// === Logging ===
function addLog(type, text) {
  const now = new Date();
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(v => String(v).padStart(2, '0')).join(':');
  
  const badgeMap = {
    system: '<span class="log-badge badge-system">SYS</span>',
    stdout: '<span class="log-badge badge-stdout">OUT</span>',
    stderr: '<span class="log-badge badge-stderr">ERR</span>',
    info: '<span class="log-badge badge-info">INF</span>',
    success: '<span class="log-badge badge-stdout">OK</span>',
    error: '<span class="log-badge badge-stderr">ERR</span>'
  };
  
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    ${badgeMap[type] || badgeMap.system}
    <span class="log-text">${escapeHtml(text)}</span>
  `;
  
  logBody.appendChild(entry);
  logBody.scrollTop = logBody.scrollHeight;
}

function clearLogs() {
  logBody.innerHTML = '';
  addLog('system', 'Консоль очищена');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// === IPC Listeners ===
ipcRenderer.on('server-log', (_, data) => {
  const type = data.type === 'stderr' ? 'stderr' : 
               data.type === 'system' ? 'system' : 'stdout';
  addLog(type, data.text);
  
  // Parse connection events from stdout
  if (data.text.includes('User connected:')) {
    connectionCount++;
    connectionsValue.textContent = connectionCount;
  } else if (data.text.includes('User disconnected:')) {
    connectionCount = Math.max(0, connectionCount - 1);
    connectionsValue.textContent = connectionCount;
  }
});

ipcRenderer.on('server-status', (_, data) => {
  if (data.running) {
    if (!isRunning) setRunningState();
  } else {
    if (isRunning || isStarting) {
      isStarting = false;
      setStoppedState();
      if (data.error) {
        addLog('error', `Сервер завершился с ошибкой: ${data.error}`);
      }
    }
  }
});

// === Utility ===
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// === Start ===
init();
