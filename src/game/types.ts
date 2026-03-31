/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const GRID_SIZE = 30;
export const TILE_SIZE = 32; // pixels
export const VIEWPORT_SIZE = GRID_SIZE * TILE_SIZE;

export const PLAYER_SPEED = 4;
export const SEEKER_SPEED_PATROL = 1.5;
export const SEEKER_SPEED_CHASE = 2.25;
export const DETECTION_RADIUS = 8; // tiles
export const DETECTION_RATE = 0.015; // per frame
export const COOLDOWN_RATE = 0.01; // per frame

export type GameStatus = 'HIDING' | 'SPOTTED' | 'CAUGHT';

export type PowerupType = 'SLOWMO' | 'CLONE' | 'TELEPORT';

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
}

export interface GameState {
  playerPos: Point;
  seekers: Seeker[];
  status: GameStatus;
  detectionMeter: number; // 0 to 1
  survivalTime: number;
  bestRecord: number;
}
