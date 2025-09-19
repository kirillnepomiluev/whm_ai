import { Logger } from '@nestjs/common';

export interface RetryOptions {
  maxRetries?: number;
  delay?: number;
  backoffMultiplier?: number;
  retryCondition?: (error: any) => boolean;
}

export class NetworkRetryUtil {
  private static readonly logger = new Logger(NetworkRetryUtil.name);

  /**
   * Выполняет функцию с retry логикой для сетевых ошибок
   */
  static async withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const {
      maxRetries = 3,
      delay = 1000,
      backoffMultiplier = 2,
      retryCondition = NetworkRetryUtil.defaultRetryCondition
    } = options;

    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries || !retryCondition(error)) {
          throw error;
        }

        const waitTime = delay * Math.pow(backoffMultiplier, attempt);
        
        NetworkRetryUtil.logger.warn(
          `Попытка ${attempt + 1}/${maxRetries + 1} неудачна. ` +
          `Ошибка: ${error.message}. ` +
          `Повтор через ${waitTime}мс`
        );

        await NetworkRetryUtil.sleep(waitTime);
      }
    }

    throw lastError;
  }

  /**
   * Проверяет, стоит ли повторить запрос при данной ошибке
   */
  private static defaultRetryCondition(error: any): boolean {
    // DNS ошибки
    if (error.code === 'EAI_AGAIN' || error.code === 'ENOTFOUND') {
      return true;
    }

    // Timeout ошибки
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
      return true;
    }

    // Fetch ошибки с системными кодами
    if (error.type === 'system' && ['EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT'].includes(error.errno)) {
      return true;
    }

    // HTTP 5xx ошибки (серверные)
    if (error.status >= 500 && error.status < 600) {
      return true;
    }

    return false;
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
