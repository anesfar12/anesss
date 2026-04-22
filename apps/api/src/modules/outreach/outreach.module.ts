import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { OutreachController } from './outreach.controller';
import { OutreachService, OutreachProcessor } from './outreach.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'outreach' })],
  controllers: [OutreachController],
  providers: [OutreachService, OutreachProcessor],
  exports: [OutreachService],
})
export class OutreachModule {}
