import { Injectable, Logger } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf, Context } from 'telegraf';
import fetch from 'node-fetch';
import { OpenAiService } from '../../openai/openai.service/openai.service';
import { VoiceService } from '../../voice/voice.service/voice.service';
import { VideoService } from '../../video/video.service/video.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from '../../user/entities/user-profile.entity';
import { UserTokens } from '../../user/entities/user-tokens.entity';
import { TokenTransaction } from '../../user/entities/token-transaction.entity';
import { OrderIncome } from '../../user/entities/order-income.entity';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  // текст приветственного сообщения
  private readonly welcomeMessage =
    'Я умный ассистент компании "We have music". Я здесь, чтобы помочь вам с вопросами по лицензированию музыкальных треков, цифровой дистрибьюции и другим связанным темам. Как я могу помочь вам сегодня? 🎶';
  // Стоимость операций в токенах
  private readonly COST_TEXT = 1;
  private readonly COST_IMAGE = 60;
  private readonly COST_VIDEO = 200; // стоимость генерации видео
  private readonly COST_VOICE_RECOGNITION = 1;
  private readonly COST_VOICE_REPLY_EXTRA = 3; // после распознавания
  // обработка документа
  private readonly COST_FILE = 2;

  // Флаги для управления функциями генерации
  private readonly IMAGE_GENERATION_ENABLED = true; // генерация изображений включена
  private readonly VIDEO_GENERATION_ENABLED = false; // генерация видео отключена

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly openai: OpenAiService,
    private readonly voice: VoiceService,
    private readonly video: VideoService,
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
    @InjectRepository(UserTokens)
    private readonly tokensRepo: Repository<UserTokens>,
    @InjectRepository(TokenTransaction)
    private readonly txRepo: Repository<TokenTransaction>,
    @InjectRepository(OrderIncome)
    private readonly incomeRepo: Repository<OrderIncome>,
  ) {
    this.registerHandlers();
  }

  // Создаёт запись о движении токенов
  private async addTransaction(profile: UserProfile, amount: number, type: 'DEBIT' | 'CREDIT', comment?: string, orderIncomeId?: number) {
    const tx = this.txRepo.create({
      userId: profile.id,
      amount,
      type,
      comment,
      orderIncomeId,
    });
    await this.txRepo.save(tx);
  }
  private async sendPhoto(ctx: Context, image: string | Buffer) {
    if (Buffer.isBuffer(image)) {
      // передаём как Buffer
      await ctx.replyWithPhoto({ source: image });
    } else {
      // передаём как URL
      await ctx.replyWithPhoto(image);
    }
  }

  // отправка анимации (GIF/MP4) из папки assets/animations
  // Отправка анимации вместе с текстом и возврат полученного сообщения
  private async sendAnimation(ctx: Context, fileName: string, caption?: string) {
    // Заменяем отправку анимации на простое текстовое сообщение
    return this.sendTextMessage(ctx, caption || '');
  }

  // Отправка текстового сообщения (заменяет анимации)
  private async sendTextMessage(ctx: Context, text: string) {
    return ctx.reply(text);
  }

  // Отправка списка файлов пользователю
  private async sendFiles(ctx: Context, files: { filename: string; buffer: Buffer }[]) {
    for (const f of files) {
      await ctx.replyWithDocument({ source: f.buffer, filename: f.filename });
    }
  }

  // Отправка видео пользователю
  private async sendVideo(ctx: Context, videoBuffer: Buffer, caption?: string) {
    try {
      await ctx.replyWithVideo({ source: videoBuffer }, caption ? { caption } : undefined);
    } catch (error) {
      this.logger.error('Ошибка при отправке видео', error);
      // Если не удалось отправить как видео, пробуем как документ
      await ctx.replyWithDocument({ source: videoBuffer, filename: 'generated_video.mp4' });
    }
  }

  // Обновление прогресса генерации видео
  private async updateVideoProgress(ctx: Context, messageId: number, status: string, attempt: number, _maxAttempts: number) {
    try {
      void _maxAttempts;
      const elapsedSeconds = attempt * 10;
      const progressText = `СОЗДАЮ ВИДЕО ---- ${elapsedSeconds}с ---- ${status}`;
      await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, progressText);
    } catch (error) {
      this.logger.error('Ошибка при обновлении прогресса видео', error);
    }
  }

  // Обновление прогресса генерации изображения
  private async updateImageProgress(ctx: Context, messageId: number, attempt: number, maxAttempts: number) {
    try {
      const elapsedSeconds = attempt * 10;
      const progressText = `РИСУЮ ---- ${elapsedSeconds}с ---- ${attempt}/${maxAttempts}`;
      await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, progressText);
    } catch (error) {
      this.logger.error('Ошибка при обновлении прогресса изображения', error);
    }
  }

  // Генерация изображения с обновлением прогресса
  private async generateImageWithProgress(ctx: Context, prompt: string, progressMsg: any): Promise<string | Buffer | null> {
    const maxAttempts = 6; // максимум 1 минута ожидания (6 * 10 секунд)
    let attempts = 0;

    // Запускаем обновление прогресса каждые 10 секунд
    const progressInterval = setInterval(async () => {
      attempts++;
      if (attempts <= maxAttempts) {
        await this.updateImageProgress(ctx, progressMsg.message_id, attempts, maxAttempts);
      }
    }, 10000);

    try {
      // Генерируем изображение
      const image = await this.openai.generateImage(prompt);

      // Останавливаем обновление прогресса
      clearInterval(progressInterval);

      return image;
    } catch (error) {
      // Останавливаем обновление прогресса в случае ошибки
      clearInterval(progressInterval);
      throw error;
    }
  }

  // Генерация изображения на основе фото с обновлением прогресса
  private async generateImageFromPhotoWithProgress(
    ctx: Context,
    imageBuffer: Buffer,
    prompt: string,
    progressMsg: any,
  ): Promise<string | Buffer | null> {
    const maxAttempts = 6; // максимум 1 минута ожидания (6 * 10 секунд)
    let attempts = 0;

    // Запускаем обновление прогресса каждые 10 секунд
    const progressInterval = setInterval(async () => {
      attempts++;
      if (attempts <= maxAttempts) {
        await this.updateImageProgress(ctx, progressMsg.message_id, attempts, maxAttempts);
      }
    }, 10000);

    try {
      // Генерируем изображение на основе фото
      const image = await this.openai.generateImageFromPhoto(imageBuffer, prompt);

      // Останавливаем обновление прогресса
      clearInterval(progressInterval);

      return image;
    } catch (error) {
      // Останавливаем обновление прогресса в случае ошибки
      clearInterval(progressInterval);
      throw error;
    }
  }

  /** Списывает cost токенов. При нехватке сообщает без предложений подписки */
  private async chargeTokens(ctx: Context, profile: UserProfile, cost: number): Promise<boolean> {
    if (profile.tokens.tokens < cost) {
      await ctx.reply('На вашем балансе недостаточно токенов.');
      return false;
    }
    profile.tokens.tokens -= cost;
    await this.tokensRepo.save(profile.tokens);
    await this.addTransaction(profile, cost, 'DEBIT');
    return true;
  }

  /**
   * Создание профиля при отсутствии в локальной базе
   */
  private async findOrCreateProfile(from: { id: number; first_name?: string; username?: string }): Promise<UserProfile> {
    let profile = await this.profileRepo.findOne({
      where: { telegramId: String(from.id) },
      relations: ['tokens'],
    });

    const now = new Date();
    if (!profile) {
      profile = this.profileRepo.create({
        telegramId: String(from.id),
        firstName: from.first_name,
        username: from.username,
        firstVisitAt: now,
        lastMessageAt: now,
      });
      profile = await this.profileRepo.save(profile);
      let tokens = this.tokensRepo.create({ userId: profile.id });
      tokens = await this.tokensRepo.save(tokens);
      profile.userTokensId = tokens.id;
      await this.profileRepo.save(profile);
      profile.tokens = tokens;
      await this.addTransaction(profile, tokens.tokens, 'CREDIT', 'initial balance');
    } else {
      profile.lastMessageAt = now;
      await this.profileRepo.save(profile);
      if (!profile.tokens) {
        profile.tokens = await this.tokensRepo.findOne({ where: { userId: profile.id } });
      }
    }

    if (!profile.tokens) {
      let tokens = this.tokensRepo.create({ userId: profile.id });
      tokens = await this.tokensRepo.save(tokens);
      profile.userTokensId = tokens.id;
      await this.profileRepo.save(profile);
      profile.tokens = tokens;
      await this.addTransaction(profile, tokens.tokens, 'CREDIT', 'initial balance');
    }

    // Автоприветствие перенесено в ветку после успешной верификации e-mail

    return profile;
  }

  /** Всегда создаёт (при необходимости) и возвращает локальный профиль */
  private async ensureUser(ctx: Context): Promise<UserProfile | null> {
    const from = ctx.message.from;
    const profile = await this.findOrCreateProfile(from);
    return profile;
  }

  private async processOpenAiRequest(ctx: Context, q: string, user: UserProfile, thinkingMsg: any) {
    try {
      const answer = await this.openai.chat(q, ctx.message.from.id);
      await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id);

      if (answer.text.startsWith('/video')) {
        if (!this.VIDEO_GENERATION_ENABLED) {
          await ctx.reply('🚫 Генерация видео временно отключена');
          return;
        }
        if (!(await this.chargeTokens(ctx, user, this.COST_VIDEO))) return;
        const prompt = answer.text.replace('/video', '').trim();
        if (!prompt) {
          await ctx.reply('Пожалуйста, укажите описание для генерации видео после команды /video');
          return;
        }

        // Отправляем сообщение об оптимизации запроса
        const optimizeMsg = await this.sendAnimation(ctx, 'thinking_pen_a.mp4', 'ОПТИМИЗИРУЮ ЗАПРОС ...');

        // Генерируем видео (внутри будет оптимизация промта)
        const videoResult = await this.video.generateVideo(prompt, {
          onProgress: (status, attempt, maxAttempts) => {
            // Обновляем сообщение на "СОЗДАЮ ВИДЕО" когда начинается генерация
            if (attempt === 0) {
              this.updateVideoProgress(ctx, optimizeMsg.message_id, 'СОЗДАЮ ВИДЕО', attempt, maxAttempts);
            } else {
              this.updateVideoProgress(ctx, optimizeMsg.message_id, status, attempt, maxAttempts);
            }
          },
        });

        // Удаляем сообщение с прогрессом
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, optimizeMsg.message_id);
        } catch (error) {
          this.logger.warn('Не удалось удалить сообщение с прогрессом', error);
        }

        if (videoResult.success && videoResult.videoUrl) {
          const videoBuffer = await this.video.downloadVideo(videoResult.videoUrl);
          if (videoBuffer) {
            await this.sendVideo(ctx, videoBuffer, `Видео по запросу: "${prompt}"`);
          } else {
            await ctx.reply('Не удалось скачать сгенерированное видео');
          }
        } else {
          await ctx.reply(`Не удалось сгенерировать видео: ${videoResult.error}`);
        }
      } else if (answer.text.startsWith('/imagine')) {
        if (!this.IMAGE_GENERATION_ENABLED) {
          await ctx.reply('🚫 Генерация изображений временно отключена');
          return;
        }
        if (!(await this.chargeTokens(ctx, user, this.COST_IMAGE))) return;
        const drawMsg = await this.sendAnimation(ctx, 'drawing_a.mp4', 'РИСУЮ ...');
        const prompt = answer.text.replace('/imagine', '').trim();
        const image = await this.generateImageWithProgress(ctx, prompt, drawMsg);
        await ctx.telegram.deleteMessage(ctx.chat.id, drawMsg.message_id);
        if (image) {
          await this.sendPhoto(ctx, image);
        } else {
          await ctx.reply('Не удалось сгенерировать изображение');
        }
      } else {
        if (!(await this.chargeTokens(ctx, user, this.COST_TEXT))) return;
        await ctx.reply(answer.text);
      }
      if (answer.files.length) {
        await this.sendFiles(ctx, answer.files);
      }
    } catch (error) {
      // Удаляем сообщение "ДУМАЮ" в случае ошибки
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id);
      } catch (deleteError) {
        this.logger.warn('Не удалось удалить сообщение "ДУМАЮ"', deleteError);
      }

      // Проверяем, является ли это ошибкой занятого треда
      if (error instanceof Error && error.message.includes('Тред уже занят')) {
        await ctx.reply('⏳ Тред уже занят другим запросом. Пожалуйста, дождитесь завершения предыдущего запроса.');
      } else {
        // Для других ошибок логируем и отправляем общее сообщение
        this.logger.error('Ошибка при обработке запроса OpenAI', error);
        await ctx.reply('Произошла ошибка при обработке вашего запроса. Попробуйте позже.');
      }
      return; // Выходим из обработки, так как произошла ошибка
    }
  }

  private registerHandlers() {
    // Простое состояние ожидания e-mail по userId
    const awaitingEmail = new Set<number>();
    const emailVerified = new Set<number>();

    const isEmail = (text: string) => {
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text.toLowerCase());
    };

    // Глобальный мидлвар: если ждём e-mail, блокируем остальные хендлеры
    this.bot.use(async (ctx, next) => {
      const userId = (ctx.from as any)?.id as number | undefined;
      if (!userId) return next();

      // Разрешаем /start всегда
      const text = (ctx as any).message?.text as string | undefined;
      if (text?.startsWith('/start')) {
        return next();
      }

      // Если e-mail уже верифицирован — пропускаем
      if (emailVerified.has(userId)) {
        return next();
      }

      // Если не ожидаем e-mail — пропускаем
      if (!awaitingEmail.has(userId)) {
        return next();
      }

      // Ожидаем только текст с e-mail
      if (!text) {
        await ctx.reply('✉️ Чтобы продолжить, отправьте ваш e-mail от профиля We Have Music.');
        return;
      }

      const email = text.trim();
      if (!isEmail(email)) {
        await ctx.reply('⚠️ Некорректный e-mail. Пожалуйста, укажите e-mail, зарегистрированный на We Have Music.');
        return;
      }

      // Проверяем на бэкенде
      try {
        // Пытаемся как GET c query string, при ошибке пробуем POST JSON
        const url = `https://api.wehavemusic.tech/user/exists-by-email?email=${encodeURIComponent(email)}`;
        const secret = process.env.TELEGRAM_BOT_SECRET || process.env.X_TELEGRAM_BOT_SECRET;
        const baseHeaders: any = secret ? { 'x-telegram-bot-secret': secret } : {};
        let res = await fetch(url, { method: 'GET', headers: baseHeaders, timeout: 20000 as any });
        if (!res.ok) {
          // fallback на POST
          res = await fetch('https://api.wehavemusic.tech/user/exists-by-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...baseHeaders },
            body: JSON.stringify({ email }),
            timeout: 20000 as any,
          });
        }

        if (!res.ok) {
          const bodyText = await res.text().catch(() => '');
          this.logger.warn(`Email check failed after fallback: status=${res.status}, bodyPreview=${bodyText.slice(0, 500)}`);
          await ctx.reply('😕 Не удалось проверить e-mail. Попробуйте позже.');
          return;
        }

        const data: any = await res.json().catch(() => ({}));
        // Ожидаем поле exists=true/false, иначе допускаем по 2xx
        const exists = typeof data?.exists === 'boolean' ? data.exists : true;

        if (!exists) {
          await ctx.reply('❌ Этот e-mail не найден. Убедитесь, что вы используете e-mail из We Have Music и отправьте снова.');
          return;
        }

        awaitingEmail.delete(userId);
        emailVerified.add(userId);
        await ctx.reply('✅ Спасибо! E-mail подтверждён.');
        await this.sendAnimation(ctx, 'cute_a.mp4', this.welcomeMessage);
        return;
      } catch (err) {
        this.logger.error('Ошибка проверки e-mail', err);
        await ctx.reply('⚠️ Произошла ошибка при проверке e-mail. Попробуйте позже.');
        return;
      }
    });

    this.bot.on('text', async (ctx, next) => {
      try {
        const q = ctx.message.text?.trim();
        if (q?.startsWith('/start')) {
          return next();
        }
        const user = await this.ensureUser(ctx);
        if (!user) return;
        if (!q) return;

        // пропускаем другие команды, кроме '/image', '/video', чтобы они обработались далее
        if (q.startsWith('/') && !q.startsWith('/image') && !q.startsWith('/imagine') && !q.startsWith('/video')) {
          return next();
        }

        if (q.startsWith('/video')) {
          if (!this.VIDEO_GENERATION_ENABLED) {
            await ctx.reply('🚫 Генерация видео временно отключена');
            return;
          }
          if (!(await this.chargeTokens(ctx, user, this.COST_VIDEO))) return;
          const prompt = q.replace('/video', '').trim();
          if (!prompt) {
            await ctx.reply('Пожалуйста, укажите описание для генерации видео после команды /video');
            return;
          }

          // Отправляем сообщение об оптимизации запроса
          const optimizeMsg = await this.sendAnimation(ctx, 'thinking_pen_a.mp4', 'ОПТИМИЗИРУЮ ЗАПРОС ...');

          // Генерируем видео (внутри будет оптимизация промта)
          const videoResult = await this.video.generateVideo(prompt, {
            onProgress: (status, attempt, maxAttempts) => {
              // Обновляем сообщение на "СОЗДАЮ ВИДЕО" когда начинается генерация
              if (attempt === 0) {
                this.updateVideoProgress(ctx, optimizeMsg.message_id, 'СОЗДАЮ ВИДЕО', attempt, maxAttempts);
              } else {
                this.updateVideoProgress(ctx, optimizeMsg.message_id, status, attempt, maxAttempts);
              }
            },
          });

          // Удаляем сообщение с прогрессом
          try {
            await ctx.telegram.deleteMessage(ctx.chat.id, optimizeMsg.message_id);
          } catch (error) {
            this.logger.warn('Не удалось удалить сообщение с прогрессом', error);
          }

          if (videoResult.success && videoResult.videoUrl) {
            const videoBuffer = await this.video.downloadVideo(videoResult.videoUrl);
            if (videoBuffer) {
              await this.sendVideo(ctx, videoBuffer, `Видео по запросу: "${prompt}"`);
            } else {
              await ctx.reply('Не удалось скачать сгенерированное видео');
            }
          } else {
            await ctx.reply(`Не удалось сгенерировать видео: ${videoResult.error}`);
          }
        } else if (q.startsWith('/image')) {
          if (!this.IMAGE_GENERATION_ENABLED) {
            await ctx.reply('🚫 Генерация изображений временно отключена');
            return;
          }
          if (!(await this.chargeTokens(ctx, user, this.COST_IMAGE))) return;
          const placeholder = await this.sendAnimation(ctx, 'drawing_a.mp4', 'РИСУЮ ...');
          const prompt = q.replace('/image', '').trim();
          const image = await this.generateImageWithProgress(ctx, prompt, placeholder);
          await ctx.telegram.deleteMessage(ctx.chat.id, placeholder.message_id);
          if (image) {
            await this.sendPhoto(ctx, image);
          } else {
            await ctx.reply('Не удалось сгенерировать изображение');
          }
        } else {
          // Текстовый чат
          // показываем пользователю, что мы "думаем" над ответом
          const thinkingMsg = await this.sendAnimation(ctx, 'thinking_pen_a.mp4', 'ДУМАЮ ...');

          // Обрабатываем запрос асинхронно, не блокируя другие сообщения
          this.processOpenAiRequest(ctx, q, user, thinkingMsg).catch((error) => {
            this.logger.error('Ошибка при асинхронной обработке OpenAI запроса', error);
          });
        }
      } catch (err) {
        this.logger.error('Ошибка обработки текстового сообщения', err);
        await ctx.reply('Произошла ошибка при обработке вашего сообщения');
      }
    });

    this.bot.on('voice', async (ctx) => {
      try {
        const user = await this.ensureUser(ctx);
        if (!user) return;
        if (!(await this.chargeTokens(ctx, user, this.COST_VOICE_RECOGNITION))) return;
        const tgVoice = ctx.message.voice;
        const listenMsg = await this.sendAnimation(ctx, 'listen_a.mp4', 'СЛУШАЮ ...');
        const text = await this.voice.voiceToText(tgVoice);
        await ctx.telegram.deleteMessage(ctx.chat.id, listenMsg.message_id);
        if (!text) return;

        const cleaned = text.trim().toLowerCase();
        if (cleaned.startsWith('создай видео') || cleaned.startsWith('video')) {
          if (!this.VIDEO_GENERATION_ENABLED) {
            await ctx.reply('🚫 Генерация видео временно отключена');
            return;
          }
          if (!(await this.chargeTokens(ctx, user, this.COST_VIDEO))) return;

          // Отправляем сообщение об оптимизации запроса
          const optimizeMsg = await this.sendAnimation(ctx, 'thinking_pen_a.mp4', 'ОПТИМИЗИРУЮ ЗАПРОС ...');

          // Генерируем видео (внутри будет оптимизация промта)
          const videoResult = await this.video.generateVideo(text, {
            onProgress: (status, attempt, maxAttempts) => {
              // Обновляем сообщение на "СОЗДАЮ ВИДЕО" когда начинается генерация
              if (attempt === 0) {
                this.updateVideoProgress(ctx, optimizeMsg.message_id, 'СОЗДАЮ ВИДЕО', attempt, maxAttempts);
              } else {
                this.updateVideoProgress(ctx, optimizeMsg.message_id, status, attempt, maxAttempts);
              }
            },
          });

          // Удаляем сообщение с прогрессом
          try {
            await ctx.telegram.deleteMessage(ctx.chat.id, optimizeMsg.message_id);
          } catch (error) {
            this.logger.warn('Не удалось удалить сообщение с прогрессом', error);
          }

          if (videoResult.success && videoResult.videoUrl) {
            const videoBuffer = await this.video.downloadVideo(videoResult.videoUrl);
            if (videoBuffer) {
              await this.sendVideo(ctx, videoBuffer, `Видео по запросу: "${text}"`);
            } else {
              await ctx.reply('Не удалось скачать сгенерированное видео');
            }
          } else {
            await ctx.reply(`Не удалось сгенерировать видео: ${videoResult.error}`);
          }
        } else if (cleaned.startsWith('нарисуй') || cleaned.startsWith('imagine')) {
          if (!this.IMAGE_GENERATION_ENABLED) {
            await ctx.reply('🚫 Генерация изображений временно отключена');
            return;
          }
          if (!(await this.chargeTokens(ctx, user, this.COST_IMAGE))) return;
          const placeholder = await this.sendAnimation(ctx, 'drawing_a.mp4', 'РИСУЮ ...');
          const image = await this.generateImageWithProgress(ctx, text, placeholder);
          await ctx.telegram.deleteMessage(ctx.chat.id, placeholder.message_id);
          if (image) {
            await this.sendPhoto(ctx, image);
          } else {
            await ctx.reply('Не удалось сгенерировать изображение по голосовому сообщению');
          }
        } else {
          const thinkingMsg = await this.sendAnimation(ctx, 'thinking_pen_a.mp4', 'ДУМАЮ ...');

          try {
            const answer = await this.openai.chat(text, ctx.message.from.id);

            // Удаляем сообщение "ДУМАЮ" только после успешного получения ответа
            await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id);

            if (answer.text.startsWith('/video')) {
              if (!this.VIDEO_GENERATION_ENABLED) {
                await ctx.reply('🚫 Генерация видео временно отключена');
                return;
              }
              if (!(await this.chargeTokens(ctx, user, this.COST_VIDEO))) return;
              const prompt = answer.text.replace('/video', '').trim();
              if (!prompt) {
                await ctx.reply('Пожалуйста, укажите описание для генерации видео после команды /video');
                return;
              }

              // Отправляем сообщение об оптимизации запроса
              const optimizeMsg = await this.sendAnimation(ctx, 'thinking_pen_a.mp4', 'ОПТИМИЗИРУЮ ЗАПРОС ...');

              // Генерируем видео (внутри будет оптимизация промта)
              const videoResult = await this.video.generateVideo(prompt, {
                onProgress: (status, attempt, maxAttempts) => {
                  // Обновляем сообщение на "СОЗДАЮ ВИДЕО" когда начинается генерация
                  if (attempt === 0) {
                    this.updateVideoProgress(ctx, optimizeMsg.message_id, 'СОЗДАЮ ВИДЕО', attempt, maxAttempts);
                  } else {
                    this.updateVideoProgress(ctx, optimizeMsg.message_id, status, attempt, maxAttempts);
                  }
                },
              });
              if (videoResult.success && videoResult.videoUrl) {
                const videoBuffer = await this.video.downloadVideo(videoResult.videoUrl);
                if (videoBuffer) {
                  await this.sendVideo(ctx, videoBuffer, `Видео по запросу: "${text}"`);
                } else {
                  await ctx.reply('Не удалось скачать сгенерированное видео');
                }
              } else {
                await ctx.reply(`Не удалось сгенерировать видео: ${videoResult.error}`);
              }
            } else if (answer.text.startsWith('/imagine')) {
              if (!this.IMAGE_GENERATION_ENABLED) {
                await ctx.reply('🚫 Генерация изображений временно отключена');
                return;
              }
              if (!(await this.chargeTokens(ctx, user, this.COST_IMAGE))) return;
              const drawMsg = await this.sendAnimation(ctx, 'drawing_a.mp4', 'РИСУЮ ...');
              const prompt = answer.text.replace('/imagine', '').trim();
              const image = await this.generateImageWithProgress(ctx, prompt, drawMsg);
              await ctx.telegram.deleteMessage(ctx.chat.id, drawMsg.message_id);
              if (image) {
                await this.sendPhoto(ctx, image);
              } else {
                await ctx.reply('Не удалось сгенерировать изображение');
              }
            } else {
              if (!(await this.chargeTokens(ctx, user, this.COST_VOICE_REPLY_EXTRA))) return;
              const recordMsg = await this.sendAnimation(ctx, 'play_a.mp4', 'ЗАПИСЫВАЮ ...');
              const ogg = await this.voice.textToSpeech(answer.text);
              await ctx.telegram.deleteMessage(ctx.chat.id, recordMsg.message_id);
              try {
                await ctx.replyWithVoice({ source: ogg });
              } catch (err) {
                this.logger.warn('Голосовые сообщения запрещены', err);
                await ctx.reply(answer.text);
              }
            }
            if (answer.files.length) {
              await this.sendFiles(ctx, answer.files);
            }
          } catch (error) {
            // Удаляем сообщение "ДУМАЮ" в случае ошибки
            try {
              await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id);
            } catch (deleteError) {
              this.logger.warn('Не удалось удалить сообщение "ДУМАЮ"', deleteError);
            }

            // Проверяем, является ли это ошибкой занятого треда
            if (error instanceof Error && error.message.includes('Тред уже занят')) {
              await ctx.reply('⏳ Тред уже занят другим запросом. Пожалуйста, дождитесь завершения предыдущего запроса.');
            } else {
              // Для других ошибок логируем и отправляем общее сообщение
              this.logger.error('Ошибка при обработке голосового запроса OpenAI', error);
              await ctx.reply('Произошла ошибка при обработке вашего голосового запроса. Попробуйте позже.');
            }
            return; // Выходим из обработки, так как произошла ошибка
          }
        }
      } catch (err) {
        this.logger.error('Ошибка обработки голосового сообщения', err);
        await ctx.reply('Произошла ошибка при обработке вашего голосового сообщения');
      }
    });

    // обработка изображений, отправленных пользователем
    this.bot.on('photo', async (ctx) => {
      try {
        const caption = ctx.message.caption?.trim() ?? '';
        const user = await this.ensureUser(ctx);
        if (!user) return;

        const photos = ctx.message.photo;
        const best = photos[photos.length - 1];
        const link = await ctx.telegram.getFileLink(best.file_id);
        const res = await fetch(link.href);
        if (!res.ok) throw new Error(`TG download error: ${res.statusText}`);
        const buffer = Buffer.from(await res.arrayBuffer());

        if (caption.startsWith('/image')) {
          if (!this.IMAGE_GENERATION_ENABLED) {
            await ctx.reply('🚫 Генерация изображений временно отключена');
            return;
          }
          if (!(await this.chargeTokens(ctx, user, this.COST_IMAGE))) return;
          const drawMsg = await this.sendAnimation(ctx, 'drawing_a.mp4', 'РИСУЮ ...');
          const prompt = caption.replace('/image', '').trim();
          const image = await this.generateImageFromPhotoWithProgress(ctx, buffer, prompt, drawMsg);
          await ctx.telegram.deleteMessage(ctx.chat.id, drawMsg.message_id);
          if (image) {
            await this.sendPhoto(ctx, image);
          } else {
            await ctx.reply('Не удалось сгенерировать изображение');
          }
        } else if (caption.startsWith('/video')) {
          if (!this.VIDEO_GENERATION_ENABLED) {
            await ctx.reply('🚫 Генерация видео временно отключена');
            return;
          }
          if (!(await this.chargeTokens(ctx, user, this.COST_VIDEO))) return;
          const prompt = caption.replace('/video', '').trim();
          if (!prompt) {
            await ctx.reply('Пожалуйста, укажите описание для генерации видео после команды /video');
            return;
          }

          // Отправляем сообщение об оптимизации запроса
          const optimizeMsg = await this.sendAnimation(ctx, 'thinking_pen_a.mp4', 'ОПТИМИЗИРУЮ ЗАПРОС ...');

          // Генерируем видео по изображению (внутри будет оптимизация промта)
          const videoResult = await this.video.generateVideoFromImage(buffer, prompt, {
            onProgress: (status, attempt, maxAttempts) => {
              // Обновляем сообщение на "СОЗДАЮ ВИДЕО" когда начинается генерация
              if (attempt === 0) {
                this.updateVideoProgress(ctx, optimizeMsg.message_id, 'СОЗДАЮ ВИДЕО', attempt, maxAttempts);
              } else {
                this.updateVideoProgress(ctx, optimizeMsg.message_id, status, attempt, maxAttempts);
              }
            },
          });

          // Удаляем сообщение с прогрессом
          try {
            await ctx.telegram.deleteMessage(ctx.chat.id, optimizeMsg.message_id);
          } catch (error) {
            this.logger.warn('Не удалось удалить сообщение с прогрессом', error);
          }

          if (videoResult.success && videoResult.videoUrl) {
            const videoBuffer = await this.video.downloadVideo(videoResult.videoUrl);
            if (videoBuffer) {
              await this.sendVideo(ctx, videoBuffer, `Видео по изображению: "${prompt}"`);
            } else {
              await ctx.reply('Не удалось скачать сгенерированное видео');
            }
          } else {
            await ctx.reply(`Не удалось сгенерировать видео: ${videoResult.error}`);
          }
        } else {
          if (!(await this.chargeTokens(ctx, user, this.COST_TEXT))) return;
          const thinkingMsg = await this.sendAnimation(ctx, 'thinking_pen_a.mp4', 'ДУМАЮ ...');
          const answer = await this.openai.chatWithImage(caption, ctx.message.from.id, buffer);
          await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id);
          await ctx.reply(answer.text);
          if (answer.files.length) {
            await this.sendFiles(ctx, answer.files);
          }
        }
      } catch (err) {
        this.logger.error('Ошибка обработки фото', err);
        await ctx.reply('Произошла ошибка при обработке изображения');
      }
    });

    // обработка документов (pdf, doc и др.)
    this.bot.on('document', async (ctx) => {
      try {
        const caption = ctx.message.caption?.trim() ?? '';
        const user = await this.ensureUser(ctx);
        if (!user) return;

        const doc = ctx.message.document;

        // Проверяем размер файла (максимум 100MB)
        const maxFileSize = 100 * 1024 * 1024; // 100MB в байтах
        if (doc.file_size && doc.file_size > maxFileSize) {
          await ctx.reply(`📁 Файл слишком большой (${(doc.file_size / 1024 / 1024).toFixed(1)}MB). Максимальный размер: 100MB.`);
          return;
        }

        // Проверяем поддерживаемые форматы файлов (используем тот же список, что и в OpenAiService)
        const supportedFormats = [
          '.c',
          '.cpp',
          '.css',
          '.csv',
          '.doc',
          '.docx',
          '.gif',
          '.go',
          '.html',
          '.java',
          '.jpeg',
          '.jpg',
          '.js',
          '.json',
          '.md',
          '.pdf',
          '.php',
          '.pkl',
          '.png',
          '.pptx',
          '.py',
          '.rb',
          '.tar',
          '.tex',
          '.ts',
          '.txt',
          '.webp',
          '.xlsx',
          '.xml',
          '.zip',
        ];
        const fileExtension = doc.file_name ? doc.file_name.toLowerCase().substring(doc.file_name.lastIndexOf('.')) : '';

        if (!supportedFormats.includes(fileExtension)) {
          await ctx.reply(`📄 Формат файла ${fileExtension} не поддерживается. Поддерживаемые форматы: ${supportedFormats.join(', ')}`);
          return;
        }

        this.logger.log(`Обрабатываю документ: ${doc.file_name}, размер: ${doc.file_size} байт, формат: ${fileExtension}`);

        const link = await ctx.telegram.getFileLink(doc.file_id);
        const res = await fetch(link.href);
        if (!res.ok) throw new Error(`TG download error: ${res.statusText}`);
        const buffer = Buffer.from(await res.arrayBuffer());

        if (!(await this.chargeTokens(ctx, user, this.COST_FILE))) return;

        const thinkingMsg = await this.sendAnimation(ctx, 'thinking_pen_a.mp4', 'ДУМАЮ ...');

        try {
          const answer = await this.openai.chatWithFile(caption || ' ', ctx.message.from.id, buffer, doc.file_name || 'file');
          await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id);
          await ctx.reply(answer.text);
          if (answer.files.length) {
            await this.sendFiles(ctx, answer.files);
          }
        } catch (error) {
          await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id);
          this.logger.error('Ошибка OpenAI при обработке документа:', error);

          // Даем пользователю понятное сообщение об ошибке
          if (error instanceof Error) {
            if (error.message.includes('Неподдерживаемый формат файла')) {
              await ctx.reply(`❌ ${error.message}`);
            } else if (error.message.includes('Run failed')) {
              await ctx.reply(
                '🤖 Не удалось обработать файл. Возможно, формат файла не поддерживается или файл поврежден. Попробуйте отправить файл в другом формате.',
              );
            } else if (error.message.includes('file size')) {
              await ctx.reply('📁 Файл слишком большой для обработки.');
            } else {
              await ctx.reply('🤖 Произошла ошибка при обработке файла. Попробуйте позже или обратитесь к администратору.');
            }
          } else {
            await ctx.reply('🤖 Произошла неизвестная ошибка при обработке файла.');
          }
        }
      } catch (err) {
        this.logger.error('Ошибка обработки документа', err);
        await ctx.reply('Произошла ошибка при обработке документа');
      }
    });

    this.bot.command('img', async (ctx) => {
      try {
        const user = await this.ensureUser(ctx);
        if (!user) return;
        if (!this.IMAGE_GENERATION_ENABLED) {
          await ctx.reply('🚫 Генерация изображений временно отключена');
          return;
        }
        if (!(await this.chargeTokens(ctx, user, this.COST_IMAGE))) return;
        const prompt = ctx.message.text.replace('/img', '').trim();
        const placeholder = await this.sendAnimation(ctx, 'drawing_a.mp4', 'РИСУЮ ...');
        const image = await this.generateImageWithProgress(ctx, prompt, placeholder);
        await ctx.telegram.deleteMessage(ctx.chat.id, placeholder.message_id);
        if (image) {
          await this.sendPhoto(ctx, image);
        } else {
          await ctx.reply('Не удалось сгенерировать изображения');
        }
      } catch (err) {
        this.logger.error('Ошибка команды img', err);
        await ctx.reply('Ошибка при выполнении команды /img');
      }
    });

    // команда /hello выводит приветственное сообщение
    this.bot.command('hello', async (ctx) => {
      await this.findOrCreateProfile(ctx.message.from);
      await this.sendAnimation(ctx, 'cute_a.mp4', this.welcomeMessage);
    });
    // поддерживаем вариант без слеша
    this.bot.hears(/^hello$/i, async (ctx) => {
      await this.findOrCreateProfile(ctx.message.from);
      await this.sendAnimation(ctx, 'cute_a.mp4', this.welcomeMessage);
    });

    // общая функция-обработчик команды /profile и текста "profile"
    const profileHandler = async (ctx: Context) => {
      const profile = await this.findOrCreateProfile(ctx.message.from);

      const userParts = [] as string[];
      if (profile.firstName) userParts.push(profile.firstName);
      if (profile.username) userParts.push(`@${profile.username}`);
      const userInfo = userParts.join(' ').trim() || profile.telegramId;

      const message =
        `Данные пользователя: <b>${userInfo}</b>\n` +
        `Ваш баланс: <b>${profile.tokens.tokens} токенов</b>\n\n` +
        `📋 <b>Инструкция по использованию:</b>\n\n` +
        `🎨 <b>Генерация изображений:</b>\n` +
        `• Команда: <code>/image [описание]</code>\n` +
        `• Пример: <code>/image красивая кошка</code>\n` +
        `• Стоимость: <b>${this.COST_IMAGE} токенов</b>\n\n` +
        `🎵 <b>Работа с аудио:</b>\n` +
        `• Распознавание речи: <b>${this.COST_VOICE_RECOGNITION} токен</b>\n` +
        `• Генерация ответа: <b>${this.COST_VOICE_REPLY_EXTRA} токена</b>\n\n` +
        `📄 <b>Обработка документов:</b>\n` +
        `• Стоимость: <b>${this.COST_FILE} токена</b>\n\n` +
        `💬 <b>Текстовые запросы:</b>\n` +
        `• Стоимость: <b>${this.COST_TEXT} токен</b>`;

      await ctx.reply(message, {
        parse_mode: 'HTML',
      });
    };

    // команда для просмотра баланса и получения пригласительной ссылки
    this.bot.command('profile', profileHandler);
    // поддерживаем вариант без слеша
    this.bot.hears(/^profile$/i, profileHandler);

    // /start: если есть payload (deeplink с сайта) — сразу приветствуем; иначе просим e-mail
    this.bot.start(async (ctx) => {
      const from = ctx.from as any;
      const userId = from?.id as number | undefined;
      if (!userId) return;

      // Определяем payload: telegraf кладёт в ctx.startPayload; дополнительно парсим текст
      const payload = (ctx as any).startPayload ?? (((ctx as any).message?.text || '').split(' ').slice(1).join(' ') || '').trim();

      if (payload) {
        // Старт по ссылке с вашего сайта — не запрашиваем e-mail
        await this.findOrCreateProfile(ctx.from);
        awaitingEmail.delete(userId);
        emailVerified.add(userId);
        await this.sendAnimation(ctx, 'cute_a.mp4', this.welcomeMessage);
        return;
      }

      // Обычный старт — запрашиваем e-mail
      await this.findOrCreateProfile(ctx.from);
      emailVerified.delete(userId);
      awaitingEmail.add(userId);
      await ctx.reply(
        '👋 Добро пожаловать! Укажите, пожалуйста, e-mail, зарегистрированный на We Have Music. Без e-mail вы не сможете пользоваться ботом.',
      );
    });

    // Тестовое пополнение токенов
    this.bot.command('testAddTokens', async (ctx) => {
      const profile = await this.findOrCreateProfile(ctx.message.from);
      const add = 1000;
      profile.tokens.tokens += add;
      await this.tokensRepo.save(profile.tokens);
      await this.addTransaction(profile, add, 'CREDIT', 'test purchase');
      await ctx.reply('На ваш счёт зачислено 1000 токенов.');
    });

    // Тестовое списание всех токенов
    this.bot.command('testZeroTokens', async (ctx) => {
      const profile = await this.findOrCreateProfile(ctx.message.from);
      const currentTokens = profile.tokens.tokens;
      if (currentTokens > 0) {
        profile.tokens.tokens = 0;
        await this.tokensRepo.save(profile.tokens);
        await this.addTransaction(profile, currentTokens, 'DEBIT', 'test zero tokens');
        await ctx.reply(`Все токены списаны. Списано: ${currentTokens} токенов.`);
      } else {
        await ctx.reply('У вас уже 0 токенов.');
      }
    });

    // Тестовое удаление пользователя и всех связанных данных
    this.bot.command('testRemoveUser', async (ctx) => {
      const profile = await this.profileRepo.findOne({
        where: { telegramId: String(ctx.message.from.id) },
        relations: ['tokens'],
      });

      if (!profile) {
        await ctx.reply('Пользователь не найден в базе данных.');
        return;
      }

      try {
        // Удаляем профиль пользователя (каскадное удаление удалит связанные записи)
        await this.profileRepo.remove(profile);
        await ctx.reply('Пользователь и все связанные данные успешно удалены из базы данных.');
      } catch (error) {
        this.logger.error('Ошибка при удалении пользователя', error);
        await ctx.reply('Произошла ошибка при удалении пользователя.');
      }
    });

    this.bot.catch((err, ctx) => {
      this.logger.error('TG error', err);
      this.logger.debug('Update caused error', JSON.stringify(ctx.update, null, 2));
    });
  }
}
