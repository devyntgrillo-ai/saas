import { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, Line, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

// Mobile port of the web ProcessingScreen neural-net "brain" (src/pages/ProcessingScreen.jsx):
// pulsing nodes, glowing edges, expanding glow rings, and signals traveling along edges.
// Animated on the UI thread via reanimated worklets.

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const NODES = [
  { cx: 70, cy: 80, r: 11, op: 0.9, glow: true },
  { cx: 108, cy: 54, r: 8, op: 0.7, glow: false },
  { cx: 150, cy: 74, r: 13, op: 0.95, glow: true },
  { cx: 95, cy: 116, r: 10, op: 0.8, glow: false },
  { cx: 140, cy: 122, r: 9, op: 0.7, glow: false },
  { cx: 62, cy: 150, r: 9, op: 0.75, glow: true },
  { cx: 106, cy: 166, r: 12, op: 0.85, glow: false },
  { cx: 158, cy: 166, r: 8, op: 0.7, glow: false },
  { cx: 192, cy: 56, r: 10, op: 0.8, glow: false },
  { cx: 236, cy: 86, r: 13, op: 0.95, glow: true },
  { cx: 206, cy: 120, r: 11, op: 0.85, glow: false },
  { cx: 256, cy: 150, r: 9, op: 0.75, glow: false },
  { cx: 200, cy: 176, r: 10, op: 0.8, glow: true },
  { cx: 176, cy: 110, r: 14, op: 1, glow: true },
];
const EDGES: Array<[number, number]> = [
  [0, 1], [1, 2], [0, 3], [3, 5], [5, 6], [6, 4],
  [2, 13], [13, 4], [13, 10], [2, 8], [8, 9], [9, 10],
  [10, 12], [10, 11], [4, 7], [12, 7],
];
const SIGNALS: Array<[number, number, number]> = [
  [0, 3, 2200], [3, 5, 1600], [2, 13, 2700], [13, 10, 1900], [8, 9, 3000], [9, 10, 2400],
];

const NODE_FILL = '#0EA5E9';
const RING_STROKE = '#38BDF8';
const SIGNAL_FILL = '#e0f2fe';
const TWO_PI = Math.PI * 2;

function PulseNode({ cx, cy, r, op, phase, clock }: { cx: number; cy: number; r: number; op: number; phase: number; clock: SharedValue<number> }) {
  const props = useAnimatedProps(() => {
    'worklet';
    const t = (clock.value + phase) % 1;
    const wave = Math.sin(t * TWO_PI); // -1..1
    return { r: r * (1 + 0.18 * wave), fillOpacity: op * (0.8 + 0.2 * wave) };
  });
  return <AnimatedCircle cx={cx} cy={cy} fill={NODE_FILL} animatedProps={props} />;
}

function GlowRing({ cx, cy, r, phase, clock }: { cx: number; cy: number; r: number; phase: number; clock: SharedValue<number> }) {
  const props = useAnimatedProps(() => {
    'worklet';
    const t = (clock.value + phase) % 1;
    return { r: r * (1 + 1.4 * t), opacity: 0.5 * (1 - t) };
  });
  return <AnimatedCircle cx={cx} cy={cy} fill="none" stroke={RING_STROKE} strokeWidth={1.5} animatedProps={props} />;
}

function Signal({ from, to, clock }: { from: number; to: number; clock: SharedValue<number> }) {
  const a = NODES[from];
  const b = NODES[to];
  const props = useAnimatedProps(() => {
    'worklet';
    const t = clock.value;
    return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t };
  });
  return <AnimatedCircle r={3} fill={SIGNAL_FILL} animatedProps={props} />;
}

export function NeuralNet({ size = 300 }: { size?: number }) {
  const height = (size * 240) / 320;
  // One looping clock for pulses/rings; each node offsets by its phase.
  const clock = useSharedValue(0);
  // Independent clocks per signal (varied speeds).
  const sig0 = useSharedValue(0);
  const sig1 = useSharedValue(0);
  const sig2 = useSharedValue(0);
  const sig3 = useSharedValue(0);
  const sig4 = useSharedValue(0);
  const sig5 = useSharedValue(0);
  const sigClocks = [sig0, sig1, sig2, sig3, sig4, sig5];

  useEffect(() => {
    clock.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.linear }), -1, false);
    SIGNALS.forEach(([, , dur], i) => {
      sigClocks[i].value = withRepeat(withTiming(1, { duration: dur, easing: Easing.linear }), -1, false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ width: size, height }}>
      <Svg width={size} height={height} viewBox="0 0 320 240">
        <Defs>
          <RadialGradient id="nnGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={NODE_FILL} stopOpacity={0.2} />
            <Stop offset="65%" stopColor={NODE_FILL} stopOpacity={0.04} />
            <Stop offset="100%" stopColor={NODE_FILL} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Ellipse cx={160} cy={118} rx={155} ry={115} fill="url(#nnGlow)" />

        {EDGES.map(([a, b], i) => (
          <Line
            key={`e${i}`}
            x1={NODES[a].cx} y1={NODES[a].cy} x2={NODES[b].cx} y2={NODES[b].cy}
            stroke={NODE_FILL} strokeWidth={1.5} strokeOpacity={0.25}
          />
        ))}

        {NODES.map((n, i) => (n.glow ? <GlowRing key={`r${i}`} cx={n.cx} cy={n.cy} r={n.r} phase={(i * 0.2) % 1} clock={clock} /> : null))}

        {NODES.map((n, i) => (
          <PulseNode key={`n${i}`} cx={n.cx} cy={n.cy} r={n.r} op={n.op} phase={(i * 0.12) % 1} clock={clock} />
        ))}

        {SIGNALS.map(([a, b], i) => (
          <Signal key={`s${i}`} from={a} to={b} clock={sigClocks[i]} />
        ))}
      </Svg>
    </View>
  );
}
