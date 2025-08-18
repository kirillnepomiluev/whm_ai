import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramModule } from './telegram/telegram.module';
import { OpenaiModule } from './openai/openai.module';
import { VoiceModule } from './voice/voice.module';
import { VideoModule } from './video/video.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'development' ? 'development.env' : '.env',
      expandVariables: true,
    }),
    // Подключение к локальной базе данных проекта
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host: cfg.get<string>('DATABASE_HOST'),
        port: Number(cfg.get<string>('DATABASE_PORT')),
        username: cfg.get<string>('DB_USER'),
        password: cfg.get<string>('DB_PASS'),
        database: cfg.get<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: true,
        // migrations: [__dirname + '/migrations/*{.ts,.js}'],
        // migrationsRun: true,
      }),
    }),
    TelegramModule,
    OpenaiModule,
    VoiceModule,
    VideoModule,
  ],
  //  synchronize: true,
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
