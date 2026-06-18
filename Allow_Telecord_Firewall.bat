@echo off
chcp 65001 > nul
echo ===================================================
echo   Настройка брандмауэра Windows для Telecord
echo ===================================================
echo.

:: Проверка прав администратора
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] Права администратора подтверждены.
    echo.
    echo Открытие входящего порта 3001 (TCP) для сервера Telecord...
    powershell -Command "New-NetFirewallRule -DisplayName 'Telecord Server Port 3001' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001" > nul
    
    echo Открытие входящего порта 3001 (UDP) для WebRTC...
    powershell -Command "New-NetFirewallRule -DisplayName 'Telecord Server WebRTC UDP' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 3001" > nul
    
    echo Разрешение входящих подключений для Node.exe...
    powershell -Command "New-NetFirewallRule -DisplayName 'Telecord Node Server Process' -Direction Inbound -Program 'node.exe' -Action Allow" > nul 2>&1

    echo.
    echo [УСПЕХ] Все правила брандмауэра успешно добавлены!
    echo Теперь твои друзья смогут подключиться к серверу по твоему IP из Radmin VPN.
    echo.
    pause
) else (
    echo [INFO] Запрос прав администратора...
    powershell -Command "Start-Process -FilePath '%~fnx0' -Verb RunAs"
)
