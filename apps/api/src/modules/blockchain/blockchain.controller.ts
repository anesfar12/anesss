import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BlockchainService } from './blockchain.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgId } from '../../common/decorators/current-user.decorator';

@ApiTags('Blockchain')
@Controller({ path: 'blockchain', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BlockchainController {
  constructor(private readonly blockchain: BlockchainService) {}

  @Get('passports/:itemId')
  @ApiOperation({ summary: 'Get Digital Passport for transaction item' })
  getPassport(@Param('itemId') itemId: string, @OrgId() orgId: string) {
    return this.blockchain.getPassport(itemId, orgId);
  }

  @Post('passports/:tokenId/verify')
  @ApiOperation({ summary: 'Verify Digital Passport authenticity on Polygon' })
  verifyPassport(@Param('tokenId') tokenId: string, @OrgId() orgId: string) {
    return this.blockchain.verifyPassport(tokenId, orgId);
  }
}
