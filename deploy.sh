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

# Определяем путь к проекту
# Если мы находимся в директории проекта, используем её
if [ -f "package.json" ] && [ -d "src" ]; then
    PROJECT_DIR="$(pwd)"
    log "Проект найден в текущей директории: $PROJECT_DIR"
else
    PROJECT_DIR="$HOME/$PROJECT_NAME"
    log "Проект будет развернут в: $PROJECT_DIR"
fi
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

# 5. Docker не устанавливается (используется внешняя БД)
log "Docker не устанавливается - используется внешняя база данных"

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
if [ -d "$PROJECT_DIR" ] && [ "$PROJECT_DIR" != "$(pwd)" ]; then
    log "Проект уже существует в $PROJECT_DIR, обновляем..."
    cd "$PROJECT_DIR"
    git fetch origin
    git reset --hard origin/$GITHUB_BRANCH
elif [ -f "package.json" ] && [ -d "src" ]; then
    log "Проект найден в текущей директории, обновляем..."
    git fetch origin
    git reset --hard origin/$GITHUB_BRANCH
else
    log "Клонируем новый репозиторий..."
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
    if [ -f "example.env" ]; then
        cp example.env .env
        log "Файл .env создан из example.env"
    else
        log "Файл example.env не найден, создаем пустой .env"
        touch .env
    fi
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

# 14. Запуск через PM2 (если не запущен)
log "Проверяем статус PM2..."
if pm2 list | grep -q "$PROJECT_NAME"; then
    log "Приложение уже запущено в PM2, перезапускаем..."
    pm2 restart $PROJECT_NAME
else
    log "Запускаем проект через PM2 в первый раз..."
    pm2 start npm --name $PROJECT_NAME -- run start:prod
    pm2 save
    pm2 startup
fi

# 15. Проверка статуса
log "Проверяем статус приложения..."
pm2 status
pm2 logs $PROJECT_NAME --lines 10

# 16. Финальная информация
echo ""
echo "=========================================="
echo "РАЗВЕРТЫВАНИЕ ЗАВЕРШЕНО УСПЕШНО!"
echo "=========================================="
echo ""
echo "Проект: $PROJECT_NAME"
echo "Директория: $PROJECT_DIR"
echo "Статус: $(pm2 jlist | jq -r '.[] | select(.name=="'$PROJECT_NAME'") | .pm2_env.status // "unknown"')"
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
