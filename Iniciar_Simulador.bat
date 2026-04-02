@echo off
title Simulador Forex - Servidor
echo =======================================================
echo Iniciando o Servidor do Simulador Forex...
echo =======================================================
echo.
cd /d "c:\Pessoal\Gestao\Forex\Forex\Testador"
echo Pressione CTRL+C caso queira fechar o servidor depois.
echo.
call npm run dev -- --host --port 8000
pause
