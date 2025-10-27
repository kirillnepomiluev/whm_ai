import { Controller, Post, Body, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { WebhookService } from './webhook.service';

interface WebhookRequest {
  fileUrl: string;
  filename?: string;
}

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookService: WebhookService) {}

  /**
   * Endpoint для обработки файла из URL
   * POST /webhook/process-file
   * Body: { "fileUrl": "https://example.com/file.pdf", "filename": "optional" }
   */
  @Post('process-file')
  async processFile(@Body() request: WebhookRequest) {
    try {
      this.logger.log(`Получен запрос на обработку файла: ${request.fileUrl}`);

      // Валидация входных данных
      if (!request.fileUrl) {
        throw new HttpException(
          {
            success: false,
            error: 'Не указан URL файла',
            message: 'Параметр fileUrl обязателен',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Обрабатываем файл
      const result = await this.webhookService.processFileFromUrl(
        request.fileUrl,
        request.filename,
      );

      // Возвращаем успешный результат с JSON
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      this.logger.error(`Ошибка при обработке запроса: ${error.message}`, error);

      // Возвращаем ошибку в формате JSON
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          success: false,
          error: error.message || 'Внутренняя ошибка сервера',
          message: 'Не удалось обработать файл',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

