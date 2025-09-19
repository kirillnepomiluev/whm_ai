#!/bin/bash

echo "=== Диагностика и исправление DNS проблем ==="

echo "1. Проверка статуса systemd-resolved:"
systemctl status systemd-resolved

echo -e "\n2. Текущая конфигурация DNS:"
resolvectl status

echo -e "\n3. Проверка /etc/resolv.conf:"
ls -la /etc/resolv.conf
cat /etc/resolv.conf

echo -e "\n4. Проверка /etc/systemd/resolved.conf:"
cat /etc/systemd/resolved.conf

echo -e "\n=== ИСПРАВЛЕНИЕ DNS ==="

echo "5. Создание резервной копии конфигурации:"
cp /etc/systemd/resolved.conf /etc/systemd/resolved.conf.backup

echo "6. Настройка надежных DNS серверов:"
cat > /etc/systemd/resolved.conf << EOF
[Resolve]
DNS=8.8.8.8 8.8.4.4 1.1.1.1 1.0.0.1
FallbackDNS=208.67.222.222 208.67.220.220
Domains=~.
DNSSEC=no
DNSOverTLS=no
Cache=yes
DNSStubListener=yes
ReadEtcHosts=yes
EOF

echo "7. Перезапуск systemd-resolved:"
systemctl restart systemd-resolved

echo "8. Проверка нового статуса:"
resolvectl status

echo -e "\n9. Тестирование DNS разрешения:"
echo "Тестируем с новыми настройками..."
nslookup api.telegram.org 8.8.8.8
echo -e "\nТестируем через системный резолвер:"
nslookup api.telegram.org

echo -e "\n10. Тестирование подключения:"
ping -c 2 api.telegram.org

echo -e "\n=== Готово! ==="
