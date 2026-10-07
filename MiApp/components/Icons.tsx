import React from 'react';
import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';
import { CUSTOM_ICONS } from './customIcons';

// Line icons for the LAIKA design (24x24 grid, drawn as SVG so they render the
// same on web and native; the web build has no icon font).

export type IconName =
  | 'gear' | 'chevronDown' | 'chevronUp' | 'chevronLeft' | 'chevronRight' | 'play' | 'folder'
  | 'user' | 'close' | 'arrowLeft' | 'arrowRight' | 'home' | 'check' | 'plus' | 'minus'
  | 'mic' | 'siren' | 'flashlight' | 'camera' | 'record' | 'stop' | 'paw' | 'shield'
  | 'batteryRobot' | 'phone' | 'dogStanding' | 'dogLying'
  | 'grid' | 'images' | 'chart' | 'notes' | 'download' | 'pause' | 'clock';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export default function Icon({ name, size = 24, color = '#F8E3E3', strokeWidth = 2 }: IconProps) {
  const stroke = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const solid = { fill: color };
  let body: React.ReactNode;
  switch (name) {
    case 'gear':
      // Rounded cog (Lucide "settings" outline, ISC).
      body = (
        <>
          <Path
            d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
            {...stroke}
          />
          <Circle cx={12} cy={12} r={3} {...stroke} />
        </>
      );
      break;
    case 'chevronDown': body = <Polyline points="6 9 12 15 18 9" {...stroke} />; break;
    case 'chevronUp': body = <Polyline points="6 15 12 9 18 15" {...stroke} />; break;
    case 'chevronLeft': body = <Polyline points="15 6 9 12 15 18" {...stroke} />; break;
    case 'chevronRight': body = <Polyline points="9 6 15 12 9 18" {...stroke} />; break;
    case 'play': body = <Path d="M7 4.2v15.6a1 1 0 0 0 1.5.86l12.4-7.8a1 1 0 0 0 0-1.72L8.5 3.34A1 1 0 0 0 7 4.2z" {...solid} />; break;
    case 'folder':
      // Open folder (Lucide "folder-open", ISC).
      body = (
        <Path
          d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"
          {...stroke}
        />
      );
      break;
    case 'user':
      body = (
        <>
          <Circle cx={12} cy={7} r={4} {...stroke} />
          <Path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" {...stroke} />
        </>
      );
      break;
    case 'close':
      body = (
        <>
          <Line x1={6} y1={6} x2={18} y2={18} {...stroke} />
          <Line x1={18} y1={6} x2={6} y2={18} {...stroke} />
        </>
      );
      break;
    case 'arrowLeft':
      body = (
        <>
          <Line x1={20} y1={12} x2={4} y2={12} {...stroke} />
          <Polyline points="11 5 4 12 11 19" {...stroke} />
        </>
      );
      break;
    case 'arrowRight':
      body = (
        <>
          <Line x1={4} y1={12} x2={20} y2={12} {...stroke} />
          <Polyline points="13 5 20 12 13 19" {...stroke} />
        </>
      );
      break;
    case 'home':
      body = (
        <>
          {/* Lucide "house" outline (ISC). */}
          <Path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...stroke} />
          <Path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" {...stroke} />
        </>
      );
      break;
    case 'check': body = <Polyline points="5 12.5 10 17.5 19 7" {...stroke} />; break;
    case 'minus': body = <Line x1={6} y1={12} x2={18} y2={12} {...stroke} />; break;
    case 'plus':
      body = (
        <>
          <Line x1={12} y1={5} x2={12} y2={19} {...stroke} />
          <Line x1={5} y1={12} x2={19} y2={12} {...stroke} />
        </>
      );
      break;
    case 'mic':
      body = (
        <>
          {/* Lucide "mic" shape (ISC), capsule filled as in the design. */}
          <Path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" {...solid} />
          <Path d="M19 10v2a7 7 0 0 1-14 0v-2" {...stroke} />
          <Line x1={12} y1={19} x2={12} y2={22} {...stroke} />
        </>
      );
      break;
    case 'siren':
      body = (
        <>
          <Path d="M3 10v4h3l7 4V6L6 10z" {...stroke} />
          <Line x1={16.5} y1={8} x2={20} y2={6} {...stroke} />
          <Line x1={17} y1={12} x2={21} y2={12} {...stroke} />
          <Line x1={16.5} y1={16} x2={20} y2={18} {...stroke} />
        </>
      );
      break;
    case 'flashlight':
      body = (
        <>
          {/* Lucide "flashlight" outline (ISC). */}
          <Path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z" {...stroke} />
          <Line x1={6} y1={6} x2={18} y2={6} {...stroke} />
          <Line x1={12} y1={12} x2={12} y2={13} {...stroke} />
        </>
      );
      break;
    case 'camera':
      body = (
        <>
          {/* Lucide "camera" outline (ISC). */}
          <Path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" {...stroke} />
          <Circle cx={12} cy={13} r={3} {...stroke} />
        </>
      );
      break;
    case 'record':
      body = (
        <>
          <Circle cx={12} cy={12} r={9} {...stroke} />
          <Circle cx={12} cy={12} r={4.5} {...solid} />
        </>
      );
      break;
    case 'stop':
      body = (
        <>
          <Circle cx={12} cy={12} r={9} {...stroke} />
          <Rect x={8.5} y={8.5} width={7} height={7} rx={1} {...solid} />
        </>
      );
      break;
    case 'shield':
      // Lucide "shield" outline (ISC), used for the anti-collision toggle.
      body = (
        <Path
          d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.79 17 5 19 5a1 1 0 0 1 1 1z"
          {...stroke}
        />
      );
      break;
    case 'paw':
      body = (
        <>
          <Ellipse cx={12} cy={16} rx={5} ry={4.2} {...solid} />
          <Ellipse cx={5.5} cy={10.5} rx={2.1} ry={2.6} {...solid} />
          <Ellipse cx={9.3} cy={6.2} rx={2.1} ry={2.7} {...solid} />
          <Ellipse cx={14.7} cy={6.2} rx={2.1} ry={2.7} {...solid} />
          <Ellipse cx={18.5} cy={10.5} rx={2.1} ry={2.6} {...solid} />
        </>
      );
      break;
    case 'batteryRobot':
      // Vertical battery with a small window, as in the status bar design.
      body = (
        <>
          <Rect x={10} y={2} width={4} height={2.5} rx={0.6} {...solid} />
          <Rect x={7.5} y={4} width={9} height={18} rx={2} {...solid} />
          <Rect x={10.6} y={8} width={2.8} height={5} rx={0.6} fill="#231e1e" />
        </>
      );
      break;
    case 'phone':
      body = (
        <>
          <Rect x={6} y={2.5} width={11} height={19} rx={1.5} {...stroke} strokeWidth={2.4} />
          <Line x1={19.5} y1={9} x2={19.5} y2={12.5} {...stroke} strokeWidth={2.4} />
        </>
      );
      break;
    case 'dogStanding':
      body = (
        <Path
          d="M3 9.5l2.2-1.8.4-2.2 1.6 1.4 1.3-.3 2 1.8 7.2.4c1.3.1 2.3 1.1 2.3 2.4v1.3l1.4 1.8-1.1.6-1.4-1.4-.9 2.3.9 4.2h-1.9l-1-3.8-5.6.2-.9 3.6H7.6l.4-4.5-1.6-4.3-2.4.4z"
          {...solid}
        />
      );
      break;
    case 'dogLying':
      body = (
        <Path
          d="M2.5 12.5l2-1.6.4-2 1.5 1.2 1.2-.2 1.8 1.7 6.4.6c1.8.2 3.4 1.2 4.2 2.8l.9 1.8h-2.2l-.6-.9-.4 1.6H4.8l2-1.2-.6-2.3-2.2.6z"
          {...solid}
        />
      );
      break;
    case 'grid':
      body = (
        <>
          <Rect x={3} y={3} width={8} height={8} rx={1.5} {...stroke} />
          <Rect x={13} y={3} width={8} height={8} rx={1.5} {...stroke} />
          <Rect x={3} y={13} width={8} height={8} rx={1.5} {...stroke} />
          <Rect x={13} y={13} width={8} height={8} rx={1.5} {...stroke} />
        </>
      );
      break;
    case 'images':
      body = (
        <>
          <Rect x={2.5} y={5.5} width={15} height={13} rx={2} {...stroke} />
          <Circle cx={8} cy={10.5} r={1.7} {...stroke} />
          <Path d="M3 17l4.2-4.2a2 2 0 0 1 2.8 0L13 15.8" {...stroke} />
          <Path d="M8 5.5V4a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 20 4v10.5a1.5 1.5 0 0 1-1.5 1.5H17" {...stroke} />
        </>
      );
      break;
    case 'chart':
      body = (
        <>
          <Polyline points="3 17 9 10 13.5 14 21 5.5" {...stroke} />
          <Polyline points="15 5.5 21 5.5 21 11.5" {...stroke} />
        </>
      );
      break;
    case 'notes':
      body = (
        <>
          <Path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" {...stroke} />
          <Line x1={8} y1={12} x2={16} y2={12} {...stroke} />
          <Line x1={8} y1={16} x2={13} y2={16} {...stroke} />
        </>
      );
      break;
    case 'download':
      body = (
        <>
          <Path d="M12 3v12" {...stroke} />
          <Polyline points="7 10.5 12 15.5 17 10.5" {...stroke} />
          <Path d="M4 19.5h16" {...stroke} />
        </>
      );
      break;
    case 'pause':
      body = (
        <>
          <Rect x={6} y={5} width={4} height={14} rx={1} {...solid} />
          <Rect x={14} y={5} width={4} height={14} rx={1} {...solid} />
        </>
      );
      break;
    case 'clock':
      body = (
        <>
          <Circle cx={12} cy={12} r={9} {...stroke} />
          <Polyline points="12 7 12 12 16 14" {...stroke} />
        </>
      );
      break;
  }
  return <Svg width={size} height={size} viewBox="0 0 24 24">{body}</Svg>;
}

// Wi-Fi with 0–3 lit arcs: lit parts take the level colour, the rest stay muted.
export function WifiIcon({ size = 24, color, level, muted = '#9a8b8b' }: { size?: number; color: string; level: 0 | 1 | 2 | 3; muted?: string }) {
  const arc = (lit: boolean) => ({ stroke: lit ? color : muted, strokeWidth: 2.2, strokeLinecap: 'round' as const, fill: 'none' });
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 9.5a13 13 0 0 1 18 0" {...arc(level >= 3)} />
      <Path d="M6.5 13a8 8 0 0 1 11 0" {...arc(level >= 2)} />
      <Circle cx={12} cy={17.5} r={1.9} fill={color} />
    </Svg>
  );
}

const CUSTOM_TAGS = { path: Path, rect: Rect, circle: Circle, ellipse: Ellipse, line: Line, polyline: Polyline, polygon: Polygon } as const;

export function hasCustomIcon(name: string): boolean {
  return name in CUSTOM_ICONS;
}

// Icons uploaded to assets/icons (see scripts/build-icons.js). Keeps the
// file's own proportions inside a size x size box, so nothing gets stretched.
export function CustomIcon({ name, size = 24, color = '#F8E3E3' }: { name: string; size?: number; color?: string }) {
  const icon = CUSTOM_ICONS[name];
  if (!icon) return null;
  return (
    <Svg width={size} height={size} viewBox={icon.viewBox}>
      {icon.elements.map((el, i) => {
        const Tag = CUSTOM_TAGS[el.tag] as React.ComponentType<any>;
        const attrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(el.attrs)) attrs[k] = v === 'currentColor' ? color : v;
        return <Tag key={i} {...attrs} />;
      })}
    </Svg>
  );
}
