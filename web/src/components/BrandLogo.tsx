import React from 'react';

interface Props {
  size?: number;
}

export default function BrandLogo({ size = 32 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="25" y="20" width="14" height="60" rx="3" fill="#E4E6EB" />
      <rect x="61" y="20" width="14" height="60" rx="3" fill="#E4E6EB" />
      <path d="M 25 58 L 75 38 L 75 52 L 25 72 Z" fill="#00F2FE" />
    </svg>
  );
}
