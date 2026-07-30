/**
 * Pets3DVisual — Renders the pet inside a 3D world with @react-three/fiber.
 *
 * This component is intentionally isolated in its own chunk and only loaded
 * when the user has enabled 3D rendering. Other Nostr clients (and 2140 when
 * 3D is off) continue to use the plain 2D renderer.
 *
 * Pet rendering:
 * - With a configured GLB (`asset`), the model is loaded and rendered in 3D.
 * - Without one, the pet's own 2D visual (`sprite`) is rendered as a
 *   camera-facing billboard inside the world — the companion always stays
 *   itself, never a stand-in demo model.
 *
 * World:
 * - Procedural low-poly meadow (sky, grass, trees, pond, path, flowers,
 *   clouds) or an optional room GLB override.
 * - Orbit to look around, scroll to zoom.
 * - The pet walks in all directions (including depth) with WASD/arrow keys
 *   or the on-screen 8-way pad.
 */

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  ContactShadows,
  OrbitControls,
  Sky,
  useGLTF,
} from '@react-three/drei';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Vector3, type Group } from 'three';

import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';
import {
  DEFAULT_ROOM_GROUND_COLOR,
  DEFAULT_ROOM_SKY_AZIMUTH,
  DEFAULT_ROOM_SKY_INCLINATION,
} from '@/pets/three-d/lib/default-assets';
import { usePet3DControls } from '@/pets/three-d/hooks/usePet3DControls';

interface Pets3DVisualProps {
  /** Pet GLB asset. When omitted, `sprite` is rendered instead. */
  asset?: Asset3DEntry;
  /** The pet's own 2D visual, billboarded inside the world when no GLB exists. */
  sprite?: ReactNode;
  /** Optional room/environment GLB override. */
  roomAsset?: Asset3DEntry;
  /** If true, the GLB keeps its neutral facing instead of tracking movement. */
  isSleeping?: boolean;
  className?: string;
}

/** Base scale for a loaded pet GLB. Kept small so the pet feels pet-sized inside the full-room world. */
const PET_SCALE = 0.011;
const PET_Y = -1.05; // raised slightly above the ground plane
/** Height of the sprite billboard's center above the ground. */
const SPRITE_CENTER_Y = PET_Y + 0.62;

/**
 * Low-poly procedural meadow: sky dome, grass, a dirt path, pond, trees,
 * rocks, flowers, and drifting clouds so the pet is clearly in a world
 * rather than a void.
 */
function Pets3DRoom() {
  const flowers = useMemo(() => {
    // Deterministic scatter so the meadow doesn't reshuffle every render.
    const spots: { x: number; z: number; color: string }[] = [];
    const colors = ['#e8734a', '#f2c14e', '#e78fb3', '#f5f0e6'];
    for (let i = 0; i < 14; i++) {
      const angle = i * 2.39996; // golden angle spread
      const r = 2.5 + ((i * 37) % 100) / 100 * 6;
      spots.push({
        x: Math.cos(angle) * r,
        z: Math.sin(angle) * r,
        color: colors[i % colors.length],
      });
    }
    return spots;
  }, []);

  return (
    <>
      <Sky
        distance={450000}
        sunPosition={[5, 1, 8]}
        inclination={DEFAULT_ROOM_SKY_INCLINATION}
        azimuth={DEFAULT_ROOM_SKY_AZIMUTH}
      />
      {/* Grass */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.35, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color={DEFAULT_ROOM_GROUND_COLOR} roughness={0.9} />
      </mesh>
      {/* Dirt path */}
      <mesh rotation={[-Math.PI / 2, 0, 0.35]} position={[0.6, -1.345, 0]} receiveShadow>
        <planeGeometry args={[1.4, 26]} />
        <meshStandardMaterial color="#a08457" roughness={1} />
      </mesh>
      {/* Pond */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-4.2, -1.34, 3.2]} receiveShadow>
        <circleGeometry args={[1.6, 24]} />
        <meshStandardMaterial color="#5fa8c9" roughness={0.25} metalness={0.1} />
      </mesh>

      {/* Trees: trunk + two cones */}
      {([
        [-5.2, -3.4, 1.1],
        [4.8, -4.2, 1.3],
        [-6.4, 0.8, 0.9],
        [6.2, 1.8, 1.0],
        [2.8, -6.0, 1.2],
      ] as const).map(([x, z, s], i) => (
        <group key={i} position={[x, -1.35, z]} scale={s}>
          <mesh position={[0, 0.4, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.13, 0.8, 6]} />
            <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
          </mesh>
          <mesh position={[0, 1.15, 0]} castShadow>
            <coneGeometry args={[0.55, 1.1, 8]} />
            <meshStandardMaterial color="#3f6130" roughness={0.8} />
          </mesh>
          <mesh position={[0, 1.75, 0]} castShadow>
            <coneGeometry args={[0.4, 0.85, 8]} />
            <meshStandardMaterial color="#4a6b3a" roughness={0.8} />
          </mesh>
        </group>
      ))}

      {/* Rocks */}
      <mesh position={[-2.2, -1.05, -1.8]} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.35, 0]} />
        <meshStandardMaterial color="#7a8a72" roughness={0.8} />
      </mesh>
      <mesh position={[2.4, -1.0, -1.2]} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.45, 0]} />
        <meshStandardMaterial color="#8b9a7e" roughness={0.8} />
      </mesh>
      <mesh position={[-3.1, -1.15, 4.6]} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.28, 0]} />
        <meshStandardMaterial color="#7a8a72" roughness={0.8} />
      </mesh>

      {/* Flowers: thin stem + colored head */}
      {flowers.map((f, i) => (
        <group key={i} position={[f.x, -1.35, f.z]}>
          <mesh position={[0, 0.09, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 0.18, 4]} />
            <meshStandardMaterial color="#3f6130" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.2, 0]} castShadow>
            <icosahedronGeometry args={[0.055, 0]} />
            <meshStandardMaterial color={f.color} roughness={0.6} />
          </mesh>
        </group>
      ))}

      {/* Clouds */}
      {([
        [-6, 4.2, -8],
        [3, 5.0, -10],
        [7, 4.5, -4],
      ] as const).map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]}>
          <mesh>
            <sphereGeometry args={[0.55, 12, 12]} />
            <meshStandardMaterial color="#ffffff" roughness={1} />
          </mesh>
          <mesh position={[0.55, -0.08, 0.1]}>
            <sphereGeometry args={[0.4, 12, 12]} />
            <meshStandardMaterial color="#f4f8fa" roughness={1} />
          </mesh>
          <mesh position={[-0.5, -0.1, -0.05]}>
            <sphereGeometry args={[0.35, 12, 12]} />
            <meshStandardMaterial color="#f4f8fa" roughness={1} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/**
 * Optional room GLB. Loaded separately so it can fail without taking down
 * the pet.
 */
function Pets3DRoomModel({ url, scale }: { url: string; scale?: number }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} scale={scale ?? 1} position={[0, -1.35, 0]} />;
}

/**
 * The loaded GLB pet. `useGLTF` caches the loader result, so re-renders of
 * the parent don't re-fetch the asset. The model is positioned by the parent
 * and faces the direction of movement; animations are not auto-played so the
 * model does not walk or rotate on its own.
 */
function PetModel({
  url,
  scale,
  position,
  rotationY,
}: {
  url: string;
  scale?: number;
  position: [number, number, number];
  rotationY: number;
}) {
  const { scene } = useGLTF(url);
  const groupRef = useRef<Group>(null);

  return (
    <group ref={groupRef} position={position} rotation={[0, rotationY, 0]}>
      <primitive
        object={scene}
        // Scale the loaded model to pet size inside the full-room world.
        // A per-asset scale override can make a specific GLB larger or smaller.
        scale={scale ?? PET_SCALE}
        position={[0, 0, 0]}
        castShadow
        receiveShadow
      />
    </group>
  );
}

/**
 * Tracks the pet's 3D position and projects it to screen space every frame,
 * moving a plain DOM overlay (rendered OUTSIDE the Canvas, in the normal
 * React tree) to match. This is used instead of drei's <Html> because the
 * sprite content is the pet's real 2D visual, which needs app React context
 * (NostrProvider et al.) — context does not cross into the R3F renderer root.
 *
 * The overlay scales with camera distance, so the pet shrinks as it walks
 * deeper into the world.
 */
function SpriteTracker({
  positionRef,
  targetRef,
}: {
  positionRef: React.RefObject<[number, number, number]>;
  targetRef: React.RefObject<HTMLDivElement | null>;
}) {
  const vec = useMemo(() => new Vector3(), []);

  useFrame(({ camera, size }) => {
    const el = targetRef.current;
    if (!el || !positionRef.current) return;

    vec.set(...positionRef.current);
    const dist = camera.position.distanceTo(vec);
    vec.y = SPRITE_CENTER_Y;
    vec.project(camera);

    // Behind the camera — hide.
    if (vec.z > 1) {
      el.style.visibility = 'hidden';
      return;
    }

    const px = (vec.x * 0.5 + 0.5) * size.width;
    const py = (-vec.y * 0.5 + 0.5) * size.height;
    const scale = Math.min(1.5, Math.max(0.5, 4.2 / dist));
    el.style.visibility = 'visible';
    el.style.transform = `translate(${px - el.offsetWidth / 2}px, ${py - el.offsetHeight * 0.9}px) scale(${scale})`;
  });

  return null;
}

/**
 * 3D pet canvas. Keeps the camera fixed and provides soft lighting + shadows.
 */
export function Pets3DVisual({ asset, sprite, roomAsset, isSleeping, className }: Pets3DVisualProps) {
  const { position, facingAngle, MovementPad } = usePet3DControls();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const spriteOverlayRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<[number, number, number]>([0, PET_Y, 0]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = async () => {
    const el = wrapperRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      // Ignore browsers that block fullscreen or unsupported contexts.
    }
  };

  const petPosition: [number, number, number] = useMemo(
    () => [position.x, PET_Y, position.z],
    [position],
  );

  // Keep the mutable position ref current for the sprite tracker (useFrame
  // reads it every frame without re-subscribing).
  useEffect(() => {
    positionRef.current = petPosition;
  }, [petPosition]);

  return (
    <div
      ref={wrapperRef}
      className="relative w-full h-full"
    >
      <Canvas
        className={className}
        camera={{ position: [0, 0.8, 4.5], fov: 60 }}
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#87CEEB']} />
        <fog attach="fog" args={['#b8dff0', 14, 32]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[6, 8, 4]} intensity={1.2} castShadow shadow-mapSize={1024} />
        <directionalLight position={[-3, 2, -3]} intensity={0.3} />

        <Suspense fallback={null}>
          {roomAsset ? (
            <Pets3DRoomModel url={roomAsset.url} scale={roomAsset.scale} />
          ) : (
            <Pets3DRoom />
          )}
          {asset ? (
            <PetModel
              url={asset.url}
              scale={asset.scale}
              position={petPosition}
              rotationY={isSleeping ? 0 : facingAngle}
            />
          ) : sprite ? (
            <SpriteTracker positionRef={positionRef} targetRef={spriteOverlayRef} />
          ) : null}
          <ContactShadows
            position={[0, -1.35, 0]}
            opacity={0.35}
            scale={12}
            blur={2.5}
            far={6}
          />
        </Suspense>

        <OrbitControls
          enablePan={false}
          enableZoom
          minDistance={2.5}
          maxDistance={9}
          enableRotate
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={Math.PI / 2.05}
          enableDamping
          dampingFactor={0.05}
        />
      </Canvas>

      {/* Sprite-mode pet overlay: the pet's own 2D visual, positioned over the
          canvas by SpriteTracker (screen projection + depth scaling). Rendered
          outside the Canvas so it keeps the app's React context. */}
      {!asset && sprite && (
        <div
          ref={spriteOverlayRef}
          className="absolute left-0 top-0 size-40 pointer-events-none select-none z-[5]"
          style={{ transformOrigin: 'center bottom', visibility: 'hidden' }}
        >
          {sprite}
        </div>
      )}

      <button
        type="button"
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        onClick={toggleFullscreen}
        className="absolute top-4 right-4 z-20 size-9 flex items-center justify-center rounded-full bg-background/80 backdrop-blur-sm border shadow-sm hover:bg-background transition-colors"
      >
        {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>

      <MovementPad className="absolute bottom-4 right-4 z-10" />
    </div>
  );
}
