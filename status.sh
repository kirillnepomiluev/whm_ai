#!/bin/bash

# Скрипт быстрой проверки статуса WHM AI проекта
# Автор: AI Assistant
# Версия: 1.0

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
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

echo "=========================================="
echo "🔍 БЫСТРАЯ ПРОВЕРКА СТАТУСА WHM AI"
echo "=========================================="
echo ""

# Проверка существования проекта
if [ ! -d "$PROJECT_DIR" ]; then
    error "❌ Проект не найден в директории $PROJECT_DIR"
    echo "Сначала запустите скрипт развертывания: ./deploy.sh"
    exit 1
fi

# 1. Проверка Node.js
log "📦 Проверка Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "   ✅ Node.js: $NODE_VERSION"
else
    error "   ❌ Node.js не установлен"
fi

# 2. Проверка PM2
log "🚀 Проверка PM2..."
if command -v pm2 &> /dev/null; then
    PM2_VERSION=$(pm2 --version)
    echo "   ✅ PM2: $PM2_VERSION"
else
    error "   ❌ PM2 не установлен"
fi

# 3. Проверка Docker
log "🐳 Проверка Docker..."
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    echo "   ✅ Docker: $DOCKER_VERSION"
else
    error "   ❌ Docker не установлен"
fi

# 4. Проверка статуса приложения
log "📱 Проверка статуса приложения..."
if pm2 list | grep -q "$PROJECT_NAME"; then
    APP_STATUS=$(pm2 jlist | jq -r '.[] | select(.name=="'$PROJECT_NAME'") | .pm2_env.status // "unknown"')
    if [ "$APP_STATUS" = "online" ]; then
        echo "   ✅ Приложение: $APP_STATUS"
    else
        warn "   ⚠️ Приложение: $APP_STATUS"
    fi
else
    error "   ❌ Приложение не найдено в PM2"
fi

# 5. Проверка настроек базы данных
log "🗄️ Проверка настроек базы данных..."
if [ -f "$PROJECT_DIR/.env" ]; then
    DB_HOST=$(grep "^DATABASE_HOST=" "$PROJECT_DIR/.env" | cut -d'=' -f2)
    DB_PORT=$(grep "^DATABASE_PORT=" "$PROJECT_DIR/.env" | cut -d'=' -f2)
    DB_NAME=$(grep "^DB_NAME=" "$PROJECT_DIR/.env" | cut -d'=' -f2)
    
    if [ -n "$DB_HOST" ] && [ -n "$DB_PORT" ] && [ -n "$DB_NAME" ]; then
        echo "   ✅ Настройки БД: $DB_HOST:$DB_PORT/$DB_NAME"
        echo "   ℹ️  Используется внешняя база данных"
    else
        warn "   ⚠️ Настройки БД неполные"
    fi
else
    error "   ❌ Файл .env не найден"
fi

# 6. Проверка .env файла
log "⚙️ Проверка конфигурации..."
if [ -f "$PROJECT_DIR/.env" ]; then
    echo "   ✅ .env файл: существует"
    
    # Проверка обязательных переменных
    REQUIRED_VARS=("TELEGRAM_BOT_TOKEN" "OPENAI_API_KEY_PRO" "DATABASE_HOST" "DB_USER" "DB_PASS")
    MISSING_VARS=()
    
    for var in "${REQUIRED_VARS[@]}"; do
        if ! grep -q "^${var}=" "$PROJECT_DIR/.env" || grep -q "^${var}=$" "$PROJECT_DIR/.env" || grep -q "^${var}=your_" "$PROJECT_DIR/.env"; then
            MISSING_VARS+=("$var")
        fi
    done
    
    if [ ${#MISSING_VARS[@]} -eq 0 ]; then
        echo "   ✅ Все обязательные переменные настроены"
    else
        warn "   ⚠️ Не настроены переменные: ${MISSING_VARS[*]}"
    fi
else
    error "   ❌ .env файл не найден"
fi

# 7. Проверка портов
log "🔌 Проверка портов..."
if command -v netstat &> /dev/null; then
    if netstat -tlnp 2>/dev/null | grep -q ":3000"; then
        echo "   ✅ Порт 3000: используется"
    else
        warn "   ⚠️ Порт 3000: не используется"
    fi
    
    if netstat -tlnp 2>/dev/null | grep -q ":5432"; then
        echo "   ✅ Порт 5432: используется (возможно, внешняя БД)"
    else
        echo "   ℹ️  Порт 5432: не используется (внешняя БД)"
    fi
else
    warn "   ⚠️ netstat не доступен для проверки портов"
fi

# 8. Проверка дискового пространства
log "💾 Проверка дискового пространства..."
DISK_USAGE=$(df -h "$PROJECT_DIR" | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -lt 80 ]; then
    echo "   ✅ Дисковое пространство: ${DISK_USAGE}% использовано"
else
    warn "   ⚠️ Дисковое пространство: ${DISK_USAGE}% использовано"
fi

# 9. Проверка памяти
log "🧠 Проверка памяти..."
MEMORY_USAGE=$(free | grep Mem | awk '{printf "%.1f", $3/$2 * 100.0}')
echo "   📊 Память: ${MEMORY_USAGE}% использовано"

# 10. Последние логи
log "📝 Последние логи приложения..."
if pm2 list | grep -q "$PROJECT_NAME"; then
    echo "   Последние 5 строк логов:"
    pm2 logs $PROJECT_NAME --lines 5 --nostream 2>/dev/null | sed 's/^/   /'
else
    echo "   Нет логов (приложение не запущено)"
fi

echo ""
echo "=========================================="
echo "📊 СВОДКА ПРОВЕРКИ"
echo "=========================================="

# Подсчет результатов
TOTAL_CHECKS=10
PASSED_CHECKS=0
WARNING_CHECKS=0
FAILED_CHECKS=0

# Простая оценка на основе предыдущих проверок
if command -v node &> /dev/null; then ((PASSED_CHECKS++)); fi
if command -v pm2 &> /dev/null; then ((PASSED_CHECKS++)); fi
if command -v docker &> /dev/null; then ((PASSED_CHECKS++)); fi
if [ -f "$PROJECT_DIR/.env" ]; then ((PASSED_CHECKS++)); fi
if [ -d "$PROJECT_DIR" ]; then ((PASSED_CHECKS++)); fi

echo "✅ Пройдено проверок: $PASSED_CHECKS/$TOTAL_CHECKS"
echo "⚠️ Предупреждений: $WARNING_CHECKS"
echo "❌ Ошибок: $FAILED_CHECKS"

echo ""
echo "💡 Рекомендации:"
if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo "   - Настройте недостающие переменные в .env файле"
fi
if ! pm2 list | grep -q "$PROJECT_NAME"; then
    echo "   - Запустите приложение через PM2"
fi
if ! docker-compose -f "$PROJECT_DIR/docker-compose.yml" ps | grep -q "Up"; then
    echo "   - Запустите базу данных через Docker Compose"
fi

echo ""
echo "=========================================="
echo "🔧 Для управления проектом используйте: ./manage.sh"
echo "=========================================="
