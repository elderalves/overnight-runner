import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge ships Tailwind's stock scales, but our theme
// (styles/index.css) replaces the shadow scale with xs/sm/md/modal.
// `shadow-modal` isn't a name it knows, so without this it would classify it
// as a shadow *color* and let it coexist with `shadow-md` instead of
// overriding it
const twMerge = extendTailwindMerge({
  extend: { classGroups: { shadow: ['shadow-modal'] } },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// No Button primitive was decided (design-tokens-component-mapping.md's UI
// primitive list is Sheet/Select/Input/Textarea/Label "and nothing more") --
// this is a class-string builder, not a component, for the plain `<button>`s
// the header bar and composer footer need.
export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';

export function buttonClass(variant: ButtonVariant = 'outline', size: 'sm' | 'default' = 'default'): string {
  const base =
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50';
  const sizeClass = size === 'sm' ? 'h-7 px-2.5' : 'h-8 px-3';
  const variantClass: Record<ButtonVariant, string> = {
    primary: 'bg-primary text-primary-foreground hover:brightness-95',
    outline: 'border border-border bg-card hover:bg-muted',
    ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
    danger: 'bg-danger text-white hover:brightness-95',
  };
  return cn(base, sizeClass, variantClass[variant]);
}
