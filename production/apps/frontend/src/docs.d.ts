// Ambient declarations for the in-app docs integration.

// playground.js attaches this to window when loaded.
interface Window {
  NexusPlayground?: {
    initAll(root?: ParentNode | null): void;
  };
}