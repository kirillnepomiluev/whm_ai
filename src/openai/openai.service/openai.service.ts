import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpeg = require('fluent-ffmpeg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);
import { SessionService } from '../../session/session.service';

// Описание возвращаемого файла от OpenAI
export interface OpenAiFile {
  filename: string;
  buffer: Buffer;
}

// Структура ответа ассистента: текст + возможные файлы
export interface OpenAiAnswer {
  text: string;
  files: OpenAiFile[];
}

@Injectable()
export class OpenAiService {
  private readonly openAi: OpenAI;
  private readonly fallbackOpenAi: OpenAI;
  private readonly logger = new Logger(OpenAiService.name);
  private threadMap: Map<number, string> = new Map();
  
  // Система блокировки тредов - Map для отслеживания активных запросов по threadId
  private activeThreads: Map<string, Promise<any>> = new Map();
  
  // Флаг для отслеживания доступности основного API
  private isMainApiAvailable: boolean = true;
  private lastMainApiCheck: number = 0;
  private readonly API_CHECK_INTERVAL = 5 * 60 * 1000; // 5 минут

  /**
   * Проверяет доступность основного API
   */
  private async checkMainApiAvailability(): Promise<boolean> {
    const now = Date.now();
    
    // Проверяем не чаще чем раз в 5 минут
    if (now - this.lastMainApiCheck < this.API_CHECK_INTERVAL) {
      return this.isMainApiAvailable;
    }
    
    try {
      this.lastMainApiCheck = now;
      // Простой тест API - получаем список моделей
      await this.openAi.models.list();
      this.isMainApiAvailable = true;
      this.logger.log('Основной OpenAI API доступен');
      return true;
    } catch (error) {
      this.isMainApiAvailable = false;
      this.logger.warn('Основной OpenAI API недоступен, используем fallback', error);
      return false;
    }
  }

  /**
   * Получает активный OpenAI клиент (основной или fallback)
   */
  private async getActiveOpenAiClient(): Promise<OpenAI> {
    if (await this.checkMainApiAvailability()) {
      return this.openAi;
    }
    return this.fallbackOpenAi;
  }

  /**
   * Выполняет операцию с retry логикой
   */
  private async executeWithRetry<T>(
    operation: (client: OpenAI) => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = await this.getActiveOpenAiClient();
        return await operation(client);
      } catch (error: any) {
        lastError = error;
        
        // Если это ошибка 502, сразу переключаемся на fallback
        if (error.message?.includes('502') || error.status === 502) {
          this.logger.warn(`Получена ошибка 502, переключаемся на fallback API (попытка ${attempt}/${maxRetries})`);
          this.isMainApiAvailable = false;
          continue;
        }
        
        // Для других ошибок ждем перед повторной попыткой
        if (attempt < maxRetries) {
          this.logger.warn(`Попытка ${attempt} не удалась, повторяем через ${delayMs}ms`, error);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          delayMs *= 2; // Экспоненциальная задержка
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Подготавливает изображение для отправки в OpenAI: конвертирует в PNG,
   * уменьшает размеры до требуемых и гарантирует объём < 4 MB.
   */
  private async prepareImage(image: Buffer): Promise<Buffer> {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${crypto.randomUUID()}.src`);
    const outPath = path.join(tmpDir, `${crypto.randomUUID()}.png`);
    await fs.writeFile(inputPath, image);

    let size = 1024;
    let result: Buffer = image;
    while (size >= 256) {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            '-vf',
            `scale=${size}:${size}`,
            '-compression_level',
            '9',
          ])
          .output(outPath)
          .on('end', () => resolve())
          .on('error', (err: Error) => reject(err))
          .run();
      });
      result = await fs.readFile(outPath);
      if (result.length <= 4 * 1024 * 1024) break;
      size = Math.floor(size / 2);
    }

    await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outPath)]);
    return result;
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly sessionService: SessionService,
  ) {
    const rawKey = this.configService.get<string>('OPENAI_API_KEY_PRO');
    if (!rawKey) {
      throw new Error('Не задана переменная окружения OPENAI_API_KEY_PRO');
    }
    this.logger.debug(`Raw OpenAI API key length: ${rawKey.length}`);
    this.logger.debug(
      `API raw key fragment: ${rawKey.slice(0, 5)}...${rawKey.slice(-5)}`,
    );
    // Удаляем BOM и переносы
    const key = rawKey.replace(/\s+/g, '').trim();
    this.logger.debug(
      `API key fragment: ${key.slice(0, 5)}...${key.slice(-5)}`,
    );
    this.logger.debug(`Sanitized OpenAI API key length: ${key.length}`);

    const baseURL =
      this.configService.get<string>('OPENAI_BASE_URL_PRO')?.trim() ||
      'https://ai.1devfull.store/v1';

    this.openAi = new OpenAI({
      apiKey: key,
      baseURL,
    });

    // Создаем fallback клиент для случаев, когда основной API недоступен
    this.fallbackOpenAi = new OpenAI({
      apiKey: key, // Используем тот же ключ для fallback
      baseURL: 'https://api.openai.com/v1', // Fallback на официальный OpenAI API
    });

    // Автоматически очищаем поврежденные треды при старте
    this.cleanupCorruptedThreadsOnStartup();
  }

  /**
   * Автоматически очищает поврежденные треды при старте сервиса
   */
  private async cleanupCorruptedThreadsOnStartup() {
    try {
      this.logger.log('Запускаю автоматическую очистку поврежденных тредов...');
      const result = await this.cleanupCorruptedThreads();
      if (result.cleaned > 0) {
        this.logger.log(`Автоматически очищено ${result.cleaned} поврежденных тредов`);
      } else {
        this.logger.log('Поврежденных тредов не найдено');
      }
    } catch (error) {
      this.logger.error('Ошибка при автоматической очистке тредов:', error);
    }
  }

  /**
   * Проверяет, активен ли тред (выполняется ли в нем запрос)
   */
  private isThreadActive(threadId: string): boolean {
    return this.activeThreads.has(threadId);
  }

  /**
   * Блокирует тред для выполнения запроса
   */
  private async lockThread<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    if (this.isThreadActive(threadId)) {
      throw new Error('Тред уже занят другим запросом. Пожалуйста, дождитесь завершения предыдущего запроса.');
    }

    const promise = operation();
    this.activeThreads.set(threadId, promise);
    
    try {
      const result = await promise;
      return result;
    } finally {
      this.activeThreads.delete(threadId);
    }
  }

  /**
   * Проверяет активные runs в треде и ждет их завершения
   */
  private async checkAndWaitForActiveRuns(threadId: string): Promise<void> {
    const client = await this.getActiveOpenAiClient();
    const runs = await client.beta.threads.runs.list(threadId);
    const activeRun = runs.data.find(
      (run) => run.status === 'in_progress' || run.status === 'queued'
    );

    if (activeRun) {
      this.logger.log(`Активный run уже выполняется для thread ${threadId}. Ждем завершения...`);
      await this.waitForRunCompletion(threadId, activeRun.id);
    }
  }

  async waitForRunCompletion(threadId: string, runId: string) {
    let runStatus = 'in_progress';

    while (runStatus === 'in_progress' || runStatus === 'queued') {
      console.log(`Ожидание завершения run ${runId}...`);
      await new Promise((res) => setTimeout(res, 3000)); // Ждём 3 секунды перед повторной проверкой

      const client = await this.getActiveOpenAiClient();
      const run = await client.beta.threads.runs.retrieve(threadId, runId);
      runStatus = run.status;
    }

    console.log(`Run ${runId} завершен со статусом: ${runStatus}`);
  }

  // Разбор сообщения ассистента: извлекаем текст и скачиваем приложенные файлы
  private async buildAnswer(assistantMessage: any): Promise<OpenAiAnswer> {
    let text = '';
    const fileIds = new Set<string>();

    // Собираем текстовые блоки и ищем ссылки на файлы в аннотациях
    for (const part of assistantMessage.content || []) {
      if (part.type === 'text') {
        text += (text ? '\n' : '') + part.text.value;
        part.text.annotations?.forEach((ann: any) => {
          if (ann.type === 'file_path' && ann.file_path?.file_id) {
            fileIds.add(ann.file_path.file_id);
          }
        });
      } else if (part.type === 'image_file' && part.image_file?.file_id) {
        fileIds.add(part.image_file.file_id);
      }
    }

    // Также учитываем явно прикреплённые файлы
    assistantMessage.attachments?.forEach((att: any) => {
      if (att.file_id) fileIds.add(att.file_id);
    });

    const files: OpenAiFile[] = [];
    for (const id of fileIds) {
      try {
        // Получаем активный клиент для работы с файлами
        const client = await this.getActiveOpenAiClient();
        // Получаем метаданные файла для имени
        const meta = await client.files.retrieve(id);
        // Скачиваем содержимое файла
        const res = await client.files.content(id);
        const buffer = Buffer.from(await res.arrayBuffer());
        files.push({ filename: meta.filename ?? id, buffer });
      } catch (err) {
        this.logger.error(`Не удалось скачать файл ${id}`, err as Error);
      }
    }

    return { text, files };
  }

  // ID ассистента для оптимизации промтов видео
  private readonly VIDEO_PROMPT_OPTIMIZER_ASSISTANT_ID = 'asst_qtXWMEt5EWtSUXTgPEQDqYVM';
  
  // ID ассистента для конвертации файлов в JSON
  private readonly FILE_TO_JSON_ASSISTANT_ID = 'asst_bS6M2JvKYJhHVxCDb3xRviU2';

  // Основной текстовый чат с ассистентом
  async chat(content: string, userId: number): Promise<OpenAiAnswer> {
    let threadId = await this.sessionService.getSessionId(userId);
    if (threadId) {
      this.threadMap.set(userId, threadId);
    }
    let thread: { id: string };
    const assistantId = 'asst_q6l4je76YrzysIxzH8rHoXGx';
    
    try {
      if (!threadId) {
        // Создаем новый тред, если не существует
        this.logger.log(`Создаю новый тред для пользователя ${userId}`);
        thread = await this.openAi.beta.threads.create();
        threadId = thread.id;
        this.threadMap.set(userId, threadId);
        await this.sessionService.setSessionId(userId, threadId);
        this.logger.log(`Создан новый тред ${threadId} для пользователя ${userId}`);
      } else {
        // Если тред уже есть, проверяем его существование
        this.logger.log(`Использую существующий тред ${threadId} для пользователя ${userId}`);
        try {
          const client = await this.getActiveOpenAiClient();
          await client.beta.threads.retrieve(threadId);
          thread = { id: threadId };
        } catch (error) {
          this.logger.warn(`Тред ${threadId} не найден, создаю новый`, error);
          thread = await this.openAi.beta.threads.create();
          threadId = thread.id;
          this.threadMap.set(userId, threadId);
          await this.sessionService.setSessionId(userId, threadId);
          this.logger.log(`Создан новый тред ${threadId} для пользователя ${userId}`);
        }
      }

      // Используем систему блокировки тредов
      return await this.lockThread(threadId, async () => {
        // Проверяем активные runs в треде
        await this.checkAndWaitForActiveRuns(threadId);

        return await this.executeWithRetry(async (client) => {
          try {
            // Проверяем доступность ассистента
            this.logger.log(`Проверяю доступность ассистента ${assistantId}...`);
            try {
              const assistant = await client.beta.assistants.retrieve(assistantId);
              this.logger.log(`Ассистент ${assistantId} доступен: ${assistant.name || 'Без имени'}`);
            } catch (error) {
              this.logger.error(`Ассистент ${assistantId} недоступен:`, error);
              throw new Error(`Ассистент недоступен: ${error.message}`);
            }

            // Добавляем сообщение пользователя в тред
            this.logger.log(`Добавляю сообщение пользователя в тред ${thread.id}`);
            await client.beta.threads.messages.create(thread.id, {
              role: 'user',
              content: content,
            });

            // Генерируем ответ ассистента по треду
            this.logger.log(`Запускаю Run для ассистента ${assistantId} в треде ${thread.id}...`);
            const response = await client.beta.threads.runs.createAndPoll(
              thread.id,
              {
                assistant_id: assistantId,
              },
            );
            
            this.logger.log(`Run завершен со статусом: ${response.status}`);
            
            if (response.status === 'completed') {
              const messages = await client.beta.threads.messages.list(
                response.thread_id,
              );
              const assistantMessage = messages.data[0];
              this.logger.log(`Получен ответ от ассистента, длина: ${JSON.stringify(assistantMessage.content).length} символов`);
              return await this.buildAnswer(assistantMessage);
            } else if (response.status === 'failed') {
              // Получаем детали ошибки
              const errorDetails = await this.getRunErrorDetails(client, thread.id, response.id);
              this.logger.error(`Run failed с деталями:`, errorDetails);
              
              // Проверяем, есть ли детали ошибки
              if (errorDetails?.lastError) {
                throw new Error(`Run failed: ${errorDetails.lastError.code} - ${errorDetails.lastError.message}`);
              } else {
                throw new Error(`Run завершился со статусом: ${response.status}`);
              }
            } else if (response.status === 'requires_action') {
              this.logger.warn(`Run требует действия: ${JSON.stringify(response.required_action)}`);
              throw new Error(`Run требует действия: ${response.required_action?.type || 'неизвестно'}`);
            } else if (response.status === 'expired') {
              this.logger.warn(`Run истек`);
              throw new Error(`Run истек`);
            } else {
              this.logger.warn(`Run завершился со статусом: ${response.status}`);
              throw new Error(`Run завершился со статусом: ${response.status}`);
            }
          } catch (error) {
            this.logger.error(`Ошибка при обработке сообщения в треде ${thread.id}:`, error);
            throw error;
          }
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'VECTOR_STORE_EXPIRED') {
        this.logger.log('Создаем новый тред из-за истекшего векторного хранилища');
        // Удаляем старый тред из сессии и создаем новый
        await this.sessionService.setSessionId(userId, null);
        this.threadMap.delete(userId);
        // Рекурсивно вызываем метод с новым тредом
        return await this.chat(content, userId);
      }
      this.logger.error('Ошибка в чате с ассистентом', error);
      
      // Если это ошибка блокировки треда, возвращаем специальное сообщение
      if (error instanceof Error && error.message.includes('Тред уже занят')) {
        return {
          text: '⏳ Тред уже занят другим запросом. Пожалуйста, дождитесь завершения предыдущего запроса.',
          files: [],
        };
      }
      
      // Проверяем тип ошибки и даем более конкретный ответ
      if (error instanceof Error) {
        if (error.message.includes('Run failed')) {
          return {
            text: '🤖 Не удалось получить ответ от ассистента. Возможно, есть проблемы с API API. Попробуйте позже.',
            files: [],
          };
        } else if (error.message.includes('Ассистент недоступен')) {
          return {
            text: '🤖 Ассистент временно недоступен. Попробуйте позже или обратитесь к администратору.',
            files: [],
          };
        } else if (error.message.includes('Run требует действия')) {
          return {
            text: '🤖 Ассистент требует дополнительных действий. Попробуйте переформулировать вопрос.',
            files: [],
          };
        } else if (error.message.includes('Run истек')) {
          return {
            text: '🤖 Время ожидания ответа истекло. Попробуйте отправить сообщение еще раз.',
            files: [],
          };
        }
      }
      
      return {
        text: '🤖 Не удалось получить ответ от API. Попробуйте позже или обратитесь к администратору.',
        files: [],
      };
    }
  }

  async generateImage(prompt: string): Promise<string | Buffer | null> {
    try {
      return await this.executeWithRetry(async (client) => {
        const { data } = await client.images.generate({
          model: 'gpt-image-1',
          prompt,
          quality: 'high',
          n: 1,
          size: '1024x1024',
          moderation: 'low',
        });
        if (!data || data.length === 0) {
          this.logger.error('Image.generate вернул пустой data', data);
          return null;
        }
        const img = data[0];
        // Основной случай: ответ в формате base64-JSON
        if ('b64_json' in img && img.b64_json) {
          return Buffer.from(img.b64_json, 'base64');
        }
        // На случай других моделей: возвращаем URL
        if ('url' in img && img.url) {
          return img.url;
        }
        this.logger.error('Image data не содержит ни b64_json, ни url', img);
        return null;
      });
    } catch (err: any) {
      this.logger.error('Ошибка при генерации изображения', err);
      return null;
    }
  }

  /**
   * Генерирует изображение на основе присланной пользователем картинки
   * с помощью endpoint'a createVariation
   */
  async generateImageFromPhoto(
    image: Buffer,
    prompt: string,
  ): Promise<string | Buffer | null> {
    try {
      // изображение конвертируется в PNG и уменьшатся до < 4 МБ
      const prepared = await this.prepareImage(image);
      const file = await toFile(prepared, 'image.png', { type: 'image/png' });
      // Используем ту же модель, что и при обычной генерации,
      // передавая текст пользователя в качестве промта
      return await this.executeWithRetry(async (client) => {
        const { data } = await client.images.edit({
          image: file,
          prompt,
          model: 'gpt-image-1',
          quality: 'high',
          n: 1,
          size: '1024x1024',
        });
        if (!data || data.length === 0) {
          this.logger.error('Image.edit вернул пустой data', data);
          return null;
        }
        const img = data[0];
        if ('b64_json' in img && img.b64_json) {
          return Buffer.from(img.b64_json, 'base64');
        }
        if ('url' in img && img.url) {
          return img.url;
        }
        this.logger.error('Image data не содержит ни b64_json, ни url', img);
        return null;
      });
    } catch (err: any) {
      this.logger.error('Ошибка при редактировании изображения', err);
      return null;
    }
  }

  /**
   * Отправляет в ассистента сообщение вместе с картинкой
   */
  async chatWithImage(
    content: string,
    userId: number,
    image: Buffer,
  ): Promise<OpenAiAnswer> {
    let threadId = await this.sessionService.getSessionId(userId);
    if (threadId) {
      this.threadMap.set(userId, threadId);
    }
    let thread: { id: string };
    const assistantId = 'asst_q6l4je76YrzysIxzH8rHoXGx';
    
    try {
      if (!threadId) {
        thread = await this.openAi.beta.threads.create();
        threadId = thread.id;
        this.threadMap.set(userId, threadId);
        await this.sessionService.setSessionId(userId, threadId);
      } else {
        thread = { id: threadId };
      }

      // Используем систему блокировки тредов
      return await this.lockThread(threadId, async () => {
        // Проверяем активные runs в треде
        await this.checkAndWaitForActiveRuns(threadId);

        return await this.executeWithRetry(async (client) => {
          // загружаем файл для ассистента
          const prepared = await this.prepareImage(image);
          const fileObj = await toFile(prepared, 'image.png', { type: 'image/png' });
          const file = await client.files.create({
            file: fileObj,
            purpose: 'assistants',
          });

          await client.beta.threads.messages.create(thread.id, {
            role: 'user',
            content: [
              { type: 'text', text: content },
              { type: 'image_file', image_file: { file_id: file.id } },
            ],
          });

          const response = await client.beta.threads.runs.createAndPoll(
            thread.id,
            {
              assistant_id: assistantId,
            },
          );
          
          this.logger.log(`Run завершен со статусом: ${response.status}`);
          
          if (response.status === 'completed') {
            const messages = await client.beta.threads.messages.list(
              response.thread_id,
            );
            const assistantMessage = messages.data[0];
            this.logger.log(`Получен ответ от ассистента, длина: ${JSON.stringify(assistantMessage.content).length} символов`);
            return await this.buildAnswer(assistantMessage);
          } else if (response.status === 'failed') {
            // Получаем детали ошибки
            const runDetails = await client.beta.threads.runs.retrieve(thread.id, response.id);
            this.logger.error(`Run failed с деталями:`, {
              status: response.status,
              lastError: runDetails.last_error,
              requiredAction: runDetails.required_action,
              expiresAt: runDetails.expires_at
            });
            
            // Проверяем, есть ли детали ошибки
            if (runDetails.last_error) {
              throw new Error(`Run failed: ${runDetails.last_error.code} - ${runDetails.last_error.message}`);
            } else {
              throw new Error(`Run завершился со статусом: ${response.status}`);
            }
          } else {
            this.logger.warn(`Run завершился со статусом: ${response.status}`);
            throw new Error(`Run завершился со статусом: ${response.status}`);
          }
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'VECTOR_STORE_EXPIRED') {
        this.logger.log('Создаем новый тред из-за истекшего векторного хранилища');
        // Удаляем старый тред из сессии и создаем новый
        await this.sessionService.setSessionId(userId, null);
        this.threadMap.delete(userId);
        // Рекурсивно вызываем метод с новым тредом
        return await this.chatWithImage(content, userId, image);
      }
      this.logger.error('Ошибка при отправке сообщения с картинкой', error);
      
      // Если это ошибка блокировки треда, возвращаем специальное сообщение
      if (error instanceof Error && error.message.includes('Тред уже занят')) {
        return {
          text: '⏳ Тред уже занят другим запросом. Пожалуйста, дождитесь завершения предыдущего запроса.',
          files: [],
        };
      }
      
      return {
        text: '🤖 Не удалось получить ответ от API. Попробуйте позже',
        files: [],
      };
    }
  }

  /**
   * Оптимизирует промт для генерации видео через специального ассистента
   * @param prompt - исходный промт пользователя
   * @returns Promise<string> - оптимизированный промт
   */
  async optimizeVideoPrompt(prompt: string): Promise<string> {
    try {
      this.logger.log(`Оптимизирую промт для видео: ${prompt}`);
      
      return await this.executeWithRetry(async (client) => {
        // Создаем новый тред для оптимизации промта
        const thread = await client.beta.threads.create();
        
        // Добавляем сообщение пользователя в тред
        await client.beta.threads.messages.create(thread.id, {
          role: 'user',
          content: `Оптимизируй этот промт для генерации видео, сделав его более детальным и подходящим для AI генерации видео: "${prompt}"`,
        });

        // Генерируем ответ ассистента-оптимизатора
        const response = await client.beta.threads.runs.createAndPoll(
          thread.id,
          {
            assistant_id: this.VIDEO_PROMPT_OPTIMIZER_ASSISTANT_ID,
          },
        );

        if (response.status === 'completed') {
          const messages = await client.beta.threads.messages.list(
            response.thread_id,
          );
          const assistantMessage = messages.data[0];
          const optimizedPrompt = (assistantMessage.content?.[0] as any)?.text?.value || prompt;
          
          this.logger.log(`Промт оптимизирован: ${optimizedPrompt}`);
          return optimizedPrompt;
        } else {
          this.logger.warn(`Ассистент-оптимизатор вернул статус: ${response.status}`);
          return prompt; // Возвращаем исходный промт если что-то пошло не так
        }
      });
    } catch (error) {
      this.logger.error('Ошибка при оптимизации промта для видео', error);
      return prompt; // Возвращаем исходный промт в случае ошибки
    }
  }

  /**
   * Отправляет файл вместе с текстом в ассистента
   * content - текстовое сообщение пользователя
   * fileBuffer - содержимое файла
   * filename - имя файла (нужно для корректной передачи в API)
   */
  async chatWithFile(
    content: string,
    userId: number,
    fileBuffer: Buffer,
    filename: string,
  ): Promise<OpenAiAnswer> {
    // Переводим имя файла в нижние буквы и получаем расширение
    const lowerFilename = filename.toLowerCase();
    const fileExtension = lowerFilename.split('.').pop() || '';
    
    // Список поддерживаемых расширений (в нижнем регистре) - только те, что поддерживает OpenAI API
    const supportedExtensions = [
      'c', 'cpp', 'css', 'csv', 'doc', 'docx', 'gif', 'go', 'html', 'java', 
      'jpeg', 'jpg', 'js', 'json', 'md', 'pdf', 'php', 'pkl', 'png', 'pptx', 
      'py', 'rb', 'tar', 'tex', 'ts', 'txt', 'webp', 'xlsx', 'xml', 'zip'
    ];
    
    // Проверяем, поддерживается ли расширение
    if (!supportedExtensions.includes(fileExtension)) {
      const supportedFormats = supportedExtensions.join(', ');
      throw new Error(`Неподдерживаемый формат файла: ${fileExtension}. Поддерживаемые форматы: ${supportedFormats}`);
    }
    
    let threadId = await this.sessionService.getSessionId(userId);
    if (threadId) {
      this.threadMap.set(userId, threadId);
    }
    let thread: { id: string };
    const assistantId = 'asst_q6l4je76YrzysIxzH8rHoXGx';
    
    try {
      if (!threadId) {
        thread = await this.openAi.beta.threads.create();
        threadId = thread.id;
        this.threadMap.set(userId, threadId);
        await this.sessionService.setSessionId(userId, threadId);
      } else {
        thread = { id: threadId };
      }

      this.logger.log(`Обрабатываю файл ${lowerFilename} (${fileBuffer.length} байт) для пользователя ${userId}`);

      // Используем систему блокировки тредов
      return await this.lockThread(threadId, async () => {
        // Проверяем активные runs в треде
        await this.checkAndWaitForActiveRuns(threadId);

        return await this.executeWithRetry(async (client) => {
          try {
            // загружаем файл для ассистента
            this.logger.log(`Загружаю файл ${lowerFilename} в OpenAI API...`);
            const fileObj = await toFile(fileBuffer, lowerFilename);
            const file = await client.files.create({
              file: fileObj,
              purpose: 'assistants',
            });
            this.logger.log(`Файл ${lowerFilename} успешно загружен, ID: ${file.id}`);
            const vectorStore = await client.vectorStores.create({
              name: `for tread ${thread.id}`,
              file_ids: [file.id],
            });
            await client.beta.threads.update(thread.id, {
              tool_resources: {
                file_search: {
                  vector_store_ids: [vectorStore.id],
                },
              },
            });

            await client.beta.threads.messages.create(thread.id, {
              role: 'user',
              content,
            });
            this.logger.log(`Сообщение с файлом добавлено в тред ${thread.id}`);

            this.logger.log(`Запускаю Run для ассистента ${assistantId}...`);
            const response = await client.beta.threads.runs.createAndPoll(
              thread.id,
              {
                assistant_id: assistantId,
              },
            );
            
            this.logger.log(`Run завершен со статусом: ${response.status}`);
            
            if (response.status === 'completed') {
              const messages = await client.beta.threads.messages.list(
                response.thread_id,
              );
              const assistantMessage = messages.data[0];
              this.logger.log(`Получен ответ от ассистента, длина: ${JSON.stringify(assistantMessage.content).length} символов`);
              return await this.buildAnswer(assistantMessage);
            } else if (response.status === 'failed') {
              // Получаем детали ошибки
              const runDetails = await client.beta.threads.runs.retrieve(thread.id, response.id);
              this.logger.error(`Run failed с деталями:`, {
                status: response.status,
                lastError: runDetails.last_error,
                requiredAction: runDetails.required_action,
                expiresAt: runDetails.expires_at
              });
              
              // Проверяем, есть ли детали ошибки
              if (runDetails.last_error) {
                throw new Error(`Run failed: ${runDetails.last_error.code} - ${runDetails.last_error.message}`);
              } else {
                throw new Error(`Run завершился со статусом: ${response.status}`);
              }
            } else {
              this.logger.warn(`Run завершился со статусом: ${response.status}`);
              throw new Error(`Run завершился со статусом: ${response.status}`);
            }
          } catch (error) {
            if (error instanceof Error && error.message === 'VECTOR_STORE_EXPIRED') {
              this.logger.log('Создаем новый тред из-за истекшего векторного хранилища');
              // Удаляем старый тред из сессии и создаем новый
              await this.sessionService.setSessionId(userId, null);
              this.threadMap.delete(userId);
              
              // Рекурсивно вызываем метод с новым тредом
              return await this.chatWithFile(content, userId, fileBuffer, lowerFilename);
            }
            this.logger.error(`Ошибка при обработке файла ${lowerFilename}:`, error);
            throw error;
          }
        });
      });
    } catch (error) {
      this.logger.error('Ошибка при отправке сообщения с файлом', error);
      
      // Если это ошибка блокировки треда, возвращаем специальное сообщение
      if (error instanceof Error && error.message.includes('Тред уже занят')) {
        return {
          text: '⏳ Тред уже занят другим запросом. Пожалуйста, дождитесь завершения предыдущего запроса.',
          files: [],
        };
      }
      
      // Проверяем тип ошибки и даем более конкретный ответ
      if (error instanceof Error) {
        if (error.message.includes('Неподдерживаемый формат файла')) {
          return {
            text: `❌ ${error.message}`,
            files: [],
          };
        } else if (error.message.includes('Run failed')) {
          return {
            text: '🤖 Не удалось обработать файл. Возможно, формат файла не поддерживается или файл слишком большой. Попробуйте отправить файл в другом формате (например, PDF или TXT).',
            files: [],
          };
        } else if (error.message.includes('file size')) {
          return {
            text: '📁 Файл слишком большой для обработки. Максимальный размер: 100MB.',
            files: [],
          };
        }
      }
      
      return {
        text: '🤖 Не удалось получить ответ от API. Попробуйте позже или обратитесь к администратору.',
        files: [],
      };
    }
  }

  /**
   * Получает детальную информацию об ошибке Run
   */
  private async getRunErrorDetails(client: OpenAI, threadId: string, runId: string): Promise<any> {
    try {
      const runDetails = await client.beta.threads.runs.retrieve(threadId, runId);
      return {
        status: runDetails.status,
        lastError: runDetails.last_error,
        requiredAction: runDetails.required_action,
        expiresAt: runDetails.expires_at,
        startedAt: runDetails.started_at,
        completedAt: runDetails.completed_at
      };
    } catch (error) {
      this.logger.error('Ошибка при получении деталей Run:', error);
      return null;
    }
  }

  /**
   * Получает информацию о статусе активных тредов (для отладки)
   */
  getActiveThreadsStatus(): { threadId: string; isActive: boolean }[] {
    const status: { threadId: string; isActive: boolean }[] = [];
    
    // Добавляем информацию о треде из threadMap
    for (const [userId, threadId] of this.threadMap.entries()) {
      status.push({
        threadId: `${threadId} (user: ${userId})`,
        isActive: this.isThreadActive(threadId)
      });
    }
    
    return status;
  }

  /**
   * Получает статус API endpoints
   */
  getApiStatus(): { mainApi: string; fallbackApi: string; isMainApiAvailable: boolean } {
    return {
      mainApi: this.openAi.baseURL || 'https://ai.1devfull.store/v1',
      fallbackApi: this.fallbackOpenAi.baseURL || 'https://api.openai.com/v1',
      isMainApiAvailable: this.isMainApiAvailable
    };
  }

  /**
   * Принудительно проверяет доступность основного API
   */
  async forceCheckMainApi(): Promise<boolean> {
    this.lastMainApiCheck = 0; // Сбрасываем таймер
    return await this.checkMainApiAvailability();
  }

  /**
   * Проверяет состояние ассистента
   */
  async checkAssistantStatus(assistantId: string = 'asst_q6l4je76YrzysIxzH8rHoXGx'): Promise<any> {
    try {
      const client = await this.getActiveOpenAiClient();
      const assistant = await client.beta.assistants.retrieve(assistantId);
      
      return {
        id: assistant.id,
        name: assistant.name,
        description: assistant.description,
        model: assistant.model,
        instructions: assistant.instructions,
        tools: assistant.tools,
        fileIds: (assistant as any).file_ids || [],
        metadata: assistant.metadata,
        createdAt: assistant.created_at,
        status: 'available'
      };
    } catch (error) {
      this.logger.error(`Ошибка при проверке ассистента ${assistantId}:`, error);
      return {
        id: assistantId,
        status: 'unavailable',
        error: error.message
      };
    }
  }

  /**
   * Очищает поврежденные треды
   */
  async cleanupCorruptedThreads(): Promise<{ cleaned: number; errors: number }> {
    let cleaned = 0;
    let errors = 0;
    
    for (const [userId, threadId] of this.threadMap.entries()) {
      try {
        const client = await this.getActiveOpenAiClient();
        await client.beta.threads.retrieve(threadId);
      } catch (error) {
        this.logger.warn(`Тред ${threadId} поврежден, удаляю из кэша`, error);
        this.threadMap.delete(userId);
        await this.sessionService.clearSession(userId);
        cleaned++;
      }
    }
    
    return { cleaned, errors };
  }

  /**
   * Конвертирует файл в JSON используя специального ассистента
   * fileBuffer - содержимое файла
   * filename - имя файла
   * content - текстовое сообщение/инструкция (опционально)
   */
  async fileToJson(
    fileBuffer: Buffer,
    filename: string,
    content?: string,
  ): Promise<any> {
    try {
      this.logger.log(`Конвертирую файл ${filename} в JSON для пользователя через ассистента ${this.FILE_TO_JSON_ASSISTANT_ID}`);

      // Переводим имя файла в нижние буквы и получаем расширение
      const lowerFilename = filename.toLowerCase();
      
      return await this.executeWithRetry(async (client) => {
        try {
          // Создаем новый тред для обработки файла
          const thread = await client.beta.threads.create();
          this.logger.log(`Создан новый тред ${thread.id} для обработки файла`);

          // Загружаем файл для ассистента
          this.logger.log(`Загружаю файл ${lowerFilename} в OpenAI API...`);
          const fileObj = await toFile(fileBuffer, lowerFilename);
          const file = await client.files.create({
            file: fileObj,
            purpose: 'assistants',
          });
          this.logger.log(`Файл ${lowerFilename} успешно загружен, ID: ${file.id}`);

          // Добавляем сообщение пользователя в тред
          const userMessage = content || 'Конвертируй содержимое файла в JSON формат';
          await client.beta.threads.messages.create(thread.id, {
            role: 'user',
            content: userMessage,
            attachments: [
              {
                file_id: file.id,
                tools: [
                  {
                    type: 'file_search',
                  },
                ],
              },
            ],
          });
          this.logger.log(`Сообщение добавлено в тред ${thread.id}`);

          // Запускаем Run с ассистентом для конвертации в JSON
          this.logger.log(`Запускаю Run для ассистента ${this.FILE_TO_JSON_ASSISTANT_ID}...`);
          const response = await client.beta.threads.runs.createAndPoll(
            thread.id,
            {
              assistant_id: this.FILE_TO_JSON_ASSISTANT_ID,
            },
          );

          this.logger.log(`Run завершен со статусом: ${response.status}`);

          if (response.status === 'completed') {
            const messages = await client.beta.threads.messages.list(
              response.thread_id,
            );
            const assistantMessage = messages.data[0];
            this.logger.log(`Получен ответ от ассистента`);

            const answer = await this.buildAnswer(assistantMessage);
            if (answer.files.length > 0) {
              try {
                const buffer = answer.files[0].buffer;
                const jsonResult = JSON.parse(buffer.toString('utf-8'));
                this.logger.log(`Файл ${filename} успешно конвертирован в JSON`);
                return jsonResult;
              } catch (parseError) {
                this.logger.error(`Не удалось распарсить JSON из файла ассистента:`, parseError);
                return { result: answer.files[0].buffer.toString('utf-8') };
              }
            }

            try {
              const jsonResult = JSON.parse(answer.text);
              this.logger.log(`Файл ${filename} успешно конвертирован в JSON`);
              return jsonResult;
            } catch (parseError) {
              this.logger.error(`Не удалось распарсить JSON из ответа ассистента:`, parseError);
              return { result: answer.text };
            }
          } else if (response.status === 'failed') {
            // Получаем детали ошибки
            const runDetails = await client.beta.threads.runs.retrieve(thread.id, response.id);
            this.logger.error(`Run failed с деталями:`, {
              status: response.status,
              lastError: runDetails.last_error,
            });

            if (runDetails.last_error) {
              throw new Error(`Run failed: ${runDetails.last_error.code} - ${runDetails.last_error.message}`);
            } else {
              throw new Error(`Run завершился со статусом: ${response.status}`);
            }
          } else {
            this.logger.warn(`Run завершился со статусом: ${response.status}`);
            throw new Error(`Run завершился со статусом: ${response.status}`);
          }
        } catch (error) {
          this.logger.error(`Ошибка при обработке файла ${lowerFilename}:`, error);
          throw error;
        }
      });
    } catch (error) {
      this.logger.error('Ошибка при конвертации файла в JSON', error);
      throw error;
    }
  }
}
