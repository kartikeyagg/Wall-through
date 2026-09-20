export type ControlKeyStyle = "alternatives" | "chord";

export type Control = {
  readonly keys: readonly string[];
  readonly action: string;
  readonly context?: string;
  readonly keyStyle?: ControlKeyStyle;
};

export type ControlGroup = {
  readonly id: string;
  readonly title: string;
  readonly note?: string;
  readonly controls: readonly Control[];
};

export type FlatControl = Control & { readonly groupId: string };

export const CONTROL_GROUPS: readonly ControlGroup[];
export const ALL_CONTROLS: readonly FlatControl[];
export function controlsFor(contextId: string): ControlGroup | null;
export function formatKeys(keys: readonly string[], keyStyle?: ControlKeyStyle): string;
