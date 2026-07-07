/**
 * Minimal type for egg visual rendering.
 * This type contains only the properties needed for rendering the egg graphic,
 * making the module self-contained and portable.
 */
export type EggVisualPets = {
  tags?: string[][];
  baseColor?: string;
  secondaryColor?: string;
  pattern?: string;
  specialMark?: string;
  title?: string;
  lifeStage?: 'egg' | 'baby' | 'adult';
  themeVariant?: string;
  crossoverApp?: string | null;
  /** Optional visual scale multiplier (e.g. from dev editor egg_scale). */
  scale?: number;
};
