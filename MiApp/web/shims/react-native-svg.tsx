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

export function Path(props: React.SVGProps<SVGPathElement>) {
  return <path {...props} />;
}

export function Rect(props: React.SVGProps<SVGRectElement>) {
  return <rect {...props} />;
}

export function Polyline(props: React.SVGProps<SVGPolylineElement>) {
  return <polyline {...props} />;
}

export function Polygon(props: React.SVGProps<SVGPolygonElement>) {
  return <polygon {...props} />;
}

export function Ellipse(props: React.SVGProps<SVGEllipseElement>) {
  return <ellipse {...props} />;
}

export function G(props: React.SVGProps<SVGGElement>) {
  return <g {...props} />;
}

export default Svg;
