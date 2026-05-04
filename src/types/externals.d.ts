/**
 * Type declarations for host-provided external packages (design system v1).
 * These are not installed as dependencies — they're provided as globals by the host.
 */

declare module '@nekazari/viewer-kit' {
  import type { ReactNode, CSSProperties } from 'react';

  export interface SlotShellProps {
    moduleId: string;
    accent: { base: string; soft: string; strong: string };
    children?: ReactNode;
    className?: string;
    style?: CSSProperties;
  }

  export const SlotShell: React.FC<SlotShellProps>;
  export const SlotShellCompact: React.FC<SlotShellProps>;
}

declare module '@nekazari/design-tokens' {
  export const tokens: Record<string, string>;
  export default tokens;
}

declare module '@nekazari/ui-kit' {
  import type { ReactNode, CSSProperties, ChangeEvent } from 'react';

  export interface ButtonProps {
    children?: ReactNode;
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'link' | 'destructive';
    size?: 'xs' | 'sm' | 'md' | 'lg';
    disabled?: boolean;
    onClick?: (e: React.MouseEvent) => void;
    className?: string;
    style?: CSSProperties;
    type?: 'button' | 'submit';
    title?: string;
    'aria-pressed'?: boolean;
    'aria-label'?: string;
    onMouseDown?: (e: React.MouseEvent) => void;
  }

  export const Button: React.FC<ButtonProps>;

  export interface SelectOption {
    value: string;
    label: string;
  }

  export interface SelectProps {
    value: string | number;
    onChange: (value: string) => void;
    options: SelectOption[];
    className?: string;
    style?: CSSProperties;
    placeholder?: string;
  }

  export const Select: React.FC<SelectProps>;

  export interface InputProps {
    value?: string;
    onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
    type?: string;
    placeholder?: string;
    className?: string;
    style?: CSSProperties;
    autoFocus?: boolean;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    maxLength?: number;
  }

  export const Input: React.FC<InputProps>;

  export interface SliderProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    className?: string;
  }

  export const Slider: React.FC<SliderProps>;

  export interface BadgeProps {
    children?: ReactNode;
    variant?: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info' | 'outline';
    className?: string;
    role?: string;
    'aria-live'?: string;
  }

  export const Badge: React.FC<BadgeProps>;

  export interface TabsProps {
    tabs: Array<{ id: string; label: string }>;
    activeTab: string;
    onChange: (id: string) => void;
    className?: string;
  }

  export const Tabs: React.FC<TabsProps>;

  export interface SpinnerProps {
    size?: number;
    className?: string;
  }

  export const Spinner: React.FC<SpinnerProps>;

  export interface InlineProps {
    children?: ReactNode;
    gap?: 'xs' | 'sm' | 'md' | 'lg';
    className?: string;
    style?: CSSProperties;
  }

  export const Inline: React.FC<InlineProps>;

  export interface StackProps {
    children?: ReactNode;
    gap?: 'xs' | 'sm' | 'md' | 'lg';
    className?: string;
    style?: CSSProperties;
  }

  export const Stack: React.FC<StackProps>;
}
