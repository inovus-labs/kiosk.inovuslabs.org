import * as migration_20260529_081718_initial from './20260529_081718_initial';
import * as migration_20260529_094025_simplify from './20260529_094025_simplify';
import * as migration_20260530_054030_media_alt_optional from './20260530_054030_media_alt_optional';

export const migrations = [
  {
    up: migration_20260529_081718_initial.up,
    down: migration_20260529_081718_initial.down,
    name: '20260529_081718_initial',
  },
  {
    up: migration_20260529_094025_simplify.up,
    down: migration_20260529_094025_simplify.down,
    name: '20260529_094025_simplify',
  },
  {
    up: migration_20260530_054030_media_alt_optional.up,
    down: migration_20260530_054030_media_alt_optional.down,
    name: '20260530_054030_media_alt_optional'
  },
];
