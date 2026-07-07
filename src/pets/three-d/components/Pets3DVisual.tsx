/**
 * Pets3DVisual — Renders a Blossom-hosted GLB pet model with @react-three/fiber.
 *
 * This component is intentionally isolated in its own chunk and only loaded
 * when the user has enabled 3D rendering. Other Nostr clients (and 2140 when
 * 3D is off) continue to use the SVG renderer.
 *
 * Defaults:
 * - Loads the bundled demo GLB when no user asset is configured.
 * - Renders a procedural 3D environment (sky, ground, simple props).
 * - Lets the user rotate/zoom around the pet instead of auto-orbiting it.
 * - The pet can be moved with arrow keys or the on-screen D-pad.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  ContactShadows,
  Environment,
  OrbitControls,
  Sky,
  useGLTF,
} from '@react-three/drei';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { Group } from 'three';

import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';
import {
  DEFAULT_ROOM_GROUND_COLOR,
  DEFAULT_ROOM_SKY_AZIMUTH,
  DEFAULT_ROOM_SKY_INCLINATION,
} from '@/pets/three-d/lib/default-assets';
import { usePet3DControls } from '@/pets/three-d/hooks/usePet3DControls';

interface Pets3DVisualProps {
  /** Pet model asset (user-configured or bundled default). */
  asset: Asset3DEntry;
  /** Optional room/environment GLB override. */
  roomAsset?: Asset3DEntry;
  /** If true, pauses the walk animation and movement. */
  isSleeping?: boolean;
  className?: string;
}

/** Base scale for the loaded pet GLB. Kept small so the pet feels pet-sized inside the full-room world. */
const PET_SCALE = 0.011;
const PET_Y = -1.05; // raised slightly above the ground plane

/**
 * Low-poly procedural room environment: sky dome, ground plane, and a few
 * simple shapes so the pet is clearly in a 3D space rather than a void.
 */
function Pets3DRoom() {
  return (
    <>
      <Sky
        distance={450000}
        sunPosition={[5, 1, 8]}
        inclination={DEFAULT_ROOM_SKY_INCLINATION}
        azimuth={DEFAULT_ROOM_SKY_AZIMUTH}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.35, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color={DEFAULT_ROOM_GROUND_COLOR} roughness={0.9} />
      </mesh>
      {/* A few low-poly rocks / bushes for scale and depth. */}
      <mesh position={[-2.2, -1.05, -1.8]} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.35, 0]} />
        <meshStandardMaterial color="#7a8a72" roughness={0.8} />
      </mesh>
      <mesh position={[2.4, -1.0, -1.2]} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.45, 0]} />
        <meshStandardMaterial color="#8b9a7e" roughness={0.8} />
      </mesh>
      <mesh position={[-1.6, -1.15, 2.0]} castShadow receiveShadow>
        <coneGeometry args={[0.2, 0.6, 8]} />
        <meshStandardMaterial color="#4a6b3a" roughness={0.8} />
      </mesh>
      <mesh position={[1.8, -1.15, 1.6]} castShadow receiveShadow>
        <coneGeometry args={[0.25, 0.7, 8]} />
        <meshStandardMaterial color="#3f6130" roughness={0.8} />
      </mesh>
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
 * 3D pet canvas. Keeps the camera fixed and provides soft lighting + shadows.
 */
export function Pets3DVisual({ asset, roomAsset, isSleeping, className }: Pets3DVisualProps) {
  const key = useMemo(() => `${asset.url}:${roomAsset?.url ?? ''}`, [asset.url, roomAsset?.url]);
  const { position, facingAngle, MovementPad } = usePet3DControls();
  const wrapperRef = useRef<HTMLDivElement>(null);
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

  return (
    <div
      ref={wrapperRef}
      className="relative w-full h-full"
    >
      <Canvas
        key={key}
        className={className}
        camera={{ position: [0, 0.8, 4.5], fov: 60 }}
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#87CEEB']} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[6, 8, 4]} intensity={1.2} castShadow shadow-mapSize={1024} />
        <directionalLight position={[-3, 2, -3]} intensity={0.3} />

        <Suspense fallback={null}>
          {roomAsset ? (
            <Pets3DRoomModel url={roomAsset.url} scale={roomAsset.scale} />
          ) : (
            <Pets3DRoom />
          )}
          <PetModel
            url={asset.url}
            scale={asset.scale}
            position={petPosition}
            rotationY={isSleeping ? 0 : facingAngle}
          />
          <ContactShadows
            position={[0, -1.35, 0]}
            opacity={0.35}
            scale={12}
            blur={2.5}
            far={6}
          />
          <Environment preset="sunset" />
        </Suspense>

        <OrbitControls
          enablePan={false}
          enableZoom={false}
          enableRotate
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={Math.PI / 2.05}
          enableDamping
          dampingFactor={0.05}
        />
      </Canvas>

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
