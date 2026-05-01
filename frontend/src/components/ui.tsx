/**
 * shared ui primitives for consistent styling across the app.
 * light modern theme with indigo accent color.
 */

import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg';
}

const PADDING = { sm: 'p-3', md: 'p-4', lg: 'p-6' };

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 ${PADDING[padding]} ${className}`}>
      {children}
    </div>
  );
}

interface SectionTitleProps {
  children: React.ReactNode;
  count?: number;
  className?: string;
}

export function SectionTitle({ children, count, className = '' }: SectionTitleProps) {
  return (
    <div className={`flex items-center justify-between mb-3 ${className}`}>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        {children}
      </h3>
      {count !== undefined && (
        <span className="text-xs text-gray-400">{count}</span>
      )}
    </div>
  );
}

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'green' | 'blue' | 'purple' | 'yellow' | 'red';
  className?: string;
}

const BADGE_COLORS = {
  default: 'bg-gray-100 text-gray-700',
  green: 'bg-emerald-50 text-emerald-700',
  blue: 'bg-blue-50 text-blue-700',
  purple: 'bg-violet-50 text-violet-700',
  yellow: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
};

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${BADGE_COLORS[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-400';

  const variants = {
    primary: disabled
      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
      : 'bg-indigo-600 hover:bg-indigo-700 text-white',
    secondary: disabled
      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
      : 'bg-gray-100 hover:bg-gray-200 text-gray-700',
    ghost: disabled
      ? 'text-gray-300 cursor-not-allowed'
      : 'text-gray-600 hover:bg-gray-100',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
