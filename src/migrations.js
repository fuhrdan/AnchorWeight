export const CURRENT_STATE_VERSION = 5;
export const MIN_SUPPORTED_STATE_VERSION = 2;

export function migrateState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('State file must contain a JSON object');
  let state = structuredClone(input);
  let version = Number.isInteger(state.version) ? state.version : 2;
  if (version < MIN_SUPPORTED_STATE_VERSION) throw new Error(`State version ${version} is too old; minimum supported is ${MIN_SUPPORTED_STATE_VERSION}`);
  if (version > CURRENT_STATE_VERSION) throw new Error(`State version ${version} is newer than this AnchorWeight release supports`);

  const applied = [];
  while (version < CURRENT_STATE_VERSION) {
    if (version === 2) {
      state.campaigns ||= [];
      version = 3; applied.push('2->3 campaigns');
    } else if (version === 3) {
      state.profiles ||= [];
      state.campaigns ||= [];
      version = 4; applied.push('3->4 operator-policy compatible state');
    } else if (version === 4) {
      state.meta ||= {};
      state.meta.migratedAt = new Date().toISOString();
      version = 5; applied.push('4->5 release metadata');
    } else {
      throw new Error(`No migration path from state version ${version}`);
    }
  }
  state.version = CURRENT_STATE_VERSION;
  state.blocks ||= [];
  state.offenses ||= [];
  state.profiles ||= [];
  state.campaigns ||= [];
  state.meta ||= {};
  return { state, applied, fromVersion: Number.isInteger(input.version) ? input.version : 2, toVersion: CURRENT_STATE_VERSION };
}
