import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BlockchainController } from './blockchain.controller';
import { BlockchainService, BlockchainProcessor } from './blockchain.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'blockchain' })],
  controllers: [BlockchainController],
  providers: [BlockchainService, BlockchainProcessor],
  exports: [BlockchainService],
})
export class BlockchainModule {}
