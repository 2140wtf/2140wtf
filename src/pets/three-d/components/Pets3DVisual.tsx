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
 * - Animates the pet walking in a small circle so it is not just sitting.
 */

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  ContactShadows,
  Environment,
  OrbitControls,
  Sky,
  useAnimations,
  useGLTF,
} from '@react-three/drei';
import type { Group } from 'three';

import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';
import {
  DEFAULT_ROOM_GROUND_COLOR,
  DEFAULT_ROOM_SKY_AZIMUTH,
  DEFAULT_ROOM_SKY_INCLINATION,
} from '@/pets/three-d/lib/default-assets';

interface Pets3DVisualProps {
  /** Pet model asset (user-configured or bundled default). */
  asset: Asset3DEntry;
  /** Optional room/environment GLB override. */
  roomAsset?: Asset3DEntry;
  /** If true, pauses the walk animation and movement. */
  isSleeping?: boolean;
  className?: string;
}

const WALK_RADIUS = 1.0;
const WALK_SPEED = 0.35;
/** Base scale for the loaded pet GLB. Tuned so the pet feels pet-sized inside the full-room world. */
const PET_SCALE = 0.015;

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
function Pets3DRoomModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} scale={1.5} position={[0, -1.35, 0]} />;
}

/**
 * The loaded GLB pet. `useGLTF` caches the loader result, so re-renders of
 * the parent don't re-fetch the asset. Plays the first available animation
 * (usually a walk cycle) and moves the pet around the room.
 */
function PetModel({
  url,
  isSleeping,
}: {
  url: string;
  isSleeping?: boolean;
}) {
  const { scene, animations } = useGLTF(url);
  const groupRef = useRef<Group>(null);
  const { actions } = useAnimations(animations, groupRef);
  const angleRef = useRef(Math.random() * Math.PI * 2);

  useEffect(() => {
    if (!actions) return;
    const name = animations[0]?.name;
    const action = name ? actions[name] : Object.values(actions)[0];
    if (!action) return;
    action.reset().fadeIn(0.5).play();
    return () => {
      action.fadeOut(0.5);
    };
  }, [actions, animations]);

  useFrame((state, delta) => {
    if (!groupRef.current || isSleeping) return;

    // Pause animation time while sleeping is handled by isSleeping bypass;
    // here we advance the walk cycle and orbit the pet around the room.
    angleRef.current += delta * WALK_SPEED;
    const t = angleRef.current;
    const x = Math.cos(t) * WALK_RADIUS;
    const z = Math.sin(t) * WALK_RADIUS;

    groupRef.current.position.set(x, -1.25, z);
    // Face the direction of travel (tangent to the circle).
    groupRef.current.rotation.y = -t + Math.PI / 2;
  });

  return (
    <group ref={groupRef}>
      <primitive
        object={scene}
        // Scale the loaded model to pet size inside the full-room world.
        scale={PET_SCALE}
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

  return (
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
        <Pets3DRoom />
        {roomAsset && <Pets3DRoomModel url={roomAsset.url} />}
        <PetModel url={asset.url} isSleeping={isSleeping} />
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
        enableRotate={!isSleeping}
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={Math.PI / 2.05}
        minAzimuthAngle={-Math.PI / 2}
        maxAzimuthAngle={Math.PI / 2}
      />
    </Canvas>
  );
}
