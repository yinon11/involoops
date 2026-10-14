/**
 * Involoops Studio mark — the Möbius + arrowhead.
 * Ported from the Claude Design handoff bundle (studio-mark.jsx, locked v1.0).
 * Tip at (112, 26), arrow tangent 85° above horizontal, stroke-width 10 in a
 * 140×128 viewBox. Arrow color defaults to the mark color.
 */

interface InvoloopsStudioMarkProps {
  size?: number;
  color?: string;
  arrowColor?: string;
  className?: string;
  title?: string;
}

export function InvoloopsStudioMark({
  size = 32,
  color = "currentColor",
  arrowColor,
  className,
  title,
}: InvoloopsStudioMarkProps) {
  const a = arrowColor ?? color;
  const tip = { x: 112, y: 26 };
  const len = 18;
  const theta = (85 * Math.PI) / 180;
  const tx = Math.cos(theta);
  const ty = -Math.sin(theta);
  const rotate = (ang: number) => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return { x: tx * c - ty * s, y: tx * s + ty * c };
  };
  const b1 = rotate((135 * Math.PI) / 180);
  const b2 = rotate((-135 * Math.PI) / 180);
  const p1 = { x: tip.x + b1.x * len, y: tip.y + b1.y * len };
  const p2 = { x: tip.x + b2.x * len, y: tip.y + b2.y * len };

  return (
    <svg
      viewBox="0 0 140 128"
      width={size}
      height={size}
      fill="none"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className={className}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M30 60c0-14 10-24 22-24 8 0 14 5 18 12 4 7 10 12 18 12 12 0 22-10 22-22"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M90 60c0 14-10 24-22 24-8 0-14-5-18-12-4-7-10-12-18-12-12 0-22 10-22 22"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d={`M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} L ${tip.x} ${tip.y} L ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`}
        stroke={a}
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
