import { z } from 'zod';

export const sticky = z.strictObject({
  kind: z.literal('sticky'),
  text: z.string().max(10_000),
  color: z.enum(['yellow', 'orange', 'green', 'blue', 'violet', 'pink']),
  size: z.enum(['s', 'm', 'l']),
  fontSize: z.number().min(8).max(200),
  align: z.optional(z.enum(['left', 'center', 'right'])),
  link: z.nullable(z.string()),
  locked: z.boolean(),
  tags: z.array(z.string()).max(50),
});
export const card = z.strictObject({ refId: z.string().min(1), size: z.enum(['s', 'm', 'l']) });
export const stroke = z.strictObject({
  points: z.array(z.array(z.number())).max(5000),
  color: z.string(),
  width: z.number().min(0.5).max(64),
  brush: z.optional(z.string()),
});

export const check = {
  sticky: (x: unknown) => sticky.safeParse(x),
  card: (x: unknown) => card.safeParse(x),
  stroke: (x: unknown) => stroke.safeParse(x),
};
