# 🚀 Быстрый старт - WHM AI

## ⚡ Минимальные команды для развертывания

### С Windows (через SCP):
```cmd
# 1. Загрузить скрипт на сервер
cd C:\devfull\whm\whm_ai
scp deploy.sh root@[2a03:6f00:a::5d8e]:~/deploy.sh

# 2. Подключиться к серверу
ssh root@2a03:6f00:a::5d8e

# 3. На сервере
mkdir -p ~/deployment
mv ~/deploy.sh ~/deployment/
cd ~/deployment
chmod +x deploy.sh
./deploy.sh
```

### С сервера (через wget):
```bash
# 1. Скачать скрипты
mkdir -p ~/deployment && cd ~/deployment
wget https://raw.githubusercontent.com/kirillnepomiluev/whm_ai/master/deploy.sh
wget https://raw.githubusercontent.com/kirillnepomiluev/whm_ai/master/manage.sh
wget https://raw.githubusercontent.com/kirillnepomiluev/whm_ai/master/status.sh

# 2. Сделать исполняемыми
chmod +x *.sh

# 3. Запустить развертывание
./deploy.sh
```

# 4. После завершения - настроить .env
nano ~/whm_ai/.env

# 5. Проверить статус
./status.sh

# 6. Управление проектом
./manage.sh
```

## 🔑 Обязательные настройки в .env

```env
TELEGRAM_BOT_TOKEN=your_bot_token
OPENAI_API_KEY_PRO=your_openai_key
DATABASE_HOST=localhost
DB_USER=ai_user
DB_PASS=ai_pass
DB_NAME=ai_bot
```

## 📋 Что происходит автоматически

- ✅ Установка Node.js, PM2
- ✅ Генерация SSH ключа для GitHub
- ✅ Клонирование репозитория
- ✅ Установка зависимостей
- ✅ Настройка подключения к внешней БД
- ✅ Сборка и запуск приложения

## ⚠️ Что нужно сделать вручную

1. **Добавить SSH ключ в GitHub** (скрипт покажет его)
2. **Настроить .env файл** с реальными ключами
3. **Перезапустить сессию** после установки Docker

## 🎯 Основные команды

```bash
# Статус системы
./status.sh

# Управление проектом
./manage.sh

# Прямые команды PM2
pm2 status
pm2 logs whm_ai
pm2 restart whm_ai

# База данных
grep -E "^(DATABASE_|DB_)" ~/whm_ai/.env
psql -h $DATABASE_HOST -U $DB_USER -d $DB_NAME -c "SELECT 1;"
```

## 🆘 Если что-то пошло не так

```bash
# Проверить логи
pm2 logs whm_ai --lines 100

# Перезапустить все
pm2 kill
docker-compose -f ~/whm_ai/docker-compose.yml down
./deploy.sh
```

---

**Подробная документация**: [DEPLOYMENT_README.md](DEPLOYMENT_README.md)
