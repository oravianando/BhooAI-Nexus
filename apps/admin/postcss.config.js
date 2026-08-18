import { createPreset } from '@bhooai/nexus-postcss';

export default createPreset({
  extraContent: ['../../packages/nexus-admin/src/**/*.{ts,tsx}'],
});