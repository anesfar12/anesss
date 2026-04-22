// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — WebSocket Gateway Module
// Real-time events: inventory, VIP arrival, passport mint, device approved
// Consumes PostgreSQL NOTIFY via EventEmitter2 → Socket.IO rooms
// ═══════════════════════════════════════════════════════════════════════════

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  WebSocketGateway, WebSocketServer, OnGatewayConnection,
  OnGatewayDisconnect, SubscribeMessage, MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../auth/auth.service';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: ['http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'],
    credentials: true,
  },
  namespace: '/ws',
})
export class LuxeWebSocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LuxeWebSocketGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth['token'] as string
        || client.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwt.verify<JwtPayload>(token);
      // Tag socket with user metadata
      client.data['userId'] = payload.sub;
      client.data['orgId'] = payload.org;
      client.data['locationId'] = payload.loc;
      client.data['role'] = payload.role;

      // Join org-scoped room (all events scoped by org)
      await client.join(`org:${payload.org}`);
      // Join location room for inventory events
      if (payload.loc) {
        await client.join(`location:${payload.loc}`);
      }
      // Join personal room for VIP notifications
      await client.join(`user:${payload.sub}`);

      this.logger.log(`Client connected: ${client.id} user=${payload.sub} org=${payload.org}`);
    } catch {
      this.logger.warn(`WebSocket auth failed for ${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // ── Subscribe to location-specific room ──────────────────────────────
  @SubscribeMessage('join:location')
  async joinLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() locationId: string,
  ) {
    await client.join(`location:${locationId}`);
    return { joined: locationId };
  }

  // ── PostgreSQL NOTIFY → WebSocket emission ────────────────────────────

  // luxe_inventory_events → inventory.deducted / inventory.restored
  @OnEvent('db.inventory.events')
  onInventoryEvent(data: { event: string; variantId: string; locationId: string; orgId?: string; [key: string]: unknown }) {
    // Emit to all clients in the location room
    this.server.to(`location:${data['locationId']}`).emit('inventory:update', {
      event: data['event'],
      variantId: data['variantId'],
      qtyRemaining: data['qty_remaining'],
      txId: data['tx_id'],
      ts: data['ts'],
    });
  }

  // luxe_vip_arrival → preferred staff real-time notification
  @OnEvent('db.vip.arrival')
  onVipArrival(data: { customerId: string; preferredStaff: string; locationId: string; txId: string }) {
    this.server.to(`user:${data['preferred_staff']}`).emit('vip:arrival', {
      customerId: data['customerId'],
      locationId: data['locationId'],
      txId: data['txId'],
      timestamp: new Date().toISOString(),
    });
  }

  // luxe_passport_mint → blockchain status update
  @OnEvent('db.passport.mint')
  onPassportMint(data: { itemId: string; variantId: string; customerId: string }) {
    this.server.emit('passport:queued', {
      itemId: data['itemId'],
      customerId: data['customerId'],
      status: 'queued',
    });
  }

  // luxe_device_approved → notify location staff
  @OnEvent('db.device.approved')
  onDeviceApproved(data: { deviceId: string; locationId: string; deviceName: string }) {
    this.server.to(`location:${data['locationId']}`).emit('device:approved', {
      deviceId: data['deviceId'],
      deviceName: data['deviceName'],
    });
  }

  // luxe_feature_flags → AI adapter hot-reload signal
  @OnEvent('db.feature.flags')
  onFlagChanged(data: { flagKey: string; newValue: boolean; orgId: string }) {
    this.server.to(`org:${data['orgId']}`).emit('flag:changed', {
      flagKey: data['flagKey'],
      newValue: data['newValue'],
    });
  }

  // ── Emit helpers (called by NestJS services) ─────────────────────────

  emitToOrg(orgId: string, event: string, data: unknown) {
    this.server.to(`org:${orgId}`).emit(event, data);
  }

  emitToLocation(locationId: string, event: string, data: unknown) {
    this.server.to(`location:${locationId}`).emit(event, data);
  }

  emitToUser(userId: string, event: string, data: unknown) {
    this.server.to(`user:${userId}`).emit(event, data);
  }
}

// JwtModule is imported here so JwtService can be injected into LuxeWebSocketGateway.
// AuthModule already exports JwtModule globally, but WebSocketGatewayModule is loaded
// before the full module graph is resolved — explicit import ensures correct DI order.
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get<string>('jwt.accessExpiresIn', '15m') },
      }),
    }),
  ],
  providers: [LuxeWebSocketGateway],
  exports: [LuxeWebSocketGateway],
})
export class WebSocketGatewayModule {}
