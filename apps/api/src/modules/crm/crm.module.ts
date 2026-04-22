import { Module } from '@nestjs/common';
import { CRMController } from './crm.controller';
import { CRMService } from './crm.service';

@Module({
  controllers: [CRMController],
  providers: [CRMService],
  exports: [CRMService],
})
export class CRMModule {}
