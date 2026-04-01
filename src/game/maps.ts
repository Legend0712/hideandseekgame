import { GRID_SIZE } from './types';

export interface GameMap {
  name: string;
  grid: number[][];
  description: string;
}

const createEmptyGrid = () => Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));

const generateStaticGrid = (seed: number) => {
  const grid = createEmptyGrid();
  let currentSeed = seed;
  const getNext = () => {
    let x = Math.sin(currentSeed++) * 10000;
    return x - Math.floor(x);
  };
  
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      // Avoid start area
      if (x < 4 && y < 4) continue;
      
      // Use deterministic random - increased density from 0.2 to 0.3
      if (getNext() < 0.3) {
        grid[y][x] = 1;
      }
    }
  }
  
  // Ensure some corridors for movement
  for (let i = 0; i < GRID_SIZE; i++) {
    if (i % 6 === 0) { // Slightly more frequent corridors
      for (let j = 0; j < GRID_SIZE; j++) {
        grid[i][j] = 0;
        grid[j][i] = 0;
      }
    }
  }
  
  return grid;
};

export const MAPS: GameMap[] = [
  { name: 'SECTOR_ALPHA', description: 'HIGH_DENSITY_CORE // STABLE', grid: generateStaticGrid(101) },
  { name: 'SECTOR_BETA', description: 'PERIPHERAL_HUB // UNSTABLE', grid: generateStaticGrid(202) },
  { name: 'SECTOR_GAMMA', description: 'DATA_VAULT // SECURE', grid: generateStaticGrid(303) },
  { name: 'SECTOR_DELTA', description: 'VOID_RUNNER // CRITICAL', grid: generateStaticGrid(404) },
  { name: 'SECTOR_EPSILON', description: 'NEON_GRID // ACTIVE', grid: generateStaticGrid(505) },
  { name: 'SECTOR_ZETA', description: 'SHADOW_REALM // UNKNOWN', grid: generateStaticGrid(606) },
];
