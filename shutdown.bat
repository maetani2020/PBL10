@echo off

:: 管理者権限チェック
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit
)

:: シャットダウン実行
shutdown /s /f /t 0