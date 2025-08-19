import { Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { OpenAiService } from './openai/openai.service/openai.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly openAiService: OpenAiService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('api/status')
  getApiStatus() {
    return this.openAiService.getApiStatus();
  }

  @Post('api/check-main-api')
  async checkMainApi() {
    const isAvailable = await this.openAiService.forceCheckMainApi();
    return {
      success: true,
      isMainApiAvailable: isAvailable,
      message: isAvailable ? 'Основной API доступен' : 'Основной API недоступен, используется fallback'
    };
  }

  @Get('api/threads/status')
  getThreadsStatus() {
    return this.openAiService.getActiveThreadsStatus();
  }

  @Get('api/health')
  getHealth() {
    const apiStatus = this.openAiService.getApiStatus();
    const threadsStatus = this.openAiService.getActiveThreadsStatus();
    
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      openai: apiStatus,
      threads: {
        count: threadsStatus.length,
        active: threadsStatus.filter(t => t.isActive).length,
        inactive: threadsStatus.filter(t => !t.isActive).length
      }
    };
  }
}
