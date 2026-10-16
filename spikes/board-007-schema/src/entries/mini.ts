import {
  array,
  boolean,
  enumOf,
  literal,
  nullable,
  number,
  optional,
  schema,
  string,
  validate,
} from '../mini.ts';

export const sticky = schema({
  kind: literal('sticky'),
  text: string({ maxLength: 10_000 }),
  color: enumOf(['yellow', 'orange', 'green', 'blue', 'violet', 'pink']),
  size: enumOf(['s', 'm', 'l']),
  fontSize: number({ min: 8, max: 200 }),
  align: optional(enumOf(['left', 'center', 'right'])),
  link: nullable(string()),
  locked: boolean(),
  tags: array(string(), { maxLength: 50 }),
});
export const card = schema({ refId: string({ minLength: 1 }), size: enumOf(['s', 'm', 'l']) });
export const stroke = schema({
  points: array(array(number()), { maxLength: 5000 }),
  color: string(),
  width: number({ min: 0.5, max: 64 }),
  brush: optional(string()),
});

export const check = {
  sticky: (v: unknown) => validate(sticky, v),
  card: (v: unknown) => validate(card, v),
  stroke: (v: unknown) => validate(stroke, v),
};
