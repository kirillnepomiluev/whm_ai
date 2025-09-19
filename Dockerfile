# Используем официальный Node.js образ
FROM node:18-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Устанавливаем системные зависимости
RUN apk add --no-cache \
    ffmpeg \
    curl \
    dumb-init \
    && rm -rf /var/cache/apk/*

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production && npm cache clean --force

# Копируем исходный код
COPY . .

# Собираем приложение
RUN npm run build

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Меняем владельца файлов
RUN chown -R nextjs:nodejs /app
USER nextjs

# Открываем порт
EXPOSE 3000

# Настройки для улучшения работы с DNS
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

# Используем dumb-init для корректного завершения процессов
ENTRYPOINT ["dumb-init", "--"]

# Запускаем приложение
CMD ["node", "dist/main.js"]
