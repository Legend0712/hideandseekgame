import { GRID_SIZE } from './types';

export interface GameMap {
  name: string;
  grid: number[][];
  description: string;
}

const createEmptyGrid = () => Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));

const generateRandomGrid = () => {
  const grid = createEmptyGrid();
  // Fill with random blocks
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      // Avoid start area
      if (x < 5 && y < 5) continue;
      
      // Individual tiles for more spacious feel
      if (Math.random() < 0.22) {
        grid[y][x] = 1;
      }
    }
  }
  
  // Ensure some paths are open
  for (let i = 0; i < GRID_SIZE; i++) {
    grid[i][2] = 0;
    grid[2][i] = 0;
  }
  
  return grid;
};

export const MAPS: GameMap[] = Array.from({ length: 6 }, (_, i) => ({
  name: `ARENA_${(i + 1).toString().padStart(2, '0')}`,
  grid: generateRandomGrid(),
  description: `CLASSIFIED_SECTOR_${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`
}));
