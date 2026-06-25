import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type ChaseCoin,
  type ChaseGameState,
  type ChaseGameStatus,
  type ChaseMode,
  type ChaseObstacle,
  type ChaseRail,
  type ChaseRunResult,
  CHASE_BASE_SPEED,
  CHASE_GRAVITY,
  CHASE_JUMP_VELOCITY,
  CHASE_MAX_SPEED,
  CHASE_RUN_TIMEOUT_MS,
  CHASE_SATS_PER_COIN,
  CHASE_SPEED_INCREMENT,
  CHASE_RAILS,
} from './types';

interface UseChaseGameOptions {
  mode: ChaseMode;
  containerWidth: number;
  containerHeight: number;
  groundY: number;
  petX: number;
  petWidth: number;
  petHeight: number;
}

function getLaneY(groundY: number, laneIndex: number): number {
  const lanes = [0, 60, 120, 180];
  return groundY - 40 - (lanes[laneIndex] ?? 0);
}

function createCoin(id: number, x: number, groundY: number): ChaseCoin {
  const railIndex = Math.floor(Math.random() * CHASE_RAILS.length);
  const rail = CHASE_RAILS[railIndex]!;
  const laneIndex = Math.floor(Math.random() * 4);
  return {
    id,
    x,
    y: getLaneY(groundY, laneIndex),
    rail: rail.id,
    collected: false,
    radius: 14,
  };
}

function createObstacle(id: number, x: number, groundY: number): ChaseObstacle {
  const roll = Math.random();
  if (roll < 0.15) {
    // Gap: rendered as missing ground, represented as a tall virtual trigger
    return { id, x, y: groundY + 20, width: 60, height: 40, type: 'gap' };
  }
  if (roll < 0.4) {
    // Low obstacle: must duck
    return { id, x, y: groundY - 35, width: 40, height: 35, type: 'low' };
  }
  // Block: must jump
  return { id, x, y: groundY - 50, width: 40, height: 50, type: 'block' };
}

export function useChaseGame({
  mode,
  containerWidth,
  containerHeight,
  groundY,
  petX,
  petWidth,
  petHeight,
}: UseChaseGameOptions) {
  const [status, setStatus] = useState<ChaseGameStatus>('idle');
  const [displayState, setDisplayState] = useState<ChaseGameState>(() => ({
    status: 'idle',
    result: {
      score: 0,
      distance: 0,
      coinsCollected: 0,
      coinsByRail: Object.fromEntries(CHASE_RAILS.map((rail) => [rail.id, 0])) as Record<ChaseRail, number>,
      satsWon: 0,
    },
    speed: CHASE_BASE_SPEED,
    distance: 0,
    isJumping: false,
    isDucking: false,
    petY: groundY - petHeight,
    coins: [],
    obstacles: [],
  }));

  const stateRef = useRef({
    status: 'idle' as ChaseGameStatus,
    mode,
    startTime: 0,
    lastFrameTime: 0,
    speed: CHASE_BASE_SPEED,
    distance: 0,
    score: 0,
    coinsCollected: 0,
    coinsByRail: Object.fromEntries(CHASE_RAILS.map((rail) => [rail.id, 0])) as Record<ChaseRail, number>,
    petY: groundY - petHeight,
    petVy: 0,
    isJumping: false,
    isDucking: false,
    duckEndTime: 0,
    coins: [] as ChaseCoin[],
    obstacles: [] as ChaseObstacle[],
    nextCoinId: 1,
    nextObstacleId: 1,
    nextCoinSpawnX: containerWidth + 40,
    nextObstacleSpawnX: containerWidth + 200,
    rafId: 0,
    petX,
    petWidth,
    petHeight,
    groundY,
    containerWidth,
    containerHeight,
  });

  useEffect(() => {
    stateRef.current.mode = mode;
  }, [mode]);

  useEffect(() => {
    stateRef.current.petX = petX;
    stateRef.current.petWidth = petWidth;
    stateRef.current.petHeight = petHeight;
    stateRef.current.groundY = groundY;
    stateRef.current.containerWidth = containerWidth;
    stateRef.current.containerHeight = containerHeight;
    if (stateRef.current.status === 'idle') {
      stateRef.current.petY = groundY - petHeight;
      setDisplayState((prev) => ({ ...prev, petY: groundY - petHeight }));
    }
  }, [petX, petWidth, petHeight, groundY, containerWidth, containerHeight]);

  const endRun = useCallback(() => {
    const state = stateRef.current;
    if (state.status !== 'running') return;
    state.status = 'ended';
    setStatus('ended');
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    const satsWon = state.mode === 'sats' ? state.coinsCollected * CHASE_SATS_PER_COIN : 0;
    const result: ChaseRunResult = {
      score: Math.floor(state.score + state.distance / 10),
      distance: Math.floor(state.distance),
      coinsCollected: state.coinsCollected,
      coinsByRail: { ...state.coinsByRail },
      satsWon,
    };
    setDisplayState((prev) => ({
      ...prev,
      status: 'ended',
      result,
      speed: state.speed,
      distance: state.distance,
    }));
  }, []);

  const jump = useCallback(() => {
    const state = stateRef.current;
    if (state.status !== 'running') return;
    if (!state.isJumping) {
      state.petVy = CHASE_JUMP_VELOCITY;
      state.isJumping = true;
      state.isDucking = false;
    }
  }, []);

  const duck = useCallback((active: boolean) => {
    const state = stateRef.current;
    if (state.status !== 'running') return;
    if (active) {
      if (!state.isJumping) {
        state.isDucking = true;
        state.duckEndTime = 0;
      }
    } else {
      state.isDucking = false;
    }
  }, []);

  const startRun = useCallback(() => {
    const state = stateRef.current;
    if (state.status === 'running') return;
    state.status = 'running';
    state.startTime = performance.now();
    state.lastFrameTime = performance.now();
    state.speed = CHASE_BASE_SPEED;
    state.distance = 0;
    state.score = 0;
    state.coinsCollected = 0;
    state.coinsByRail = Object.fromEntries(CHASE_RAILS.map((rail) => [rail.id, 0])) as Record<ChaseRail, number>;
    state.petY = state.groundY - state.petHeight;
    state.petVy = 0;
    state.isJumping = false;
    state.isDucking = false;
    state.coins = [];
    state.obstacles = [];
    state.nextCoinId = 1;
    state.nextObstacleId = 1;
    state.nextCoinSpawnX = state.containerWidth + 40;
    state.nextObstacleSpawnX = state.containerWidth + 200;
    setStatus('running');
    setDisplayState({
      status: 'running',
      result: {
        score: 0,
        distance: 0,
        coinsCollected: 0,
        coinsByRail: Object.fromEntries(CHASE_RAILS.map((rail) => [rail.id, 0])) as Record<ChaseRail, number>,
        satsWon: 0,
      },
      speed: CHASE_BASE_SPEED,
      distance: 0,
      isJumping: false,
      isDucking: false,
      petY: state.groundY - state.petHeight,
      coins: [],
      obstacles: [],
    });

    const loop = (now: number) => {
      if (state.status !== 'running') return;
      const dt = Math.min((now - state.lastFrameTime) / 16.67, 3);
      state.lastFrameTime = now;

      // Timeout check
      if (now - state.startTime >= CHASE_RUN_TIMEOUT_MS) {
        endRun();
        return;
      }

      // Physics
      if (state.isJumping) {
        state.petVy += CHASE_GRAVITY * dt;
        state.petY += state.petVy * dt;
        if (state.petY >= state.groundY - state.petHeight) {
          state.petY = state.groundY - state.petHeight;
          state.petVy = 0;
          state.isJumping = false;
        }
      }

      // Speed ramp
      state.speed = Math.min(CHASE_MAX_SPEED, state.speed + CHASE_SPEED_INCREMENT * dt);
      const dx = state.speed * dt;
      state.distance += dx;
      state.score += dx * 0.1;

      // Spawn coins
      state.nextCoinSpawnX -= dx;
      if (state.nextCoinSpawnX <= state.containerWidth) {
        const coin = createCoin(state.nextCoinId++, state.containerWidth + 40, state.groundY);
        state.coins.push(coin);
        state.nextCoinSpawnX = state.containerWidth + 40 + Math.random() * 250 + 120;
      }

      // Spawn obstacles
      state.nextObstacleSpawnX -= dx;
      if (state.nextObstacleSpawnX <= state.containerWidth) {
        const obstacle = createObstacle(state.nextObstacleId++, state.containerWidth + 40, state.groundY);
        state.obstacles.push(obstacle);
        state.nextObstacleSpawnX = state.containerWidth + 200 + Math.random() * 400 + 200;
      }

      // Move coins
      for (const coin of state.coins) {
        coin.x -= dx;
      }
      state.coins = state.coins.filter((coin) => coin.x + coin.radius > -20);

      // Move obstacles
      for (const obstacle of state.obstacles) {
        obstacle.x -= dx;
      }
      state.obstacles = state.obstacles.filter((obstacle) => obstacle.x + obstacle.width > -50);

      // Collision detection: coins
      const petCenterX = state.petX + state.petWidth / 2;
      const petCenterY = state.petY + state.petHeight / 2;
      for (const coin of state.coins) {
        if (coin.collected) continue;
        const dx_ = petCenterX - coin.x;
        const dy = petCenterY - coin.y;
        const dist = Math.sqrt(dx_ * dx_ + dy * dy);
        if (dist < coin.radius + Math.min(state.petWidth, state.petHeight) / 2) {
          coin.collected = true;
          state.coinsCollected += 1;
          state.coinsByRail[coin.rail] = (state.coinsByRail[coin.rail] ?? 0) + 1;
          state.score += 50;
        }
      }

      // Collision detection: obstacles
      const petHitboxX = state.petX + state.petWidth * 0.15;
      const petHitboxWidth = state.petWidth * 0.7;
      const petHitboxHeight = state.isDucking ? state.petHeight * 0.55 : state.petHeight;
      const petHitboxY = state.petY + (state.isDucking ? state.petHeight * 0.45 : 0);

      for (const obstacle of state.obstacles) {
        if (obstacle.type === 'gap') {
          // Gap collision: pet must be jumping when over the gap
          const gapLeft = obstacle.x;
          const gapRight = obstacle.x + obstacle.width;
          const petLeft = petHitboxX;
          const petRight = petHitboxX + petHitboxWidth;
          if (petRight > gapLeft && petLeft < gapRight && !state.isJumping) {
            endRun();
            return;
          }
          continue;
        }
        const overlapX = petHitboxX < obstacle.x + obstacle.width && petHitboxX + petHitboxWidth > obstacle.x;
        const overlapY = petHitboxY < obstacle.y + obstacle.height && petHitboxY + petHitboxHeight > obstacle.y;
        if (overlapX && overlapY) {
          if (obstacle.type === 'low' && state.isDucking) {
            // Ducking clears low obstacles
            continue;
          }
          endRun();
          return;
        }
      }

      setDisplayState({
        status: 'running',
        result: {
          score: Math.floor(state.score + state.distance / 10),
          distance: Math.floor(state.distance),
          coinsCollected: state.coinsCollected,
          coinsByRail: { ...state.coinsByRail },
          satsWon: state.mode === 'sats' ? state.coinsCollected * CHASE_SATS_PER_COIN : 0,
        },
        speed: state.speed,
        distance: state.distance,
        isJumping: state.isJumping,
        isDucking: state.isDucking,
        petY: state.petY,
        coins: state.coins.map((coin) => ({ ...coin })),
        obstacles: state.obstacles.map((obstacle) => ({ ...obstacle })),
      });

      state.rafId = requestAnimationFrame(loop);
    };

    state.rafId = requestAnimationFrame(loop);
  }, [endRun]);

  const resetRun = useCallback(() => {
    const state = stateRef.current;
    state.status = 'idle';
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    state.speed = CHASE_BASE_SPEED;
    state.distance = 0;
    state.score = 0;
    state.coinsCollected = 0;
    state.coinsByRail = Object.fromEntries(CHASE_RAILS.map((rail) => [rail.id, 0])) as Record<ChaseRail, number>;
    state.petY = state.groundY - state.petHeight;
    state.petVy = 0;
    state.isJumping = false;
    state.isDucking = false;
    state.coins = [];
    state.obstacles = [];
    setStatus('idle');
    setDisplayState({
      status: 'idle',
      result: {
        score: 0,
        distance: 0,
        coinsCollected: 0,
        coinsByRail: Object.fromEntries(CHASE_RAILS.map((rail) => [rail.id, 0])) as Record<ChaseRail, number>,
        satsWon: 0,
      },
      speed: CHASE_BASE_SPEED,
      distance: 0,
      isJumping: false,
      isDucking: false,
      petY: state.groundY - state.petHeight,
      coins: [],
      obstacles: [],
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') {
        event.preventDefault();
        jump();
      } else if (event.code === 'ArrowDown' || event.code === 'KeyS') {
        event.preventDefault();
        duck(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'ArrowDown' || event.code === 'KeyS') {
        duck(false);
      }
    };

    const state = stateRef.current;
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (state.rafId) {
        cancelAnimationFrame(state.rafId);
      }
    };
  }, [jump, duck]);

  return {
    status,
    state: displayState,
    startRun,
    resetRun,
    jump,
    duck,
    endRun,
  };
}
