import * as migration_20260529_081718_initial from './20260529_081718_initial';

export const migrations = [
  {
    up: migration_20260529_081718_initial.up,
    down: migration_20260529_081718_initial.down,
    name: '20260529_081718_initial'
  },
];
