/**
 * PetsEvolveCeremony - Immersive evolution experience (baby -> adult)
 *
 * Flow:
 *   1. Full-screen dark backdrop with baby pets centered, pulsing glow + spiraling particles
 *   2. Screen flash — evolution mutation fires
 *   3. Flash clears — adult pets revealed with sparkles + radiant glow
 *   4. Brief dialog, then fade to white and complete
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';

import { notificationSuccess } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { PetsStageVisual } from '@/pets/ui/PetsStageVisual';
import type { PetsCompanion } from '@/pets/core/lib/pets';

import { useTypewriter } from '../hooks/useTypewriter';
import { hexToRgb, buildRevealGradient } from '../lib/ceremony-colors';

// ─── Phase Machine ────────────────────────────────────────────────────────────

type EvolvePhase =
  | 'gather'     // baby visible, energy gathering with spiraling particles
  | 'flash'      // screen flash, mutation fires
  | 'reveal'     // flash clears, adult revealed with sparkles + text
  | 'error'      // mutation failed, do not continue the reveal
  | 'complete';  // fade out

// ─── Props ────────────────────────────────────────────────────────────────────

interface PetsEvolveCeremonyProps {
  companion: PetsCompanion;
  /** Fires the actual evolve mutation (baby -> adult). */
  onEvolve: () => Promise<void>;
  /** Called when the animation is complete and the overlay should close. */
  onComplete: () => void;
}

const FLASH_MIN_MS = 400;
const GATHER_MS = 2800;
const REVEAL_BEFORE_FADE_MS = 3200;
const FADE_OUT_MS = 2000;

// ─── Component ────────────────────────────────────────────────────────────────

export function PetsEvolveCeremony({
  companion,
  onEvolve,
  onComplete,
}: PetsEvolveCeremonyProps) {
  const [phase, setPhase] = useState<EvolvePhase>('gather');
  const [showFlash, setShowFlash] = useState(false);
  const [adultVisible, setAdultVisible] = useState(false);
  const [textVisible, setTextVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const evolveTriggered = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onEvolveRef = useRef(onEvolve);
  onEvolveRef.current = onEvolve;
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearAllTimeouts = () => {
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];
  };

  const scheduleTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timeoutRefs.current = timeoutRefs.current.filter((t) => t !== id);
      fn();
    }, ms);
    timeoutRefs.current.push(id);
    return id;
  }, []);

  const baseColor = companion.visualTraits.baseColor ?? '#8b5cf6';
  const { r, g, b } = useMemo(() => hexToRgb(baseColor), [baseColor]);

  // ── Typewriter for reveal text ──
  const line1 = `${companion.name} has evolved!`;
  const line2 = 'A new chapter begins...';
  const typewriter1 = useTypewriter(line1, textVisible);
  const typewriter2 = useTypewriter(line2, typewriter1.done);

  // Build adult companion for visual preview (same visual traits, stage=adult)
  const adultCompanion = useMemo((): PetsCompanion => ({
    ...companion,
    stage: 'adult',
    state: 'active' as const,
    progressionState: 'none' as const,
  }), [companion]);

  // Background: baby's base color blended toward white for a soft pastel
  const revealBg = useMemo(() => buildRevealGradient(baseColor), [baseColor]);

  // Dark background for gather phase
  const darkBg = useMemo(() => {
    const dr = Math.round(r * 0.12);
    const dg = Math.round(g * 0.12);
    const db = Math.round(b * 0.12);
    return `radial-gradient(ellipse at center, rgb(${dr + 10},${dg + 15},${db + 25}) 0%, rgb(${dr + 5},${dg + 10},${db + 18}) 50%, rgb(${dr},${dg + 5},${db + 12}) 100%)`;
  }, [r, g, b]);

  // ── Phase timeline ──
  useEffect(() => {
    const t1 = scheduleTimeout(() => {
      setPhase('flash');
      setShowFlash(true);
      notificationSuccess();
    }, GATHER_MS);

    return () => {
      clearTimeout(t1);
      clearAllTimeouts();
    };
  }, [scheduleTimeout]);

  // ── Fire evolve mutation during flash ──
  useEffect(() => {
    if (phase !== 'flash' || evolveTriggered.current) return;
    evolveTriggered.current = true;

    const evolvePromise = onEvolveRef.current();
    const minFlashPromise = new Promise((resolve) => setTimeout(resolve, FLASH_MIN_MS));

    Promise.all([evolvePromise, minFlashPromise])
      .then(() => {
        setShowFlash(false);
        setPhase('reveal');
        setAdultVisible(true);
        setTextVisible(true);

        scheduleTimeout(() => {
          setFadeOut(true);
          scheduleTimeout(() => {
            setPhase('complete');
            onCompleteRef.current();
          }, FADE_OUT_MS);
        }, REVEAL_BEFORE_FADE_MS);
      })
      .catch((err) => {
        console.error('Evolve failed:', err);
        setShowFlash(false);
        setErrorMessage(err instanceof Error ? err.message : 'Evolution failed.');
        setPhase('error');
      });
  }, [phase, scheduleTimeout]);

  const showBaby = phase === 'gather';
  const showAdult = phase === 'reveal';
  const isError = phase === 'error';

  if (isError) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 p-6"
        style={{ background: 'radial-gradient(ellipse at center, #2a0a0a 0%, #150505 50%, #0a0202 100%)' }}
      >
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold text-white">Evolution failed</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            {errorMessage ?? 'Something went wrong while evolving your pet.'}
          </p>
        </div>
        <Button onClick={() => onCompleteRef.current()}>Close</Button>
      </div>
    );
  }

  return (
    <div
      data-evolve-ceremony
      className="fixed inset-0 z-50 overflow-hidden select-none"
      style={{
        background: showAdult ? revealBg : darkBg,
        transition: 'background 0.15s ease-out',
      }}
    >
      {/* ── Vignette shadow for depth ── */}
      {showAdult && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at 50% 45%, transparent 30%, rgba(0,0,0,0.12) 70%, rgba(0,0,0,0.25) 100%)',
          }}
        />
      )}

      {/* ── Ambient color glow (gather phase) ── */}
      {showBaby && (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at 50% 50%, rgba(${r},${g},${b},0.25) 0%, transparent 60%)`,
            opacity: 0.15,
          }}
        />
      )}

      {/* ── Spiraling energy particles (gather phase) ── */}
      {showBaby && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: 12 }).map((_, i) => {
            const angle = (i / 12) * 360;
            const delay = i * 0.25;
            return (
              <div
                key={`particle-${i}`}
                className="absolute left-1/2 top-1/2"
                style={{
                  width: 4 + (i % 3) * 2,
                  height: 4 + (i % 3) * 2,
                  borderRadius: '50%',
                  background: i % 2 === 0
                    ? `radial-gradient(circle, rgba(${r},${g},${b},0.9) 0%, transparent 70%)`
                    : `radial-gradient(circle, rgba(255,255,255,0.9) 0%, transparent 70%)`,
                  animation: `evolve-spiral-in 3s ease-in ${delay}s infinite`,
                  transform: `rotate(${angle}deg) translateX(200px)`,
                }}
              />
            );
          })}
        </div>
      )}

      {/* ── Baby pets (gather phase) ── */}
      {showBaby && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ paddingBottom: '10%' }}>
          {/* Pulsing glow behind baby */}
          <div
            className="absolute rounded-full"
            style={{
              width: 250,
              height: 250,
              background: `radial-gradient(circle, rgba(${r},${g},${b},0.2) 0%, transparent 70%)`,
              filter: 'blur(20px)',
              animation: 'evolve-glow-pulse 2s ease-in-out infinite',
            }}
          />

          <div className="relative">
            <PetsStageVisual
              companion={companion}
              size="lg"
              animated
              className="size-56 sm:size-64 md:size-72"
            />
          </div>
        </div>
      )}

      {/* ── Screen flash ── */}
      {showFlash && (
        <div
          className="absolute inset-0 bg-white pointer-events-none"
          style={{
            zIndex: 80,
            animation: 'onboard-screen-flash 2s ease-out forwards',
          }}
        />
      )}

      {/* ── Adult pets revealed with sparkles ── */}
      {showAdult && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingBottom: '18%' }}>
          {/* Rotating radiant glow */}
          <div
            className="absolute"
            style={{
              opacity: adultVisible ? 1 : 0,
              transform: adultVisible ? 'scale(1)' : 'scale(0.7)',
              transition: 'opacity 0.2s ease-out, transform 0.2s ease-out',
            }}
          >
            <div
              className="animate-onboard-golden-rotate"
              style={{
                width: 800,
                height: 800,
                background: `conic-gradient(
                  from 0deg,
                  rgba(${r},${g},${b},0.15) 0deg,
                  rgba(255,255,255,0.35) 50deg,
                  rgba(${r},${g},${b},0.18) 100deg,
                  rgba(255,255,255,0.12) 150deg,
                  rgba(${r},${g},${b},0.30) 210deg,
                  rgba(255,255,255,0.15) 270deg,
                  rgba(${r},${g},${b},0.12) 320deg,
                  rgba(${r},${g},${b},0.15) 360deg
                )`,
                borderRadius: '50%',
                filter: 'blur(30px)',
              }}
            />
          </div>

          {/* Bright center shine */}
          <div
            className={cn(
              'absolute rounded-full transition-opacity duration-150',
              adultVisible ? 'opacity-100' : 'opacity-0',
            )}
            style={{
              width: 320,
              height: 320,
              background: `radial-gradient(circle, rgba(255,255,245,0.60) 0%, rgba(${r},${g},${b},0.20) 40%, transparent 70%)`,
            }}
          />

          {/* Wider halo */}
          <div
            className={cn(
              'absolute rounded-full transition-opacity duration-200',
              adultVisible ? 'opacity-100' : 'opacity-0',
            )}
            style={{
              width: 650,
              height: 650,
              background: `radial-gradient(circle, rgba(${r},${g},${b},0.25) 0%, rgba(${r},${g},${b},0.10) 40%, transparent 65%)`,
              filter: 'blur(15px)',
            }}
          />

          {/* ── Sparkles ── */}
          {Array.from({ length: 18 }).map((_, i) => {
            const angle = (i / 18) * Math.PI * 2;
            const radius = 90 + (i % 4) * 40;
            const size = 4 + (i % 3) * 3;
            return (
              <div
                key={`spark-${i}`}
                className="absolute"
                style={{
                  width: size,
                  height: size,
                  left: `calc(50% + ${Math.cos(angle) * radius}px - ${size / 2}px)`,
                  top: `calc(50% + ${Math.sin(angle) * radius}px - ${size / 2}px)`,
                  borderRadius: '50%',
                  background: i % 2 === 0
                    ? `radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(255,255,255,0.3) 50%, transparent 70%)`
                    : `radial-gradient(circle, rgba(${r},${g},${b},0.9) 0%, rgba(${r},${g},${b},0.2) 50%, transparent 70%)`,
                  animation: `onboard-sparkle-twinkle ${1.5 + (i % 6) * 0.5}s ease-in-out ${i * 0.15}s infinite`,
                }}
              />
            );
          })}

          {/* Outer ring sparkles */}
          {Array.from({ length: 14 }).map((_, i) => {
            const angle = (i / 14) * Math.PI * 2 + 0.4;
            const radius = 180 + (i % 3) * 45;
            const size = 5 + (i % 4) * 2;
            return (
              <div
                key={`outer-${i}`}
                className="absolute"
                style={{
                  width: size,
                  height: size,
                  left: `calc(50% + ${Math.cos(angle) * radius}px - ${size / 2}px)`,
                  top: `calc(50% + ${Math.sin(angle) * radius}px - ${size / 2}px)`,
                  borderRadius: '50%',
                  background: i % 3 === 0
                    ? 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, transparent 60%)'
                    : `radial-gradient(circle, rgba(${r},${g},${b},0.7) 0%, transparent 60%)`,
                  animation: `onboard-sparkle-twinkle ${2.5 + (i % 5) * 0.7}s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            );
          })}

          {/* Rising light motes */}
          {Array.from({ length: 8 }).map((_, i) => {
            const x = (Math.sin(i * 2.3) * 0.5 + 0.5) * 70 + 15;
            return (
              <div
                key={`mote-${i}`}
                className="absolute"
                style={{
                  width: 5 + (i % 3) * 3,
                  height: 5 + (i % 3) * 3,
                  left: `${x}%`,
                  bottom: '20%',
                  borderRadius: '50%',
                  background: `radial-gradient(circle, rgba(${r},${g},${b},0.8) 0%, rgba(${r},${g},${b},0.2) 50%, transparent 100%)`,
                  animation: `onboard-sparkle-drift ${4 + i * 0.5}s ease-out ${i * 0.4}s infinite`,
                }}
              />
            );
          })}

          {/* The adult pets */}
          <div className={cn(
            'relative transition-opacity duration-150',
            adultVisible ? 'opacity-100' : 'opacity-0',
          )}>
            <PetsStageVisual
              companion={adultCompanion}
              size="lg"
              animated
              className="size-[30rem] sm:size-[36rem] md:size-[44rem]"
            />
          </div>
        </div>
      )}

      {/* ── Typewriter text (appears during reveal) ── */}
      {showAdult && textVisible && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center pb-28 sm:pb-36 px-8">
          <div className="relative max-w-md w-full text-center">
            {/* Soft feathered backdrop */}
            <div
              className="absolute -inset-32"
              style={{
                background: 'radial-gradient(ellipse at center, rgba(0,30,50,0.35) 0%, rgba(0,30,50,0.15) 35%, transparent 65%)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                mask: 'radial-gradient(ellipse at center, black 25%, transparent 65%)',
                WebkitMask: 'radial-gradient(ellipse at center, black 25%, transparent 65%)',
              }}
            />

            <div className="relative">
              <p className="text-base sm:text-lg text-white leading-relaxed font-light min-h-[1.5em]">
                {typewriter1.displayed}
                {!typewriter1.done && (
                  <span className="inline-block w-[2px] h-[1em] bg-white/50 ml-0.5 animate-pulse align-text-bottom" />
                )}
              </p>
              {typewriter1.done && (
                <p className="text-sm text-white/60 mt-2 font-light min-h-[1.25em]">
                  {typewriter2.displayed}
                  {!typewriter2.done && (
                    <span className="inline-block w-[2px] h-[0.85em] bg-white/30 ml-0.5 animate-pulse align-text-bottom" />
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Fade to white on completion ── */}
      {fadeOut && (
        <div
          className="absolute inset-0 bg-white pointer-events-none"
          style={{
            zIndex: 90,
            animation: 'pets-fade-to-white 2s ease-in forwards',
          }}
        />
      )}
    </div>
  );
}
