#!/bin/bash

# Тестовый скрипт для проверки определения путей
# Автор: AI Assistant

echo "=========================================="
echo "🧪 ТЕСТ ОПРЕДЕЛЕНИЯ ПУТЕЙ"
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

echo "🔍 Проверка признаков проекта:"
if [ -f "package.json" ]; then
    echo "✅ package.json найден"
else
    echo "❌ package.json НЕ найден"
fi

if [ -d "src" ]; then
    echo "✅ src директория найдена"
else
    echo "❌ src директория НЕ найдена"
fi

if [ -d "whm_ai" ] && [ -f "whm_ai/package.json" ]; then
    echo "✅ whm_ai поддиректория с package.json найдена"
else
    echo "❌ whm_ai поддиректория с package.json НЕ найдена"
fi

echo ""
echo "🔍 Определение PROJECT_DIR:"

PROJECT_NAME="whm_ai"

# Определяем путь к проекту
# Сначала проверяем, находимся ли мы уже в директории проекта
if [ -f "package.json" ] && [ -d "src" ]; then
    PROJECT_DIR="$(pwd)"
    echo "✅ Проект найден в текущей директории: $PROJECT_DIR"
# Затем проверяем, есть ли проект в текущей директории
elif [ -d "$PROJECT_NAME" ] && [ -f "$PROJECT_NAME/package.json" ]; then
    PROJECT_DIR="$(pwd)/$PROJECT_NAME"
    echo "✅ Проект найден в поддиректории: $PROJECT_DIR"
# Иначе ищем в домашней директории
else
    PROJECT_DIR="$HOME/$PROJECT_NAME"
    echo "ℹ️  Проект будет искаться в: $PROJECT_DIR"
fi

echo ""
echo "🎯 Итоговый PROJECT_DIR: $PROJECT_DIR"
echo ""

if [ -d "$PROJECT_DIR" ]; then
    echo "✅ Директория $PROJECT_DIR существует!"
    echo "📂 Содержимое:"
    ls -la "$PROJECT_DIR"
else
    echo "❌ Директория $PROJECT_DIR НЕ существует!"
fi

echo ""
echo "=========================================="
echo "Тест завершен"
echo "=========================================="
