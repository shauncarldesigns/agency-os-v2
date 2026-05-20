import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'tier1' | 'tier2' | 'tier3';
type Size = 'default' | 'sm' | 'xs';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export function Button({ variant = 'primary', size = 'default', className = '', children, ...rest }: ButtonProps) {
  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'xs' ? 'btn-xs' : '';
  return (
    <button className={`btn btn-${variant} ${sizeClass} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
