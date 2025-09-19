#!/bin/bash

echo "=== Быстрое исправление DNS ==="

# Метод 1: Прямая замена /etc/resolv.conf
echo "1. Создание резервной копии resolv.conf:"
cp /etc/resolv.conf /etc/resolv.conf.backup

echo "2. Временно отключаем systemd-resolved:"
systemctl stop systemd-resolved

echo "3. Удаляем символическую ссылку:"
unlink /etc/resolv.conf

echo "4. Создаем новый resolv.conf с надежными DNS:"
cat > /etc/resolv.conf << EOF
# Надежные DNS серверы
nameserver 8.8.8.8
nameserver 8.8.4.4
nameserver 1.1.1.1
nameserver 1.0.0.1
options timeout:2 attempts:3 rotate single-request-reopen
EOF

echo "5. Блокируем изменения файла:"
chattr +i /etc/resolv.conf

echo "6. Тестируем DNS:"
nslookup api.telegram.org

echo "7. Тестируем подключение:"
ping -c 2 api.telegram.org || echo "Ping все еще не работает, но DNS должен работать"

echo "8. Тестируем HTTPS подключение:"
curl -I --connect-timeout 10 https://api.telegram.org || echo "HTTPS может быть заблокирован"

echo -e "\n=== DNS исправлен! ==="
echo "Если нужно вернуть systemd-resolved:"
echo "sudo chattr -i /etc/resolv.conf"
echo "sudo systemctl start systemd-resolved"
