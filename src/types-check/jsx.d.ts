declare global {
  namespace JSX {
    type Element = { type: string; props: Record<string, unknown> };
    interface IntrinsicElements {
      div: {
        ref?: unknown;
        className?: string;
        'data-city-view'?: boolean;
        children?: unknown;
      };
      canvas: {
        ref?: unknown;
        className?: string;
        'data-city-canvas'?: boolean;
      };
    }
  }
}
export {};
