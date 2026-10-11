import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  fullWidth?: boolean;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'bg-accent text-white shadow-lg shadow-accent/30 hover:bg-accent/90 disabled:bg-white/10 disabled:text-white/40 disabled:shadow-none',
  secondary:
    'bg-surface border border-white/15 text-white hover:bg-white/5 disabled:text-white/30 disabled:border-white/5',
  ghost: 'bg-transparent text-white/70 hover:text-white hover:bg-white/5 disabled:text-white/20',
  danger: 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-40',
};

// min-h-[48px] keeps every button comfortably inside standard mobile
// touch-target guidance (Milestone 6 §1/§22).
export function Button({
  variant = 'primary',
  fullWidth,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`min-h-[48px] rounded-2xl px-5 py-3 text-base font-bold transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accentSoft ${VARIANT_CLASSES[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
