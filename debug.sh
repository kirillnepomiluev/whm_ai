#!/bin/bash

# Скрипт диагностики путей для WHM AI
# Автор: AI Assistant

echo "=========================================="
echo "🔍 ДИАГНОСТИКА ПУТЕЙ WHM AI"
echo "=========================================="
echo ""

echo "📁 Текущая директория:"
pwd
echo ""

echo "👤 Пользователь:"
whoami
echo ""

echo "🏠 Домашняя директория:"
echo "HOME: $HOME"
echo ""

echo "📂 Содержимое текущей директории:"
ls -la
echo ""

echo "📂 Содержимое домашней директории:"
ls -la ~/
echo ""

echo "🔍 Поиск директории whm_ai:"
find ~/ -name "whm_ai" -type d 2>/dev/null
echo ""

echo "🔍 Поиск файла package.json:"
find ~/ -name "package.json" -type f 2>/dev/null | head -5
echo ""

echo "🔍 Проверка переменных окружения:"
echo "PROJECT_NAME: whm_ai"
echo "PROJECT_DIR: $HOME/whm_ai"
echo ""

if [ -d "$HOME/whm_ai" ]; then
    echo "✅ Директория $HOME/whm_ai найдена!"
    echo "📂 Содержимое:"
    ls -la "$HOME/whm_ai"
else
    echo "❌ Директория $HOME/whm_ai НЕ найдена!"
fi

echo ""
echo "=========================================="
echo "Диагностика завершена"
echo "=========================================="
