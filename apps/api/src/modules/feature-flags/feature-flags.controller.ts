import { Controller, Get, Put, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { FeatureFlagsService } from './feature-flags.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/current-user.decorator';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';

class SetFlagDto {
  @IsBoolean()
  value!: boolean;
}

@ApiTags('System')
@Controller({ path: 'feature-flags', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  @ApiOperation({ summary: 'List all feature flags for organization' })
  async list(@OrgId() orgId: string) {
    return this.flags.listFlags(orgId);
  }

  @Put(':key')
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  @ApiOperation({ summary: 'Toggle feature flag (super_admin only)' })
  async setFlag(
    @Param('key') key: string,
    @Body() dto: SetFlagDto,
    @OrgId() orgId: string,
  ) {
    await this.flags.setFlag(orgId, key, dto.value);
    return { flagKey: key, value: dto.value };
  }
}
