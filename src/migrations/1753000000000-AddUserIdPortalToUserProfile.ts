import { MigrationInterface, QueryRunner } from 'typeorm';

// Добавляет поле userIdPortal в user_profile
export class AddUserIdPortalToUserProfile1753000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_profile" ADD "userIdPortal" varchar`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "userIdPortal"`);
  }
}
