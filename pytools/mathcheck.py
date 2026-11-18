"""The symbolic check: whether a learner's answer equals the expected expression.

Reads one JSON object on standard input, {"expected": ..., "answer": ...},
each side as typed in the page's math field, LaTeX or plain (`3x^2`,
`\\frac{1}{2}`, `sqrt(x)`). Writes one JSON object on standard output whose
"result" is

- "equivalent" or "different";
- "unparsable", with "side" ("expected" or "answer") and a "reason";
- "undecided", with a "reason": the sides read, but the check could not
  prove equivalence or find a difference within its limits;
- "parsed", when the request has no "answer": the expected side reads.

Input it cannot read is an error, on standard error, with exit status 2.

Reading. Plain input is rewritten into LaTeX by `_tokens` and read by SymPy's
LaTeX parser (ANTLR), which builds SymPy objects without evaluating text, so
no input reaches Python's evaluator. A command not in `_COMMANDS` is refused
rather than read as a product of letters. `e` is Euler's number, `\\log` the
natural logarithm, `i` a variable; a letter before a parenthesis multiplies
(`x(x+1)`); `a/bc` is refused as ambiguous; decimals are exact (`0.5` is 1/2).

Comparing (decisions.md, "Symbolic check"):
- expressions: equal if their difference simplifies to zero; sample points
  (real variables, complex values) may disprove equality, never prove it;
- a `+ C` on both sides: a constant of integration, so they may differ by a
  constant;
- numbers: a decimal of at least three significant figures matches a value
  within half a unit of its last digit;
- equations: equal up to a non-zero constant factor; `x = 2` and `2` match;
- lists, separated by commas, optionally in `\\{ \\}`: exact duplicates are
  ignored, then distinct values must match one-to-one, including when rounded.
"""

import cmath
import json
import random
import re
import signal
import sys
import time
from dataclasses import dataclass

import sympy
from sympy import E, Rational, Symbol, pi
from sympy.core.function import AppliedUndef
from sympy.parsing.latex import parse_latex

TIME_LIMIT = 8.0  # seconds for the comparison, start-up and reading aside
SIMPLIFY_LIMIT = 2.0  # seconds for one simplification before trying counterexamples
MAX_LENGTH = 1000  # characters on one side
SAMPLES_NEEDED = 6  # agreeing points tried before returning undecided
SAMPLE_TRIES = 40  # points tried, since some leave a side undefined
LARGEST = sympy.Float("1e100000")  # a larger number is refused: exact arithmetic on it can hang

_FUNCTIONS = {
    "sin", "cos", "tan", "sec", "csc", "cot",
    "arcsin", "arccos", "arctan", "arcsec", "arccsc", "arccot",
    "sinh", "cosh", "tanh", "arsinh", "arcosh", "artanh",
    "exp", "ln", "log", "lg",
}
_GREEK = {
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
    "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "rho",
    "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon",
    "Phi", "Psi", "Omega",
}
_CONSTANTS = {"pi", "infty"}
_COMMANDS = (
    _FUNCTIONS
    | _GREEK
    | _CONSTANTS
    | {"sqrt", "frac", "binom", "cdot", "times", "div", "lfloor", "rfloor", "lceil", "rceil"}
)
_ALIASES = {"dfrac": "frac", "tfrac": "frac", "dbinom": "binom", "tbinom": "binom"}
_IGNORED = {"\\,", "\\;", "\\:", "\\!", "\\ ", "\\quad", "\\qquad", "\\left", "\\right"}
# Names typed without a backslash, read as the command.
_PLAIN = {name: name for name in _FUNCTIONS - {"lg"}} | {
    "sqrt": "sqrt",
    "pi": "pi",
    "asin": "arcsin",
    "acos": "arccos",
    "atan": "arctan",
    "infinity": "infty",
}
_PLAIN_LONGEST_FIRST = sorted(_PLAIN, key=len, reverse=True)
_PAIRS = {"(": ")", "[": "]", "{": "}", "\\{": "\\}"}

# `\frac{dy}{dx}`, `d/dx`: read otherwise, `d` would be a variable.
_DERIVATIVE = re.compile(r"\\[dt]?frac\s*\{\s*d\s*[A-Za-z]?\s*\}\s*\{\s*d|d\s*[A-Za-z]?\s*/\s*d\s*[A-Za-z]")
_TOKEN = re.compile(
    r"\s+|\\[A-Za-z]+|\\[^A-Za-z]|[0-9]+(?:\.[0-9]+)?|\.[0-9]+|[A-Za-z]+|\*\*|[-+*/^_()\[\]{}|=,!']"
)


class Unparsable(Exception):
    """A side that cannot be read; the message says why."""


class TimeUp(BaseException):
    """The comparison's time is spent."""


class _Alarm(BaseException):
    # A BaseException, so that SymPy's `except Exception` does not swallow it.
    pass


@dataclass(frozen=True)
class Expression:
    expr: sympy.Expr
    decimal: str | None  # the text, when the side is one decimal number


@dataclass(frozen=True)
class Equation:
    lhs: Expression
    rhs: Expression


@dataclass(frozen=True)
class Verdict:
    result: str  # "equivalent", "different" or "undecided"
    reason: str | None = None


EQUIVALENT = Verdict("equivalent")
DIFFERENT = Verdict("different")


def check(expected, answer=None, *, seconds=TIME_LIMIT, simplify_seconds=SIMPLIFY_LIMIT):
    """The check's result as the dictionary written out (see the module's header)."""
    try:
        expected_items = read(expected)
    except Unparsable as error:
        return {"result": "unparsable", "side": "expected", "reason": str(error)}
    if answer is None:
        return {"result": "parsed"}
    try:
        answer_items = read(answer)
    except Unparsable as error:
        return {"result": "unparsable", "side": "answer", "reason": str(error)}
    clock = _Clock(seconds, simplify_seconds)
    def alarm(_signum, _frame):
        raise _Alarm

    previous = signal.signal(signal.SIGALRM, alarm)
    try:
        signal.setitimer(signal.ITIMER_REAL, clock.remaining())
        verdict = _compare_lists(expected_items, answer_items, clock)
    except (TimeUp, _Alarm):
        verdict = Verdict("undecided", "the check ran out of time")
    except Exception as error:  # a SymPy failure is not a grade
        verdict = Verdict("undecided", f"the check failed: {type(error).__name__}")
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
    if verdict.reason is None:
        return {"result": verdict.result}
    return {"result": verdict.result, "reason": verdict.reason}


# Reading


def read(text):
    """The items of one side: one, or several when separated by commas."""
    if not isinstance(text, str):
        raise Unparsable("it is not text")
    return [_read_item(tokens) for tokens in _split_items(_tokens(text))]


def _tokens(text):
    """The side as LaTeX tokens, plain names given their backslash."""
    text = text.replace("$", "")
    if len(text) > MAX_LENGTH:
        raise Unparsable(f"it is longer than {MAX_LENGTH} characters")
    if _DERIVATIVE.search(text):
        raise Unparsable("derivative notation is not understood: give the derivative itself")
    text = re.sub(r"\\mathrm\s*\{\s*e\s*\}", " e ", text)
    text = re.sub(r"\\(?:left|right)\s*\.", " ", text)
    tokens, position = [], 0
    while position < len(text):
        match = _TOKEN.match(text, position)
        if match is None:
            raise Unparsable(f"'{text[position]}' is not understood")
        position = match.end()
        token = match.group()
        if token.isspace() or token in _IGNORED:
            continue
        if token in ("\\{", "\\}"):
            tokens.append(token)
        elif token.startswith("\\"):
            name = _ALIASES.get(token[1:], token[1:])
            if name not in _COMMANDS:
                raise Unparsable(f"{token} is not understood")
            tokens.append("\\" + name)
        elif token[0].isalpha():
            tokens.extend(_split_word(token))
        elif token == "**":
            tokens.append("^")
        elif token.startswith("."):
            tokens.append("0" + token)
        else:
            tokens.append(token)
    if not tokens:
        raise Unparsable("it is empty")
    return tokens


def _split_word(word):
    """Letters typed together: known names (`sin`, `sqrt`, `pi`) and single letters."""
    out, i = [], 0
    while i < len(word):
        name = next((n for n in _PLAIN_LONGEST_FIRST if word.startswith(n, i)), None)
        if name is None:
            out.append(word[i])
            i += 1
        else:
            out.append("\\" + _PLAIN[name])
            i += len(name)
    return out


def _split_items(tokens):
    """Splits at commas outside brackets, after removing braces around the whole."""
    if tokens[0] in ("\\{", "{") and _matching(tokens, 0) == len(tokens) - 1:
        tokens = tokens[1:-1]
    items, current, closers = [], [], []
    for token in tokens:
        if token in _PAIRS:
            closers.append(_PAIRS[token])
        elif token in _PAIRS.values():
            if not closers or closers.pop() != token:
                raise Unparsable("its brackets do not match")
        if token == ",":
            if closers:
                raise Unparsable("a comma inside brackets is not understood")
            items.append(current)
            current = []
        else:
            current.append(token)
    if closers:
        raise Unparsable("its brackets do not match")
    items.append(current)
    if any(not item for item in items):
        raise Unparsable("an item of the list is empty")
    return items


def _matching(tokens, start):
    """The index of the bracket that closes the one at `start`."""
    closers = []
    for i in range(start, len(tokens)):
        if tokens[i] in _PAIRS:
            closers.append(_PAIRS[tokens[i]])
        elif tokens[i] in _PAIRS.values():
            if not closers or closers.pop() != tokens[i]:
                break
            if not closers:
                return i
    raise Unparsable("its brackets do not match")


def _read_item(tokens):
    if tokens.count("=") > 1:
        raise Unparsable("it has more than one '='")
    if "=" in tokens:
        at = tokens.index("=")
        return Equation(_read_expression(tokens[:at]), _read_expression(tokens[at + 1 :]))
    return _read_expression(tokens)


def _read_expression(tokens):
    if not tokens:
        raise Unparsable("a side of its '=' is empty")
    if "\\{" in tokens or "\\}" in tokens:
        raise Unparsable("\\{ is understood only around a list")
    literal = _literal_number(tokens)
    decimal = literal if literal is not None and "." in literal else None
    if any(left == right == "!" for left, right in zip(tokens, tokens[1:])):
        raise Unparsable("double factorial notation is not understood")
    tokens = _fix_powers(_fix_roots(list(tokens)))
    _refuse_zero_function_powers(tokens)
    tokens = _exact_decimals(_brace_d(tokens))
    _refuse_ambiguous_division(tokens)
    try:
        expr = parse_latex(" ".join(tokens), strict=True)
        if not isinstance(expr, sympy.Expr) or isinstance(expr, sympy.core.relational.Relational):
            raise Unparsable("it is not an expression")
        _refuse_huge_numbers(expr)
        finished = _finish(expr)
        if finished.has(sympy.nan, sympy.zoo):
            raise Unparsable("it contains an undefined value")
        return Expression(finished, decimal)
    except Unparsable:
        raise
    except Exception as error:  # the parser's errors, and RecursionError on deep nesting
        message = str(error).strip()
        first = message.splitlines()[0] if message else type(error).__name__
        raise Unparsable(f"it could not be read as math ({first})") from None


def _literal_number(tokens):
    """A signed number, possibly grouped, preserving all of its digits."""
    sign = ""
    while tokens:
        if tokens[0] in ("(", "{") and _matching(tokens, 0) == len(tokens) - 1:
            tokens = tokens[1:-1]
        elif tokens[0] in ("+", "-"):
            if tokens[0] == "-":
                sign = "" if sign else "-"
            tokens = tokens[1:]
        else:
            break
    if len(tokens) == 1 and tokens[0][0].isdigit():
        return sign + tokens[0]
    return None


def _is_atom(token):
    return token[0].isdigit() or (len(token) == 1 and token.isalpha()) or token[1:] in _GREEK | _CONSTANTS


def _fix_roots(tokens):
    """`\\sqrt(x)` and `\\sqrt x` as `\\sqrt{x}`, which is all the parser reads."""
    i = 0
    while i < len(tokens):
        if tokens[i] == "\\sqrt" and i + 1 < len(tokens):
            k = i + 1
            if tokens[k] == "[":
                # ANTLR uses the principal complex branch, not the ordinary
                # real odd root of a negative number.
                raise Unparsable("indexed root notation is not understood")
            if tokens[k] == "(":
                end = _matching(tokens, k)
                tokens[k], tokens[end] = "{", "}"
            elif _is_atom(tokens[k]):
                tokens[k : k + 1] = ["{", tokens[k], "}"]
        i += 1
    return tokens


def _fix_powers(tokens):
    """`x^(2n)` and `x^-1` as `x^{(2n)}` and `x^{-1}`."""
    i = 0
    while i < len(tokens):
        if tokens[i] == "^" and i + 1 < len(tokens):
            k = i + 1
            if tokens[k] in ("+", "-") and k + 1 < len(tokens):
                k += 1
            if tokens[k] in ("(", "{"):
                end = _matching(tokens, k)
            elif _is_atom(tokens[k]):
                end = k
            else:
                end = None
            if end is not None:
                if tokens[end + 1 : end + 2] == ["^"]:
                    raise Unparsable("chained powers are ambiguous: group them explicitly")
                if tokens[k] == "(" or (k > i + 1 and tokens[k] != "{"):
                    tokens[i + 1 : end + 1] = ["{", *tokens[i + 1 : end + 1], "}"]
        i += 1
    return tokens


def _refuse_zero_function_powers(tokens):
    # ANTLR silently discards a literal zero exponent written on a function.
    for i, token in enumerate(tokens[:-1]):
        if token[1:] not in _FUNCTIONS:
            continue
        k = i + 1
        if tokens[k] == "_" and k + 1 < len(tokens):
            k = _after_script(tokens, k + 1)
        if k + 1 < len(tokens) and tokens[k] == "^":
            exponent = _literal_number(tokens[k + 1 : _after_script(tokens, k + 1)])
            if exponent is not None and not any(digit in "123456789" for digit in exponent):
                raise Unparsable(r"a zero power on a function is not understood: write (\cos(x))^0")


def _brace_d(tokens):
    # The parser reads `d` before a letter as a differential (`dx` one symbol).
    return [part for token in tokens for part in (["{", "d", "}"] if token == "d" else [token])]


def _exact_decimals(tokens):
    """`2.5` as `{\\frac{25}{10}}`, so decimals are exact."""
    out = []
    for token in tokens:
        if "." in token:
            whole, fraction = token.split(".")
            numerator = str(int(whole + fraction))  # the parser refuses a leading zero
            out += ["{", "\\frac", "{", numerator, "}", "{", "1" + "0" * len(fraction), "}", "}"]
        else:
            out.append(token)
    return out


def _refuse_ambiguous_division(tokens):
    """`1/2x` and `1/2|x|` could mean two different things."""
    abs_open = False
    for i, token in enumerate(tokens):
        if token == "|":
            abs_open = not abs_open
        if token in ("/", "\\div"):
            k = _skip_operand(tokens, i + 1)
            if k < len(tokens) and (_starts_operand(tokens[k]) or (tokens[k] == "|" and not abs_open)):
                raise Unparsable(
                    "a division followed by a product is ambiguous: write \\frac{a}{bc}, a/(bc) or (a/b)c"
                )


def _starts_operand(token):
    return _is_atom(token) or token in ("(", "[", "{", "\\frac", "\\sqrt", "\\binom") or token[1:] in _FUNCTIONS


def _skip_operand(tokens, k):
    """The index after the operand starting at `k`; the end when it cannot tell."""
    n = len(tokens)
    if k < n and tokens[k] in ("+", "-"):
        k += 1
    if k >= n:
        return n
    token = tokens[k]
    if token in _PAIRS:
        k = _matching(tokens, k) + 1
    elif token == "|":
        try:
            k = tokens.index("|", k + 1) + 1
        except ValueError:
            return n  # the parser will report the unclosed bar
    elif token in ("\\frac", "\\binom", "\\sqrt"):
        k += 1
        for _ in range(1 if token == "\\sqrt" else 2):
            if k >= n:
                return n
            k = _matching(tokens, k) + 1 if tokens[k] == "{" else k + 1
    elif _is_atom(token):
        k += 1
    elif token[1:] in _FUNCTIONS:
        # A function's exponent or base precedes its argument.
        k = _skip_scripts(tokens, k + 1)
        k = _skip_operand(tokens, k)
    else:
        return n
    return _skip_scripts(tokens, k)


def _skip_scripts(tokens, k):
    n = len(tokens)
    while k < n and tokens[k] in ("^", "_", "!", "'"):
        k += 1
        if tokens[k - 1] in ("^", "_") and k < n:
            k = _after_script(tokens, k)
    return k


def _after_script(tokens, k):
    return _matching(tokens, k) + 1 if tokens[k] in _PAIRS else k + 1


def _refuse_huge_numbers(expr):
    for node in sympy.preorder_traversal(expr):
        if isinstance(node, (sympy.Pow, sympy.factorial, sympy.binomial)) and node.is_number:
            value = node.evalf(15)  # floating point copes with 10^(10^10)
            if value.is_finite and abs(value) > LARGEST:
                raise Unparsable("it holds a number too large to check")


_NAMED = {"e": E, "pi": pi}  # the parser reads both as variables


def _finish(expr):
    """Evaluates what the parser left unevaluated; `e`, `\\pi` and `x(...)` as the text means."""
    if expr is sympy.nan or expr is sympy.zoo:
        raise Unparsable("it contains an undefined value")
    if isinstance(expr, Symbol):
        return _NAMED.get(expr.name, expr)
    if not expr.args:
        return expr
    args = [_finish(arg) for arg in expr.args]
    if isinstance(expr, AppliedUndef) and "'" not in expr.func.__name__ and len(args) == 1:
        name = expr.func.__name__
        result = _NAMED.get(name, Symbol(name)) * args[0]
    else:
        result = expr.func(*args)
    # Check intermediate results: SymPy can simplify (1/0)^0 to 1.
    if result is sympy.nan or result is sympy.zoo:
        raise Unparsable("it contains an undefined value")
    return result


# Comparing


class _Clock:
    def __init__(self, seconds, simplify_seconds):
        self.end = time.monotonic() + seconds
        self.simplify_seconds = simplify_seconds

    def remaining(self):
        seconds = self.end - time.monotonic()
        if seconds <= 0:
            raise TimeUp
        return seconds


def _simplified(expr, clock):
    """`simplify(expr)`, or None when it takes longer than its share of the time."""
    remaining = clock.remaining()
    if clock.simplify_seconds <= 0:
        return None
    short = clock.simplify_seconds < remaining
    try:
        if short:
            signal.setitimer(signal.ITIMER_REAL, clock.simplify_seconds)
        return sympy.simplify(expr)
    except _Alarm:
        if not short:
            raise
        return None
    except Exception:
        return None
    finally:
        if short:
            signal.setitimer(signal.ITIMER_REAL, clock.remaining())


def _value(expr, point):
    """The value at `point` as a complex number; None where it is undefined."""
    try:
        value = expr.evalf(30, subs=point)
        if not value.is_number:  # an undefined function, say
            return None
        number = complex(value)
    except (TypeError, ValueError, OverflowError, ZeroDivisionError):
        return None
    return number if cmath.isfinite(number) else None


def _close(u, v, tolerance=1e-9):
    return abs(u - v) <= tolerance * max(1.0, abs(u), abs(v))


def _samples(exprs, clock):
    """The values of `exprs` at sample points where each has a finite value."""
    symbols = sorted(set().union(*(e.free_symbols for e in exprs)), key=lambda s: s.name)
    rng = random.Random(0)
    for _ in range(SAMPLE_TRIES if symbols else 1):
        clock.remaining()
        point = {s: Rational(rng.randint(-3000, 3000), 997) for s in symbols}
        values = [_value(e, point) for e in exprs]
        if None not in values:
            yield values


def _undecided_sampling():
    return Verdict("undecided", "the sample points did not establish a difference")


def _compare_lists(expected, answer, clock):
    if len(expected) == 1 and len(answer) == 1:
        return _compare_items(expected[0], answer[0], clock)
    expected, expected_uncertainty = _distinct(expected, clock)
    answer, answer_uncertainty = _distinct(answer, clock)
    # Unsettled exact comparisons may change the number of distinct values.
    if uncertainty := expected_uncertainty or answer_uncertainty:
        return uncertainty
    if len(expected) != len(answer):
        return DIFFERENT
    verdicts = [[_compare_groups(e, a, clock) for a in answer] for e in expected]
    if _has_matching(verdicts):
        return EQUIVALENT
    if _has_matching(verdicts, permit_undecided=True):
        return Verdict("undecided", "the check could not prove a match for every distinct value")
    return DIFFERENT


def _distinct(items, clock):
    """Groups proven exact duplicates, preserving their decimal spellings."""
    groups, uncertainty = [], None
    for item in items:
        unresolved = None
        for group in groups:
            representative = group[0]
            verdict = _compare_items(representative, item, clock, rounding=False)
            if verdict == EQUIVALENT:
                if type(representative) is not type(item):
                    # A scalar can match isolated equations for different
                    # variables, so don't use that convention to deduplicate.
                    unresolved = Verdict("undecided", "a list mixes an equation with its isolated value")
                    continue
                if item not in group:
                    group.append(item)
                break
            if verdict.result == "undecided":
                unresolved = verdict
        else:
            groups.append([item])
            uncertainty = uncertainty or unresolved
    return groups, uncertainty


def _compare_groups(expected, answer, clock):
    remaining = DIFFERENT
    for e in expected:
        for a in answer:
            verdict = _compare_items(e, a, clock)
            if verdict == EQUIVALENT:
                return verdict
            if verdict.result == "undecided":
                remaining = verdict
    return remaining


def _has_matching(verdicts, *, permit_undecided=False):
    """Can every expected value use a different answer value?"""
    matched = {}

    def assign(row, seen):
        for column, verdict in enumerate(verdicts[row]):
            if column in seen or verdict == DIFFERENT:
                continue
            if verdict.result == "undecided" and not permit_undecided:
                continue
            seen.add(column)
            if column not in matched or assign(matched[column], seen):
                matched[column] = row
                return True
        return False

    return all(assign(row, set()) for row in range(len(verdicts)))


def _isolated(equation):
    """The variable and value of an isolated equation, in either order."""
    lhs, rhs = equation.lhs, equation.rhs
    # `x = y` could name either variable's value; don't guess from order.
    if isinstance(lhs.expr, Symbol) and isinstance(rhs.expr, Symbol):
        return None
    if isinstance(lhs.expr, Symbol) and lhs.expr not in rhs.expr.free_symbols:
        return lhs.expr, rhs
    if isinstance(rhs.expr, Symbol) and rhs.expr not in lhs.expr.free_symbols:
        return rhs.expr, lhs
    return None


def _compare_items(expected, answer, clock, *, rounding=True):
    if isinstance(expected, Expression) and isinstance(answer, Expression):
        return _compare_expressions(expected, answer, clock, rounding=rounding)
    if isinstance(expected, Equation) and isinstance(answer, Equation):
        left, right = _isolated(expected), _isolated(answer)
        # Wrapping both numbers in assignments to the same variable must
        # not disable the numeric rule. Other equations use their residuals.
        if (
            left is not None
            and right is not None
            and left[0] == right[0]
            and not left[1].expr.free_symbols
            and not right[1].expr.free_symbols
        ):
            return _compare_expressions(left[1], right[1], clock, rounding=rounding)
        return _compare_equations(expected, answer, clock)
    equation = expected if isinstance(expected, Equation) else answer
    isolated = _isolated(equation)
    if isolated is None:
        return Verdict("undecided", "one side is an equation and the other an expression")
    _, value = isolated
    if equation is expected:
        return _compare_expressions(value, answer, clock, rounding=rounding)
    return _compare_expressions(expected, value, clock, rounding=rounding)


def _compare_expressions(expected, answer, clock, *, rounding):
    x, y = expected.expr, answer.expr
    if x == y:
        return EQUIVALENT
    if _infinite(x) or _infinite(y):
        sx, sy = _simplified(x, clock), _simplified(y, clock)
        if sx is None or sy is None:
            return Verdict("undecided", "an infinite value could not be simplified")
        return EQUIVALENT if sx == sy else DIFFERENT
    if not x.free_symbols and not y.free_symbols:
        return _compare_numbers(expected, answer, clock, rounding=rounding)
    parts = _without_integration_constant(x, y)
    if parts is not None:
        return _differ_by_a_constant(*parts, clock)
    if _simplified(x - y, clock) == 0:
        return EQUIVALENT
    agreeing = 0
    for vx, vy in _samples([x, y], clock):
        if not _close(vx, vy):
            return DIFFERENT
        agreeing += 1
        if agreeing >= SAMPLES_NEEDED:
            return _undecided_sampling()
    return _undecided_sampling()


def _infinite(expr):
    return expr.has(sympy.oo, sympy.zoo, sympy.nan) or expr.has(-sympy.oo)


def _compare_numbers(expected, answer, clock, *, rounding):
    x, y = expected.expr, answer.expr
    difference = _simplified(x - y, clock)
    if difference is None:
        difference = x - y
    if difference == 0:
        return EQUIVALENT
    if rounding:
        for side in (answer, expected):
            if side.decimal is not None and _significant_figures(side.decimal) >= 3:
                # Subtract exactly before comparing: converting either side to a
                # machine float can erase an error larger than the last-digit unit.
                error = abs(difference) - _half_unit(side.decimal)
                if error.is_nonpositive is True:
                    return EQUIVALENT
    if difference.is_zero is False:
        return DIFFERENT
    value = _value(difference, {})
    if value is not None and not _close(value, 0, 1e-12):
        return DIFFERENT
    return Verdict("undecided", "the numeric difference could not be established")


def _significant_figures(decimal):
    return len(decimal.lstrip("+-").replace(".", "").lstrip("0"))


def _half_unit(decimal):
    return Rational(1, 2 * 10 ** len(decimal.split(".")[1]))


_C = Symbol("C")


def _without_integration_constant(x, y):
    """Both sides less their `+ C`, when each has one as a term of its own."""
    if _C not in x.free_symbols:
        return None
    fx, cx = x.as_independent(_C, as_Add=True)
    fy, cy = y.as_independent(_C, as_Add=True)

    def constant_term(term):
        ratio = term / _C
        return ratio.is_number and ratio != 0

    if constant_term(cx) and constant_term(cy):
        return fx, fy
    return None


def _differ_by_a_constant(fx, fy, clock):
    difference = fx - fy
    if not difference.free_symbols:
        return EQUIVALENT
    simplified = _simplified(difference, clock)
    if simplified is not None and not simplified.free_symbols:
        return EQUIVALENT
    first, agreeing = None, 0
    for (value,) in _samples([difference], clock):
        if first is None:
            first = value
        elif not _close(value, first):
            return DIFFERENT
        agreeing += 1
        if agreeing >= SAMPLES_NEEDED:
            return _undecided_sampling()
    return _undecided_sampling()


def _compare_equations(expected, answer, clock):
    """Equal when one's `lhs - rhs` is a non-zero constant times the other's."""
    d1 = expected.lhs.expr - expected.rhs.expr
    d2 = answer.lhs.expr - answer.rhs.expr
    s1, s2 = _simplified(d1, clock), _simplified(d2, clock)
    if s1 is not None:
        d1 = s1
    if s2 is not None:
        d2 = s2
    if d1 == 0 and d2 == 0:
        return EQUIVALENT
    if d1 == 0 or d2 == 0:
        if d1.is_zero is False or d2.is_zero is False:
            return DIFFERENT
    else:
        ratio = _simplified(d1 / d2, clock)
        if ratio is not None and ratio.is_number and ratio.is_zero is False and ratio.is_finite is True:
            return EQUIVALENT
    first, agreeing = None, 0
    for v1, v2 in _samples([d1, d2], clock):
        holds1, holds2 = _close(v1, 0), _close(v2, 0)
        if holds1 != holds2:
            return DIFFERENT
        if not holds1:
            value = v1 / v2
            if first is None:
                first = value
            elif not _close(value, first):
                return DIFFERENT
        agreeing += 1
        if agreeing >= SAMPLES_NEEDED:
            return _undecided_sampling()
    return _undecided_sampling()


def main():
    try:
        request = json.load(sys.stdin)
        expected, answer = request["expected"], request.get("answer")
        if not isinstance(expected, str) or not isinstance(answer, (str, type(None))):
            raise TypeError("expected and answer must be strings")
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        print(f'mathcheck: wants {{"expected": text, "answer": text}} on standard input ({error})', file=sys.stderr)
        return 2
    json.dump(check(expected, answer), sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
