/**
 * The placeholder `bun run new:tool` leaves in every piece it writes.
 *
 * A call never typechecks: tsc reports `Argument of type '"<note>"' is not
 * assignable to parameter of type '"<note>" & TodoFillIn'`, so
 * `bun run typecheck` lists exactly what is left, note included. Test files
 * are outside tsc, so the call also throws: an unfilled test fails
 * `bun test` too. Nothing committed to main calls it.
 */

// A plain object type, so tsc prints its name in the error rather than its shape.
type TodoFillIn = { readonly TODO_FILL_IN: never };

export const todo = <const Note extends string>(note: Note & TodoFillIn): never => {
  throw new Error(`TODO (bun run new:tool): ${note}`);
};
