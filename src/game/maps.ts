import { GRID_SIZE } from './types';

export interface GameMap {
  name: string;
  grid: number[][];
  description: string;
}

const createEmptyGrid = () => Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));

const generateAlphaGrid = () => {
  const grid = createEmptyGrid();
  // Pillars and some walls
  for (let y = 4; y < GRID_SIZE - 4; y += 6) {
    for (let x = 4; x < GRID_SIZE - 4; x += 6) {
      // 2x2 pillars
      grid[y][x] = 1;
      grid[y+1][x] = 1;
      grid[y][x+1] = 1;
      grid[y+1][x+1] = 1;
    }
  }
  // Perimeter walls with gaps
  for (let i = 0; i < GRID_SIZE; i++) {
    if (i % 8 !== 0) {
      grid[0][i] = 1;
      grid[GRID_SIZE-1][i] = 1;
      grid[i][0] = 1;
      grid[i][GRID_SIZE-1] = 1;
    }
  }
  return grid;
};

const generateBetaGrid = () => {
  const grid = createEmptyGrid();
  // Cross pattern
  for (let i = 0; i < GRID_SIZE; i++) {
    if (Math.abs(i - GRID_SIZE/2) > 2) {
      grid[Math.floor(GRID_SIZE/2)][i] = 1;
      grid[i][Math.floor(GRID_SIZE/2)] = 1;
    }
  }
  // Inner boxes
  const centers = [7, 22];
  centers.forEach(cy => {
    centers.forEach(cx => {
      for (let y = cy - 2; y <= cy + 2; y++) {
        for (let x = cx - 2; x <= cx + 2; x++) {
          if (Math.abs(y - cy) === 2 || Math.abs(x - cx) === 2) {
            grid[y][x] = 1;
          }
        }
      }
    });
  });
  return grid;
};

const generateGammaGrid = () => {
  const grid = createEmptyGrid();
  // Labyrinth style - deterministic
  for (let y = 2; y < GRID_SIZE - 2; y += 2) {
    for (let x = 2; x < GRID_SIZE - 2; x += 2) {
      grid[y][x] = 1;
      // Connect to a neighbor deterministically
      const dir = (x + y) % 4;
      if (dir === 0 && x < GRID_SIZE - 3) grid[y][x+1] = 1;
      else if (dir === 1 && y < GRID_SIZE - 3) grid[y+1][x] = 1;
      else if (dir === 2 && x > 2) grid[y][x-1] = 1;
      else if (dir === 3 && y > 2) grid[y-1][x] = 1;
    }
  }
  // Clear start area
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      grid[y][x] = 0;
    }
  }
  return grid;
};

export const MAPS: GameMap[] = [
  {
    name: "ARENA_ALPHA",
    grid: generateAlphaGrid(),
    description: "STRUCTURED_PILLAR_COMPLEX // SECTOR_01"
  },
  {
    name: "ARENA_BETA",
    grid: generateBetaGrid(),
    description: "CENTRAL_CROSS_FACILITY // SECTOR_02"
  },
  {
    name: "ARENA_GAMMA",
    grid: generateGammaGrid(),
    description: "DETERMINISTIC_LABYRINTH // SECTOR_03"
  }
];
