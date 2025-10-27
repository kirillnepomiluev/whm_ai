import { Injectable, Logger } from '@nestjs/common';
import { OpenAiService } from '../openai/openai.service/openai.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private readonly openAiService: OpenAiService) {}

  /**
   * Обрабатывает файл из URL - скачивает и конвертирует в JSON
   */
  async processFileFromUrl(fileUrl: string, filename?: string): Promise<any> {
    try {
      this.logger.log(`Скачиваю файл из URL: ${fileUrl}`);

      // Скачиваем файл по URL
      const response = await fetch(fileUrl);
      
      if (!response.ok) {
        throw new Error(`Не удалось скачать файл: ${response.status} ${response.statusText}`);
      }

      // Получаем содержимое файла в виде Buffer
      const arrayBuffer = await response.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);

      this.logger.log(`Файл скачан, размер: ${fileBuffer.length} байт`);

      // Определяем имя файла
      const finalFilename = filename || this.extractFilenameFromUrl(fileUrl);

      // Конвертируем файл в JSON используя OpenAI сервис
      const jsonResult = await this.openAiService.fileToJson(fileBuffer, finalFilename);

      this.logger.log(`Файл успешно конвертирован в JSON`);
      
      return jsonResult;
    } catch (error) {
      this.logger.error(`Ошибка при обработке файла из URL: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Извлекает имя файла из URL
   */
  private extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || 'file';
      
      // Убираем параметры запроса если есть
      return filename.split('?')[0];
    } catch (error) {
      this.logger.warn(`Не удалось извлечь имя файла из URL: ${url}`);
      return 'file';
    }
  }
}

