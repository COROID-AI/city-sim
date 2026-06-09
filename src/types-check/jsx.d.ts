declare global {
  namespace JSX {
    type Element = { type: string; props: Record<string, unknown> };
    interface IntrinsicElements {
      div: {
        ref?: unknown;
        className?: string;
        'data-city-view'?: boolean;
        'data-time-controls'?: boolean;
        'data-time-readout'?: boolean;
        'data-no-pan'?: string;
        children?: unknown;
      };
      canvas: {
        ref?: unknown;
        className?: string;
        'data-city-canvas'?: boolean;
      };
      button: {
        type?: string;
        ref?: unknown;
        className?: string;
        'aria-label'?: string;
        'aria-pressed'?: boolean;
        'aria-hidden'?: boolean;
        'data-no-pan'?: string;
        onClick?: unknown;
        children?: unknown;
      };
      span: {
        className?: string;
        'aria-hidden'?: boolean;
        'data-time-readout'?: boolean;
        children?: unknown;
      };
      svg: {
        viewBox?: string;
        width?: string | number;
        height?: string | number;
        'aria-hidden'?: boolean;
        children?: unknown;
      };
      path: { d?: string; fill?: string };
      rect: { x?: string | number; y?: string | number; width?: string | number; height?: string | number; fill?: string };
    }
  }
}
export {};
