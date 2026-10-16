import * as z from 'zod/mini';

export const sticky = z.strictObject({
  kind: z.literal('sticky'),
  text: z.string().check(z.maxLength(10_000)),
  color: z.enum(['yellow', 'orange', 'green', 'blue', 'violet', 'pink']),
  size: z.enum(['s', 'm', 'l']),
  fontSize: z.number().check(z.minimum(8), z.maximum(200)),
  align: z.optional(z.enum(['left', 'center', 'right'])),
  link: z.nullable(z.string()),
  locked: z.boolean(),
  tags: z.array(z.string()).check(z.maxLength(50)),
});
export const card = z.strictObject({
  refId: z.string().check(z.minLength(1)),
  size: z.enum(['s', 'm', 'l']),
});
export const stroke = z.strictObject({
  points: z.array(z.array(z.number())).check(z.maxLength(5000)),
  color: z.string(),
  width: z.number().check(z.minimum(0.5), z.maximum(64)),
  brush: z.optional(z.string()),
});

export const check = {
  sticky: (x: unknown) => z.safeParse(sticky, x),
  card: (x: unknown) => z.safeParse(card, x),
  stroke: (x: unknown) => z.safeParse(stroke, x),
};
