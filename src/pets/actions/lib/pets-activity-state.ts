// src/pets/actions/lib/pets-activity-state.ts

import type { SelectedTrack } from '../components/PlayMusicModal';

/**
 * Types of inline activities that can be displayed in PetsPage
 */
export type InlineActivityType = 'none' | 'music' | 'sing';

// Re-export for convenience
export type { SelectedTrack } from '../components/PlayMusicModal';

/**
 * State for the music inline activity
 */
export interface MusicActivityState {
  type: 'music';
  selection: SelectedTrack;
  isPublished: boolean;
}

/**
 * State for the sing inline activity
 */
export interface SingActivityState {
  type: 'sing';
}

/**
 * No active inline activity
 */
export interface NoActivityState {
  type: 'none';
}

/**
 * Union type for all inline activity states
 */
export type InlineActivityState = 
  | NoActivityState 
  | MusicActivityState 
  | SingActivityState;

/**
 * Pets reaction state - indicates how Pets should visually react
 */
export type PetsReactionState = 
  | 'idle'           // No special reaction
  | 'listening'      // Music is playing, Pets is listening
  | 'swaying'        // Pets is swaying to music
  | 'singing'        // User is singing, Pets is engaged
  | 'happy';         // General happy reaction

/**
 * Helper to create a music activity state
 */
export function createMusicActivity(selection: SelectedTrack): MusicActivityState {
  return {
    type: 'music',
    selection,
    isPublished: false,
  };
}

/**
 * Helper to create a sing activity state
 */
export function createSingActivity(): SingActivityState {
  return {
    type: 'sing',
  };
}

/**
 * Helper to create no activity state
 */
export function createNoActivity(): NoActivityState {
  return {
    type: 'none',
  };
}
