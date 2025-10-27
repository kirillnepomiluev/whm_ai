# Webhook Module Usage

## Описание

Модуль webhook предназначен для обработки файлов по URL и конвертации их в JSON формат с помощью OpenAI ассистента.

## Endpoint

**POST** `/webhook/process-file`

## Запрос

### Body (JSON):
```json
{
  "fileUrl": "https://example.com/file.pdf",
  "filename": "optional_name.pdf"
}
```

### Параметры:
- `fileUrl` (обязательный) - URL файла для обработки
- `filename` (опциональный) - кастомное имя файла

## Успешный ответ

### Status: 200 OK
```json
{
  "success": true,
  "data": {
    // JSON результат, возвращенный ассистентом
  }
}
```

## Ошибки

### 400 Bad Request (отсутствует fileUrl)
```json
{
  "success": false,
  "error": "Не указан URL файла",
  "message": "Параметр fileUrl обязателен"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Описание ошибки",
  "message": "Не удалось обработать файл"
}
```

## Пример использования

### cURL
```bash
curl -X POST http://localhost:3000/webhook/process-file \
  -H "Content-Type: application/json" \
  -d '{
    "fileUrl": "https://example.com/document.pdf"
  }'
```

### JavaScript (fetch)
```javascript
const response = await fetch('http://localhost:3000/webhook/process-file', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    fileUrl: 'https://example.com/document.pdf',
    filename: 'my_document.pdf' // опционально
  })
});

const result = await response.json();
console.log(result);
```

## Технические детали

- Файл скачивается по URL и конвертируется в Buffer
- Используется ассистент OpenAI: `asst_bS6M2JvKYJhHVxCDb3xRviU2`
- Файл загружается в векторное хранилище ассистента
- Результат парсится как JSON и возвращается
- При ошибках возвращается JSON с описанием ошибки

