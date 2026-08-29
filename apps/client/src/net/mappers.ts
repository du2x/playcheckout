import type { RegistryKey, RegistryPayload } from '@turnover/shared'
import type { ViewAction } from '../state'

/**
 * Exhaustive payload → ViewAction table (cycle 2.3, REG-11/REG-12): one pure
 * mapper per registry key. A registry key without a mapper fails to compile;
 * a new server→client message therefore requires exactly one pure mapper here.
 * Mappers never touch the DOM, Phaser, or the network — the connection wrapper
 * stays dumb and the reducer stays the single view machine.
 */
export const MAPPERS: {
  [K in RegistryKey]: (payload: RegistryPayload<K>) => ViewAction[]
} = {
  'lobby:snapshot': (snapshot) => [{ type: 'snapshot', snapshot }],
  'round:started': ({ playerIds }) => [{ type: 'round-started', playerIds }],
  'role:dealt': ({ role }) => [{ type: 'role-dealt', role }],
  'round:buzzer': () => [{ type: 'buzzer' }],
  error: ({ message }) => [{ type: 'intent-error', message }],
  // Movement (cycle 2.4): the high-frequency events map to actions the App
  // routes to the world scene (render state); the reducer no-ops them.
  'player:moved': (p) => [{ type: 'player-moved', ...p }],
  'elevator:called': (p) => [{ type: 'elevator-called', ...p }],
  'elevator:moved': (p) => [{ type: 'elevator-moved', ...p }],
  // Rider-exclusive messages (AD-013): mapper pins live with the
  // connection task (T9); the reducer no-ops the scene-kind actions.
  'elevator:pressed': (p) => [{ type: 'elevator-pressed', ...p }],
  'elevator:riders': (p) => [{ type: 'elevator-riders', ...p }],
  'player:left': ({ playerId }) => [{ type: 'player-left', playerId }],
  'player:left-floor': (p) => [{ type: 'player-left-floor', ...p }],
  'movement:snapshot': (snapshot) => [{ type: 'movement-snapshot', snapshot }],
  // Work channels (cycle 2.5): scene-kind actions the App routes to the world
  // scene (progress bar, room label); the reducer no-ops them.
  'work:started': (p) => [{ type: 'work-started', ...p }],
  'work:ended': (p) => [{ type: 'work-ended', ...p }],
  'room:observed': (p) => [{ type: 'room-observed', ...p }],
  'room:prepped': (p) => [{ type: 'room-prepped', ...p }],
  'room:trashed': (p) => [{ type: 'room-trashed', ...p }],
  // Evidence (cycle 2.7): scene-kind actions; WorldScene renders the hallway
  // cues and the evidence session keeps the card set.
  'room:carded': (p) => [{ type: 'room-carded', ...p }],
  'room:settled': (p) => [{ type: 'room-settled', ...p }],
  'room:rustle': (p) => [{ type: 'room-rustle', ...p }],
  'room:entered': (p) => [{ type: 'room-entered', ...p }],
}
