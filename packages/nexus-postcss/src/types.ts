export interface NexusPostcssOptions {
  content?: string[];
  extraContent?: string[];
  theme?: Record<string, any>;
  tailwindPlugins?: any[];
  import?: boolean;
  nested?: boolean;
  nestingMode?: 'classic' | 'modern';
  presetEnv?: boolean | 'stage2' | 'stage3' | 'stage4';
  autoprefixer?: boolean | Record<string, string>;
  logical?: boolean | Record<string, any>;
  minify?: boolean;
  sourcemap?: boolean;
  engine?: 'postcss' | 'lightningcss';
  plugins?: Array<[string, any] | string>;
}