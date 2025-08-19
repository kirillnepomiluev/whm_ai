#!/bin/bash

# Скрипт развертывания WHM AI проекта на Ubuntu сервере
# Автор: AI Assistant
# Версия: 1.0

set -e  # Остановить выполнение при ошибке

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция для логирования
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

# Переменные
PROJECT_NAME="whm_ai"
PROJECT_DIR="/home/$(whoami)/$PROJECT_NAME"
GITHUB_REPO="https://github.com/kirillnepomiluev/whm_ai.git"
GITHUB_BRANCH="master"

log "Начинаем развертывание проекта $PROJECT_NAME"

# 1. Обновление системы
log "Обновляем систему..."
sudo apt update && sudo apt upgrade -y

# 2. Установка необходимых пакетов
log "Устанавливаем необходимые пакеты..."
sudo apt install -y curl git wget unzip software-properties-common apt-transport-https ca-certificates gnupg lsb-release

# 3. Установка Node.js через NVM
log "Устанавливаем Node.js через NVM..."
if [ ! -d "$HOME/.nvm" ]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
fi

# Загружаем NVM в текущую сессию
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Устанавливаем последнюю LTS версию Node.js
nvm install --lts
nvm use --lts
nvm alias default node

# 4. Установка PM2
log "Устанавливаем PM2..."
npm install -g pm2

# 5. Установка Docker (опционально, для будущего использования)
log "Проверяем Docker..."
if ! command -v docker &> /dev/null; then
    log "Docker не установлен. Установка пропущена (будет использоваться внешняя БД)"
    log "Для установки Docker выполните: sudo apt install docker.io docker-compose"
else
    log "Docker уже установлен"
fi

# 6. Генерация SSH ключа для GitHub
log "Генерируем SSH ключ для GitHub..."
if [ ! -f ~/.ssh/id_ed25519 ]; then
    ssh-keygen -t ed25519 -C "$(whoami)@$(hostname)" -f ~/.ssh/id_ed25519 -N ""
    log "SSH ключ сгенерирован"
else
    log "SSH ключ уже существует"
fi

# 7. Вывод публичного ключа
log "Публичный SSH ключ (добавьте его в GitHub):"
echo "=========================================="
cat ~/.ssh/id_ed25519.pub
echo "=========================================="
echo ""
warn "ВАЖНО: Скопируйте этот ключ и добавьте его в настройки SSH ключей вашего GitHub аккаунта!"
echo "Ссылка: https://github.com/settings/keys"
echo ""
read -p "Нажмите Enter после добавления ключа в GitHub..."

# 8. Тест подключения к GitHub
log "Тестируем подключение к GitHub..."
ssh -T git@github.com || {
    warn "Не удалось подключиться к GitHub. Проверьте, что ключ добавлен правильно."
    read -p "Продолжить? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        error "Развертывание прервано пользователем"
    fi
}

# 9. Клонирование репозитория
log "Клонируем репозиторий..."
if [ -d "$PROJECT_DIR" ]; then
    log "Проект уже существует, обновляем..."
    cd "$PROJECT_DIR"
    git fetch origin
    git reset --hard origin/$GITHUB_BRANCH
else
    cd ~
    git clone -b $GITHUB_BRANCH $GITHUB_REPO $PROJECT_NAME
    cd "$PROJECT_DIR"
fi

# 10. Установка зависимостей
log "Устанавливаем зависимости Node.js..."
npm install

# 11. Создание .env файла
log "Создаем .env файл..."
if [ ! -f .env ]; then
    cp example.env .env
    log "Файл .env создан из example.env"
    warn "ВАЖНО: Отредактируйте файл .env и добавьте все необходимые ключи и настройки!"
    echo "Команда для редактирования: nano .env"
else
    log "Файл .env уже существует"
fi

# 12. Проверка подключения к базе данных
log "Проверяем подключение к базе данных..."
log "ВАЖНО: Убедитесь, что внешняя база данных доступна и настроена в .env файле"
log "Проверьте настройки: DATABASE_HOST, DATABASE_PORT, DB_USER, DB_PASS, DB_NAME"

# 13. Сборка проекта
log "Собираем проект..."
npm run build

# 14. Запуск через PM2
log "Запускаем проект через PM2..."
pm2 delete $PROJECT_NAME 2>/dev/null || true
pm2 start npm --name $PROJECT_NAME -- run start:prod

# 15. Сохранение PM2 конфигурации
pm2 save
pm2 startup

# 16. Проверка статуса
log "Проверяем статус приложения..."
pm2 status
pm2 logs $PROJECT_NAME --lines 10

# 17. Финальная информация
echo ""
echo "=========================================="
echo "РАЗВЕРТЫВАНИЕ ЗАВЕРШЕНО УСПЕШНО!"
echo "=========================================="
echo ""
echo "Проект: $PROJECT_NAME"
echo "Директория: $PROJECT_DIR"
echo "Статус: $(pm2 jlist | jq -r '.[] | select(.name=="'$PROJECT_NAME'") | .pm2_env.status')"
echo ""
echo "Полезные команды:"
echo "  Просмотр логов: pm2 logs $PROJECT_NAME"
echo "  Перезапуск: pm2 restart $PROJECT_NAME"
echo "  Остановка: pm2 stop $PROJECT_NAME"
echo "  Статус: pm2 status"
echo ""
echo "ВАЖНО: Не забудьте отредактировать файл .env!"
echo "Команда: nano $PROJECT_DIR/.env"
echo ""
echo "=========================================="
