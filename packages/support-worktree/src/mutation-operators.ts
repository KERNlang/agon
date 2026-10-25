/**
 * One type-safe single-token swap. `find` is matched (first occurrence, no flags) against a line whose non-code characters are masked to NUL, so it can only ever hit real code; the matched text is replaced by `replace`.
 */
export interface OperatorSpec {
  readonly name: string;
  readonly class: 'high-signal' | 'equiv-prone';
  readonly find: RegExp;
  readonly replace: string;
}

const op = (name: string, cls: OperatorSpec['class'], find: RegExp, replace: string): OperatorSpec =>
  ({ name, class: cls, find, replace });

// An operand must end right before a binary `&&`/`||`/`+`/`-`: this keeps Rust
// `&&x` (double reference), `|| body` (empty-arg closure) and unary minus out of
// the pool, because their swapped forms do not compile and prove nothing. NUL
// stands for a masked string literal, which is a valid operand.
const OPERAND_BEFORE = String.raw`(?<=[\w)\]\0]\s*)`;
const SPACED_OPERAND_BEFORE = String.raw`(?<=[\w)\]\0]\s+)`;

const equality = (p: string): OperatorSpec[] => [
  op(`${p}:==→!=`, 'high-signal', /(?<![=!<>])==(?!=)/, '!='),
  op(`${p}:!=→==`, 'high-signal', /!=(?!=)/, '=='),
];

// Relational swaps only on whitespace-delimited tokens: `Vec<T>`, `ch <- v`,
// `a >> 2`, `=>` and generic brackets never match.
const relational = (p: string): OperatorSpec[] => [
  op(`${p}:<→>=`, 'equiv-prone', /(?<=\s)<(?=\s)/, '>='),
  op(`${p}:>→<=`, 'equiv-prone', /(?<=\s)>(?=\s)/, '<='),
  op(`${p}:<=→>`, 'equiv-prone', /(?<=\s)<=(?=\s)/, '>'),
  op(`${p}:>=→<`, 'equiv-prone', /(?<=\s)>=(?=\s)/, '<'),
];

const booleans = (p: string, t: string, f: string): OperatorSpec[] => [
  op(`${p}:${t}→${f}`, 'high-signal', new RegExp(String.raw`\b${t}\b`), f),
  op(`${p}:${f}→${t}`, 'high-signal', new RegExp(String.raw`\b${f}\b`), t),
];

export function cLikeOperators(p: string): OperatorSpec[] {
  return [
    op(`${p}:+→-`, 'high-signal', new RegExp(String.raw`${OPERAND_BEFORE}\+(?![+=])`), '-'),
    op(`${p}:-→+`, 'high-signal', new RegExp(String.raw`${SPACED_OPERAND_BEFORE}-(?=\s)`), '+'),
    ...equality(p),
    op(`${p}:&&→||`, 'high-signal', new RegExp(String.raw`${OPERAND_BEFORE}&&`), '||'),
    op(`${p}:||→&&`, 'high-signal', new RegExp(String.raw`${OPERAND_BEFORE}(?<!\bmove\s*)\|\|`), '&&'),
    ...relational(p),
    ...booleans(p, 'true', 'false'),
  ];
}

export const PYTHON_OPERATORS: readonly OperatorSpec[] = [
  op('py:+→-', 'high-signal', /(?<!\+)\+(?![+=])/, '-'),
  op('py:-→+', 'high-signal', /(?<![-\w])-(?![-=>])/, '+'),
  ...equality('py'),
  op('py:and→or', 'high-signal', /\band\b/, 'or'),
  op('py:or→and', 'high-signal', /\bor\b/, 'and'),
  op('py:is not→is', 'high-signal', /\bis\s+not\b/, 'is'),
  op('py:is→is not', 'high-signal', /\bis\b(?!\s+not\b)/, 'is not'),
  op('py:not in→in', 'high-signal', /\bnot\s+in\b/, 'in'),
  // `for x in xs` is loop syntax, not a membership test.
  op('py:in→not in', 'high-signal', /(?<!\bnot\s+)(?<!\bfor\b[^:]*)\bin\b/, 'not in'),
  ...relational('py'),
  ...booleans('py', 'True', 'False'),
];

export const RUST_OPERATORS: readonly OperatorSpec[] = [
  ...cLikeOperators('rs'),
  op('rs:is_some→is_none', 'high-signal', /\bis_some\b/, 'is_none'),
  op('rs:is_none→is_some', 'high-signal', /\bis_none\b/, 'is_some'),
  op('rs:is_ok→is_err', 'high-signal', /\bis_ok\b/, 'is_err'),
  op('rs:is_err→is_ok', 'high-signal', /\bis_err\b/, 'is_ok'),
];
