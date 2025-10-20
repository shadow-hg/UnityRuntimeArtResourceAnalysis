declare module '@ant-design/plots' {
  import type { ForwardRefExoticComponent, RefAttributes } from 'react';

  export interface DualAxesConfig {
    data: [unknown[], unknown[]];
    xField: string;
    yField: [string, string];
    geometryOptions?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }

  export interface DualAxesInstance {
    chart?: {
      geometries?: Array<{
        elements?: Array<{
          data?: Record<string, unknown>;
          setState: (state: string, status: boolean) => void;
        }>;
      }>;
    };
    on?: (event: string, handler: (event: unknown) => void) => void;
  }

  export const DualAxes: ForwardRefExoticComponent<
    DualAxesConfig & RefAttributes<DualAxesInstance>
  >;
}
