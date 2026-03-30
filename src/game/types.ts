/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const GRID_SIZE = 30;
export const TILE_SIZE = 32; // pixels
export const VIEWPORT_SIZE = GRID_SIZE * TILE_SIZE;

export const PLAYER_SPEED = 4;
export const SEEKER_SPEED_PATROL = 1.5;
export const SEEKER_SPEED_CHASE = 3;
export const DETECTION_RADIUS = 8; // tiles
export const DETECTION_RATE = 0.02; // per frame
export const COOLDOWN_RATE = 0.01; // per frame

export type GameStatus = 'HIDING' | 'SPOTTED' | 'CAUGHT';

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
}

export interface GameState {
  playerPos: Point;
  seekers: Seeker[];
  status: GameStatus;
  detectionMeter: number; // 0 to 1
  survivalTime: number;
  bestRecord: number;
}
