import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],    // Provides AuthService for device approval endpoint
  controllers: [SystemController],
  providers: [SystemService],
  exports: [SystemService],
})
export class SystemModule {}
