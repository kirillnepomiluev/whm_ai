# 🚀 Руководство по развертыванию WHM AI проекта на Ubuntu сервере

Этот документ содержит подробные инструкции по развертыванию проекта WHM AI на Ubuntu сервере с использованием автоматизированных скриптов.

## 📋 Предварительные требования

- Ubuntu 18.04+ или 20.04+ (рекомендуется 22.04 LTS)
- Минимум 2 ГБ RAM
- Минимум 20 ГБ свободного места на диске
- Доступ к интернету
- Root пользователь (или пользователь с правами sudo)

## 🔑 Подготовка GitHub

Перед началом развертывания убедитесь, что у вас есть:
- GitHub аккаунт
- Доступ к репозиторию [https://github.com/kirillnepomiluev/whm_ai.git](https://github.com/kirillnepomiluev/whm_ai.git)

## 💻 Работа с Windows

### Требования для Windows:
- **PowerShell** или **Command Prompt**
- **OpenSSH** (встроен в Windows 10/11) или **PuTTY**
- Доступ к интернету

### Проверка OpenSSH на Windows:
```cmd
# Проверить наличие OpenSSH
ssh -V

# Если команда не найдена, установить через Windows Features:
# Settings → Apps → Optional features → Add feature → OpenSSH Client
```

## 📥 Загрузка скриптов

### Вариант 1: Загрузка через SCP с Windows (рекомендуется)

1. **Откройте PowerShell или Command Prompt на Windows**

2. **Перейдите в директорию со скриптами:**
   ```cmd
   cd C:\devfull\whm\whm_ai
   ```

3. **Загрузите скрипты на сервер:**
   ```cmd
   # Загрузка основного скрипта развертывания
   scp deploy.sh root@5.129.202.214:~/deploy.sh
   
   # Загрузка скрипта управления (опционально)
   scp manage.sh root@5.129.202.214:~/manage.sh
   
   # Загрузка скрипта проверки статуса (опционально)
   scp status.sh root@5.129.202.214:~/status.sh
   ```

4. **Подключитесь к серверу:**
   ```cmd
   ssh root@5.129.202.214
   ```

**ℹ️ IPv4 адрес сервера:**
```cmd
# Основной адрес сервера
ping 5.129.202.214

# Альтернативно используйте доменное имя сервера
scp deploy.sh root@your-server-domain.com:~/deploy.sh
ssh root@your-server-domain.com
```

5. **Создайте рабочую директорию и сделайте скрипт исполняемым:**
   ```bash
   mkdir -p ~/deployment
   mv ~/deploy.sh ~/deployment/
   cd ~/deployment
   chmod +x deploy.sh
   ```

### Вариант 2: Загрузка через wget на сервере

1. **Подключитесь к серверу:**
   ```bash
   ssh root@5.129.202.214
   ```

### Вариант 3: Альтернативные способы загрузки

**Если SCP не работает, попробуйте:**

1. **Через SFTP клиент (FileZilla, WinSCP):**
   - Хост: `5.129.202.214` или доменное имя
   - Порт: `22`
   - Пользователь: `root`
   - Протокол: `SFTP`

2. **Через веб-интерфейс хостинга:**
   - Загрузите файлы через панель управления
   - Переместите в домашнюю директорию

3. **Через другой сервер:**
   - Загрузите на промежуточный сервер
   - Затем скопируйте на целевой сервер

2. **Создайте рабочую директорию:**
   ```bash
   mkdir -p ~/deployment
   cd ~/deployment
   ```

3. **Скачайте скрипты развертывания:**
   ```bash
   wget https://raw.githubusercontent.com/kirillnepomiluev/whm_ai/master/deploy.sh
   wget https://raw.githubusercontent.com/kirillnepomiluev/whm_ai/master/manage.sh
   wget https://raw.githubusercontent.com/kirillnepomiluev/whm_ai/master/status.sh
   ```

4. **Сделайте скрипты исполняемыми:**
   ```bash
   chmod +x deploy.sh manage.sh status.sh
   ```

## 🚀 Автоматическое развертывание

### Запуск основного скрипта развертывания

```bash
# Перейдите в директорию со скриптом
cd ~/deployment

# Запустите скрипт развертывания
./deploy.sh
```

**Альтернативные способы запуска:**

```bash
# Запуск с полным путем
bash ~/deployment/deploy.sh

# Запуск с выводом всех команд
bash -x ~/deployment/deploy.sh

# Запуск с логированием в файл
bash ~/deployment/deploy.sh 2>&1 | tee deploy.log
```

**Что делает скрипт автоматически:**

✅ Обновляет систему Ubuntu  
✅ Устанавливает необходимые пакеты (curl, git, wget, etc.)  
✅ Устанавливает Node.js через NVM (последняя LTS версия)  
✅ Устанавливает PM2 для управления процессами  
✅ Проверяет Docker (опционально)  
✅ Генерирует SSH ключ для GitHub  
✅ Клонирует репозиторий с ветки master  
✅ Устанавливает зависимости Node.js  
✅ Создает .env файл из example.env  
✅ Настраивает подключение к внешней базе данных  
✅ Собирает проект  
✅ Запускает приложение через PM2  
✅ Настраивает автозапуск PM2

### 📋 Полный пример развертывания с Windows

```cmd
# 1. Откройте PowerShell на Windows
# 2. Перейдите в директорию проекта
cd C:\devfull\whm\whm_ai

# 3. Загрузите скрипт на сервер
scp deploy.sh root@5.129.202.214:~/deploy.sh

# 4. Подключитесь к серверу
ssh root@5.129.202.214

# 5. На сервере создайте директорию и переместите скрипт
mkdir -p ~/deployment
mv ~/deploy.sh ~/deployment/
cd ~/deployment
chmod +x deploy.sh

# 6. Запустите развертывание
./deploy.sh
```  

### ⚠️ Важные моменты во время выполнения

1. **SSH ключ будет выведен в консоль** - скопируйте его и добавьте в GitHub:
   - Перейдите на [https://github.com/settings/keys](https://github.com/settings/keys)
   - Нажмите "New SSH key"
   - Вставьте скопированный ключ
   - Нажмите "Add SSH key"

2. **После добавления ключа** нажмите Enter в консоли для продолжения

3. **Скрипт автоматически протестирует** подключение к GitHub

## ⚙️ Ручная настройка .env файла

После завершения развертывания **ОБЯЗАТЕЛЬНО** отредактируйте файл `.env`:

```bash
nano ~/whm_ai/.env
```

### 📝 Необходимые настройки

```env
# Внешняя база данных (PostgreSQL)
DATABASE_HOST=your_database_host
DATABASE_PORT=5432
DB_USER=your_database_user
DB_PASS=your_database_password
DB_NAME=your_database_name

# Основная БД (если отличается)
MAIN_DB_HOST=your_main_db_host
MAIN_DB_PORT=5432
MAIN_DB_USER=your_main_db_user
MAIN_DB_PASS=your_main_db_password
MAIN_DB_NAME=your_main_db_name

# Telegram бот
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# OpenAI API
OPENAI_API_KEY_PRO=your_openai_api_key_here
OPENAI_BASE_URL_PRO=https://chat.neurolabtg.ru/v1

# Kling API для видео
KLING_ACCESS_KEY=your_kling_access_key_here
KLING_SECRET_KEY=your_kling_secret_key_here
KLING_API_URL=https://api-singapore.klingai.com
```

**Где получить ключи:**

- **Telegram Bot Token**: [@BotFather](https://t.me/botfather) в Telegram
- **OpenAI API Key**: [OpenAI Platform](https://platform.openai.com/api-keys)
- **Kling API Keys**: [Kling AI Platform](https://klingai.com)

**Примечание о базе данных:**
- Используется **внешняя база данных PostgreSQL**
- Убедитесь, что база данных доступна по указанному адресу
- Проверьте права доступа пользователя к базе данных

## 🎯 Управление проектом

### Запуск менеджера проекта

```bash
./manage.sh
```

**Доступные функции:**

1. **Показать статус** - статус приложения и базы данных
2. **Показать логи** - последние 50 строк логов
3. **Перезапустить** - перезапуск приложения
4. **Остановить** - остановка приложения
5. **Запустить** - запуск приложения
6. **Обновить код** - получение последних изменений с GitHub
7. **Пересобрать** - пересборка и перезапуск
8. **Статус БД** - статус и логи базы данных
9. **Перезапуск БД** - перезапуск PostgreSQL
10. **Редактировать .env** - редактирование конфигурации
11. **Ресурсы** - мониторинг использования ресурсов

### Прямые команды PM2

```bash
# Статус приложений
pm2 status

# Логи приложения
pm2 logs whm_ai

# Перезапуск
pm2 restart whm_ai

# Остановка
pm2 stop whm_ai

# Запуск
pm2 start whm_ai

# Мониторинг в реальном времени
pm2 monit
```

## 🔧 Устранение неполадок

### Проблемы с подключением к серверу

```bash
# 1. Проверка доступности сервера
ping 5.129.202.214
ping your-server-domain.com

# 2. Проверка DNS
nslookup your-server-domain.com
nslookup 5.129.202.214

# 3. Проверка порта SSH
telnet 5.129.202.214 22
telnet your-server-domain.com 22

# 4. Альтернативные способы подключения
# Попробуйте IPv4 адрес вместо IPv6
# Или используйте доменное имя сервера
```

**Частые причины ошибок подключения:**
- ❌ **Сервер недоступен** - проверьте статус сервера
- ❌ **Блокировка порта 22** - проверьте файрвол сервера
- ❌ **Неправильный IP адрес** - уточните у хостинг-провайдера
- ❌ **Сервер недоступен** - проверьте статус сервера

### Проблемы с SSH ключом

```bash
# Проверка подключения к GitHub
ssh -T git@github.com

# Если ключ не работает, перегенерируйте:
rm ~/.ssh/id_ed25519*
ssh-keygen -t ed25519 -C "your-email@example.com"
```

### Проблемы с Docker

```bash
# Проверка статуса Docker
sudo systemctl status docker

# Перезапуск Docker
sudo systemctl restart docker

# Проверка прав пользователя
groups $USER
```

### Проблемы с PM2

```bash
# Сброс PM2
pm2 kill
pm2 start npm --name whm_ai -- run start:prod

# Проверка логов
pm2 logs whm_ai --lines 100
```

### Проблемы с базой данных

```bash
# Проверка подключения к внешней БД
psql -h $DATABASE_HOST -U $DB_USER -d $DB_NAME -c "SELECT 1;"

# Проверка настроек в .env
grep -E "^(DATABASE_|DB_)" ~/whm_ai/.env

# Тест подключения через приложение
cd ~/whm_ai && npm run start:dev
```

## 📊 Мониторинг и обслуживание

### Автоматические задачи

PM2 автоматически:
- Перезапускает приложение при сбоях
- Запускает приложение при перезагрузке сервера
- Ведет логи и мониторинг

### Рекомендуемые проверки

- **Ежедневно**: проверка статуса `pm2 status`
- **Еженедельно**: проверка логов `pm2 logs whm_ai --lines 100`
- **Ежемесячно**: обновление системы `sudo apt update && sudo apt upgrade`

## 🔄 Обновление проекта

### Автоматическое обновление

```bash
./manage.sh
# Выберите пункт 6: "Обновить код с GitHub"
# Затем пункт 7: "Пересобрать и перезапустить"
```

### Ручное обновление

```bash
cd ~/whm_ai
git fetch origin
git reset --hard origin/master
npm install
npm run build
pm2 restart whm_ai
```

## 📁 Структура проекта после развертывания

```
/home/username/
├── whm_ai/                    # Основная директория проекта
│   ├── src/                   # Исходный код
│   ├── dist/                  # Скомпилированный код
│   ├── .env                   # Конфигурация (создается автоматически)
│   ├── docker-compose.yml     # Конфигурация Docker
│   └── package.json           # Зависимости Node.js
├── deployment/                # Скрипты развертывания
│   ├── deploy.sh             # Основной скрипт развертывания
│   └── manage.sh             # Скрипт управления
└── .nvm/                     # Node Version Manager
```

## 🆘 Получение помощи

Если возникли проблемы:

1. **Проверьте логи**: `pm2 logs whm_ai`
2. **Проверьте статус**: `pm2 status`
3. **Проверьте базу данных**: `docker-compose -f ~/whm_ai/docker-compose.yml ps`
4. **Проверьте .env файл**: убедитесь, что все ключи заполнены правильно

## 📝 Примечания

- Скрипт автоматически создает пользователя для Docker
- После установки Docker может потребоваться перезапуск сессии
- Все команды выполняются от имени root пользователя
- PM2 автоматически запускает приложение при перезагрузке сервера

---

**Успешного развертывания! 🎉**
