/**
 * Walking around the body: the camera and the orbit target move together
 * along the ground, so the view keeps its angle and the orbit centre travels
 * with you. The scene is Z-up, so "along the ground" is the XY plane. The
 * target stays within a radius of the body, so nobody walks off the 24 m
 * ground into the horizon. Pure numbers, so a step is testable without a
 * camera.
 */

export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];

/** Metres per second; a little over 1 m/s reads as walking for a ~1.8 m body. */
export const WALK_SPEED_M_S = 1.4;
/** The orbit target stays this close to the body. */
export const WALK_RADIUS_M = 8;
/** A long pause (tab hidden) must not become one big jump. */
export const MAX_WALK_DT_S = 0.1;

type Intent = Readonly<{ forward: number; right: number }>;

/** `KeyboardEvent.code`, so WASD works on any keyboard layout. */
export const WALK_CODES: Readonly<Record<string, Intent>> = {
  KeyW: { forward: 1, right: 0 },
  ArrowUp: { forward: 1, right: 0 },
  KeyS: { forward: -1, right: 0 },
  ArrowDown: { forward: -1, right: 0 },
  KeyA: { forward: 0, right: -1 },
  ArrowLeft: { forward: 0, right: -1 },
  KeyD: { forward: 0, right: 1 },
  ArrowRight: { forward: 0, right: 1 },
};

export const isWalkCode = (code: string): boolean => code in WALK_CODES;

/** Held keys as one intent; opposite keys cancel. */
export const walkIntent = (held: Iterable<string>): Intent => {
  const codes = [...new Set(held)].filter(isWalkCode);
  const sum = (axis: keyof Intent) =>
    Math.max(
      -1,
      Math.min(
        1,
        codes.reduce((total, code) => total + WALK_CODES[code]![axis], 0),
      ),
    );
  return { forward: sum("forward"), right: sum("right") };
};

/** What a key handler needs to know about where a key landed. */
export type KeyTarget = Readonly<{
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}>;

const FIELD_TAGS: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Roles whose own keys include letters or arrows: a slider, a tab list, a list box. */
const KEYED_ROLES: ReadonlySet<string> = new Set([
  "combobox",
  "grid",
  "listbox",
  "menu",
  "menubar",
  "menuitem",
  "option",
  "radio",
  "radiogroup",
  "searchbox",
  "slider",
  "spinbutton",
  "tab",
  "tablist",
  "textbox",
  "tree",
]);

/** A field or widget that uses the key itself, so walking must leave it alone. */
export const isTypingTarget = (target: KeyTarget | null): boolean => {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  if (FIELD_TAGS.has((target.tagName ?? "").toUpperCase())) return true;
  const role = target.getAttribute?.("role") ?? null;
  return role !== null && KEYED_ROLES.has(role);
};

export type WalkKey = Readonly<{
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** Something closer to the key (a slider, the panel search) already used it. */
  defaultPrevented: boolean;
  typing: boolean;
  /** The pointer is over the 3D view. */
  pointerOver: boolean;
  /** Focus is on the 3D view or inside it. */
  focusInside: boolean;
}>;

/**
 * Whether a key walks: a walk key with no modifier, not typed into a field
 * or widget, while the pointer is over the 3D view or the view has focus. No
 * click first: hovering is enough, so the keys do not depend on where focus
 * happened to be left.
 */
export const walkKeyApplies = (key: WalkKey): boolean =>
  isWalkCode(key.code) &&
  !key.altKey &&
  !key.ctrlKey &&
  !key.metaKey &&
  !key.defaultPrevented &&
  !key.typing &&
  (key.pointerOver || key.focusInside);

/** A point pulled back onto the circle when it is outside it. */
export const clampToRadius = (point: Vec2, center: Vec2, radius: number): Vec2 => {
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  const distance = Math.hypot(dx, dy);
  if (distance <= radius) return point;
  const scale = radius / distance;
  return [center[0] + dx * scale, center[1] + dy * scale];
};

export type WalkPose = Readonly<{ position: Vec3; target: Vec3 }>;

/**
 * One step: forward is where the camera looks, flattened onto the ground;
 * right is forward × up. A diagonal is no faster than a straight line.
 */
export const walkStep = ({
  pose,
  intent,
  dt,
  center,
  speed = WALK_SPEED_M_S,
  radius = WALK_RADIUS_M,
}: Readonly<{
  pose: WalkPose;
  intent: Intent;
  dt: number;
  center: Vec2;
  speed?: number;
  radius?: number;
}>): WalkPose => {
  const { position, target } = pose;
  const lookX = target[0] - position[0];
  const lookY = target[1] - position[1];
  const look = Math.hypot(lookX, lookY);
  // Looking straight down: walk towards +Y, the body's back to front.
  const [fx, fy] = look > 1e-6 ? [lookX / look, lookY / look] : [0, 1];
  const moveX = fx * intent.forward + fy * intent.right;
  const moveY = fy * intent.forward - fx * intent.right;
  const length = Math.hypot(moveX, moveY);
  if (length === 0) return pose;
  const step = (speed * Math.min(dt, MAX_WALK_DT_S)) / Math.max(1, length);
  const next = clampToRadius(
    [target[0] + moveX * step, target[1] + moveY * step],
    center,
    radius,
  );
  const dx = next[0] - target[0];
  const dy = next[1] - target[1];
  return {
    position: [position[0] + dx, position[1] + dy, position[2]],
    target: [next[0], next[1], target[2]],
  };
};
