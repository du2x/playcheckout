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
}
