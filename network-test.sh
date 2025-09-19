#!/bin/bash

echo "=== Диагностика сетевых проблем ==="

echo "1. Проверка DNS разрешения:"
nslookup api.telegram.org || echo "Ошибка DNS разрешения"

echo -e "\n2. Проверка доступности Telegram API:"
ping -c 4 api.telegram.org || echo "Ping недоступен"

echo -e "\n3. Проверка HTTPS соединения:"
curl -I --connect-timeout 10 https://api.telegram.org || echo "HTTPS соединение недоступно"

echo -e "\n4. Проверка текущих DNS серверов:"
cat /etc/resolv.conf

echo -e "\n5. Проверка сетевых интерфейсов:"
ip addr show

echo -e "\n6. Проверка маршрутизации:"
ip route show

echo -e "\n7. Тест альтернативного DNS (8.8.8.8):"
nslookup api.telegram.org 8.8.8.8 || echo "Альтернативный DNS не работает"

echo -e "\n=== Конец диагностики ==="
