import * as v from 'valibot';

export const sticky = v.strictObject({
  kind: v.literal('sticky'),
  text: v.pipe(v.string(), v.maxLength(10_000)),
  color: v.picklist(['yellow', 'orange', 'green', 'blue', 'violet', 'pink']),
  size: v.picklist(['s', 'm', 'l']),
  fontSize: v.pipe(v.number(), v.finite(), v.minValue(8), v.maxValue(200)),
  align: v.optional(v.picklist(['left', 'center', 'right'])),
  link: v.nullable(v.string()),
  locked: v.boolean(),
  tags: v.pipe(v.array(v.string()), v.maxLength(50)),
});
export const card = v.strictObject({
  refId: v.pipe(v.string(), v.minLength(1)),
  size: v.picklist(['s', 'm', 'l']),
});
export const stroke = v.strictObject({
  points: v.pipe(v.array(v.array(v.pipe(v.number(), v.finite()))), v.maxLength(5000)),
  color: v.string(),
  width: v.pipe(v.number(), v.finite(), v.minValue(0.5), v.maxValue(64)),
  brush: v.optional(v.string()),
});

export const check = {
  sticky: (x: unknown) => v.safeParse(sticky, x),
  card: (x: unknown) => v.safeParse(card, x),
  stroke: (x: unknown) => v.safeParse(stroke, x),
};
