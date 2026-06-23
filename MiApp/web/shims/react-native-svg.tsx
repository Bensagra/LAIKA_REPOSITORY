import React from 'react';

type SvgProps = React.SVGProps<SVGSVGElement> & {
  width?: number | string;
  height?: number | string;
  viewBox?: string;
};

function Svg({ children, width, height, viewBox, ...props }: SvgProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      {...props}
    >
      {children}
    </svg>
  );
}

export function Circle(props: React.SVGProps<SVGCircleElement>) {
  return <circle {...props} />;
}

export function Line(props: React.SVGProps<SVGLineElement>) {
  return <line {...props} />;
}

export default Svg;
