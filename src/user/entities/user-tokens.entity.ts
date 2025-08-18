import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserProfile } from './user-profile.entity';

// Баланс токенов пользователя

@Entity()
export class UserTokens {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ default: 100 })
  tokens: number;

  // Тарифный план пользователя: PLUS или PRO
  @Column({ nullable: true })
  plan?: 'PLUS' | 'PRO';

  // Ожидаемый тип платежа: PLUS, PRO или TOPUP
  @Column({ nullable: true })
  pendingPayment?: 'PLUS' | 'PRO' | 'TOPUP';

  // Дата начала оплаченного периода
  @Column({ type: 'timestamptz', nullable: true })
  dateSubscription?: Date;

  // Дата окончания подписки (через 30 дней после оплаты)
  @Column({ type: 'timestamptz', nullable: true })
  subscriptionUntil?: Date;

  @Column()
  userId: number;

  @OneToOne(() => UserProfile, (profile) => profile.tokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserProfile;
}
