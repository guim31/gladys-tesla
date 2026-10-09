// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, SDK v0.14+, Gladys 5.1+).
//
// What a scene can already do through the device features (start charging,
// set the charge limit, lock...) is not repeated here: only the operations no
// feature carries. The backup reserve is one: Gladys has no device feature
// type for it, and "raise the reserve to 100 % when a storm is announced" is
// the classic Powerwall automation.
//
// Fields arrive resolved and validated by the core; throwing fails this
// action only, the scene goes on.
// -----------------------------------------------------------------------------

export const SCENE_ACTION_KEYS = { SET_BACKUP_RESERVE: 'set_backup_reserve' };

export function createSceneActions(tesla) {
  return {
    async [SCENE_ACTION_KEYS.SET_BACKUP_RESERVE]({ fields }) {
      const reserve = await tesla.setBackupReserve(fields.device, fields.percent);
      return { backup_reserve: reserve };
    },
  };
}
