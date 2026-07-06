/**
 * Pets3DVisual — Renders a Blossom-hosted GLB pet model with @react-three/fiber.
 *
 * This component is intentionally isolated in its own chunk and only loaded
 * when the user has enabled 3D rendering and a valid asset is resolved. Other
 * Nostr clients (and 2140 when 3D is off) continue to use the SVG renderer.
 */

import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, OrbitControls, useGLTF } from '@react-three/drei';
import type { Group } from 'three';

import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';


interface Pets3DVisualProps {
  asset: Asset3DEntry;
  /** If true, pauses the idle animation. */
  isSleeping?: boolean;
  className?: string;
}

/**
 * The loaded GLB model. `useGLTF` caches the loader result, so re-renders of
 * the parent don't re-fetch the asset.
 */
function Model({ url, isSleeping }: { url: string; isSleeping?: boolean }) {
  const { scene } = useGLTF(url);
  const groupRef = useRef<Group>(null);

  // Gentle idle sway / breathing when active.
  useFrame((state) => {
    if (!groupRef.current || isSleeping) return;
    const t = state.clock.elapsedTime;
    groupRef.current.rotation.y = Math.sin(t * 0.6) * 0.12;
    groupRef.current.position.y = Math.sin(t * 1.2) * 0.04;
  });

  return (
    <primitive
      ref={groupRef}
      object={scene}
      scale={1.5}
      position={[0, -0.8, 0]}
      castShadow
      receiveShadow
    />
  );
}

/**
 * 3D pet canvas. Keeps the camera fixed and provides soft lighting + shadows.
 */
export function Pets3DVisual({ asset, isSleeping, className }: Pets3DVisualProps) {
  return (
    <Canvas
      className={className}
      camera={{ position: [0, 0.6, 3.2], fov: 35 }}
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 6, 4]} intensity={1.2} castShadow />
      <directionalLight position={[-3, 2, -3]} intensity={0.4} />

      <Suspense fallback={null}>
        <Model url={asset.url} isSleeping={isSleeping} />
        <ContactShadows
          position={[0, -1.35, 0]}
          opacity={0.35}
          scale={8}
          blur={2.5}
          far={4}
        />
        <Environment preset="city" />
      </Suspense>

      <OrbitControls
        enablePan={false}
        enableZoom={false}
        enableRotate={!isSleeping}
        minPolarAngle={Math.PI / 2.5}
        maxPolarAngle={Math.PI / 2}
        minAzimuthAngle={-Math.PI / 4}
        maxAzimuthAngle={Math.PI / 4}
      />
    </Canvas>
  );
}
