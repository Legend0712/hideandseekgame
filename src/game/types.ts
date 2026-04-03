/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const GRID_SIZE = 45;
export const TILE_SIZE = 24; // pixels
export const VIEWPORT_SIZE = GRID_SIZE * TILE_SIZE;

export const PLAYER_SPEED = 4;
export const SEEKER_SPEED_PATROL = 1.5;
export const SEEKER_SPEED_CHASE = 2.25;
export const DETECTION_RADIUS = 8; // tiles
export const DETECTION_RATE = 0.01125; // per frame (75% of 0.015)
export const COOLDOWN_RATE = 0.01; // per frame

export type GameStatus = 'HIDING' | 'SPOTTED' | 'CAUGHT';

export type PowerupType = 'SLOWMO' | 'CLONE' | 'TELEPORT' | 'INVINCIBILITY';

export interface Powerup {
  id: string;
  pos: Point;
  type: PowerupType;
}

export interface LeaderboardEntry {
  name: string;
  dots: number;
  time: number;
  date: string;
  mapIndex?: number;
  uid: string;
  email?: string; // Optional for public view, but stored for admin
}

export interface Collectible {
  id: string;
  pos: Point;
}

export interface Trap {
  id: string;
  pos: Point;
}

export interface MinimapMarker {
  id: string;
  pos: Point;
  type: 'SPAWN' | 'DEATH';
  startTime: number;
  duration: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Seeker {
  id: string;
  pos: Point;
  target: Point | null;
  path: Point[];
  state: 'PATROL' | 'CHASE';
  lastKnownPlayerPos: Point | null;
  patrolWaypoint: Point;
  canSeePlayer?: boolean;
  loSTimer?: number; // Time in ms that LoS has been maintained
}

export interface GameState {
  playerPos: Point;
  seekers: Seeker[];
  status: GameStatus;
  detectionMeter: number; // 0 to 1
  survivalTime: number;
  bestRecord: number;
}
