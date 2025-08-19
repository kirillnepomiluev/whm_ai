#!/bin/bash

# Скрипт управления WHM AI проектом
# Автор: AI Assistant
# Версия: 1.0

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Переменные
PROJECT_NAME="whm_ai"
PROJECT_DIR="/home/$(whoami)/$PROJECT_NAME"

# Функция для логирования
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

# Проверка существования проекта
if [ ! -d "$PROJECT_DIR" ]; then
    error "Проект не найден в директории $PROJECT_DIR"
    echo "Сначала запустите скрипт развертывания: ./deploy.sh"
    exit 1
fi

# Функция показа меню
show_menu() {
    echo ""
    echo "=========================================="
    echo "МЕНЕДЖЕР ПРОЕКТА WHM AI"
    echo "=========================================="
    echo "1. Показать статус приложения"
    echo "2. Показать логи приложения"
    echo "3. Перезапустить приложение"
    echo "4. Остановить приложение"
    echo "5. Запустить приложение"
    echo "6. Обновить код с GitHub"
    echo "7. Пересобрать и перезапустить"
    echo "8. Проверить подключение к базе данных"
    echo "9. Отредактировать .env файл"
    echo "10. Показать использование ресурсов"
    echo "0. Выход"
    echo "=========================================="
    echo -n "Выберите действие: "
}

# Функция показа статуса
show_status() {
    log "Статус приложения:"
    pm2 status
    echo ""
    log "Статус базы данных:"
    docker-compose -f "$PROJECT_DIR/docker-compose.yml" ps
}

# Функция показа логов
show_logs() {
    log "Последние 50 строк логов:"
    pm2 logs $PROJECT_NAME --lines 50
}

# Функция перезапуска
restart_app() {
    log "Перезапускаем приложение..."
    pm2 restart $PROJECT_NAME
    log "Приложение перезапущено"
}

# Функция остановки
stop_app() {
    log "Останавливаем приложение..."
    pm2 stop $PROJECT_NAME
    log "Приложение остановлено"
}

# Функция запуска
start_app() {
    log "Запускаем приложение..."
    pm2 start $PROJECT_NAME
    log "Приложение запущено"
}

# Функция обновления кода
update_code() {
    log "Обновляем код с GitHub..."
    cd "$PROJECT_DIR"
    git fetch origin
    git reset --hard origin/master
    log "Код обновлен"
}

# Функция пересборки
rebuild_app() {
    log "Пересобираем приложение..."
    cd "$PROJECT_DIR"
    npm install
    npm run build
    pm2 restart $PROJECT_NAME
    log "Приложение пересобрано и перезапущено"
}

# Функция проверки подключения к БД
check_db_connection() {
    log "Проверяем подключение к базе данных..."
    if [ -f "$PROJECT_DIR/.env" ]; then
        log "Настройки базы данных из .env файла:"
        grep -E "^(DATABASE_|DB_|MAIN_DB_)" "$PROJECT_DIR/.env" | head -10
        echo ""
        log "Для проверки подключения используйте команды:"
        echo "  - psql -h \$DATABASE_HOST -U \$DB_USER -d \$DB_NAME"
        echo "  - или настройте подключение в вашем приложении"
    else
        error "Файл .env не найден"
    fi
}

# Функция редактирования .env
edit_env() {
    log "Открываем .env файл для редактирования..."
    nano "$PROJECT_DIR/.env"
}

# Функция показа ресурсов
show_resources() {
    log "Использование ресурсов:"
    echo "CPU и память:"
    pm2 monit --no-daemon &
    sleep 5
    pkill -f "pm2 monit"
    echo ""
    echo "Дисковое пространство:"
    df -h
    echo ""
    echo "Использование памяти:"
    free -h
}

# Основной цикл
while true; do
    show_menu
    read -r choice
    
    case $choice in
        1)
            show_status
            ;;
        2)
            show_logs
            ;;
        3)
            restart_app
            ;;
        4)
            stop_app
            ;;
        5)
            start_app
            ;;
        6)
            update_code
            ;;
        7)
            rebuild_app
            ;;
        8)
            check_db_connection
            ;;
        9)
            edit_env
            ;;
        10)
            show_resources
            ;;
        0)
            log "Выход из менеджера"
            exit 0
            ;;
        *)
            warn "Неверный выбор. Попробуйте снова."
            ;;
    esac
    
    echo ""
    read -p "Нажмите Enter для продолжения..."
done
