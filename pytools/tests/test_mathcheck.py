"""The symbolic check on pairs worked by hand (decisions.md, "Symbolic check")."""

import json
import math
import subprocess
import sys
import time
from decimal import Decimal
from fractions import Fraction
from pathlib import Path

import pytest

from mathcheck import check

SCRIPT = Path(__file__).parents[1] / "mathcheck.py"


def verdict(expected, answer, **limits):
    return check(expected, answer, **limits)["result"]


@pytest.mark.parametrize(
    ("expected", "answer"),
    [
        # expanded and factored
        ("x^2 - 1", "(x-1)(x+1)"),
        ("(x+1)^2", "x^2 + 2x + 1"),
        # \frac{a}{b} and a/b
        (r"\frac{x+1}{2}", "(x+1)/2"),
        # implicit multiplication; a letter before a parenthesis multiplies
        ("10(2x+1)^4", r"5(2x+1)^4 \cdot 2"),
        ("x^2 + x", "x(x+1)"),
        (r"2x\sin x", "2*x*sin(x)"),
        # e^x and \exp(x)
        ("e^{2x}", r"\exp(2x)"),
        (r"\mathrm{e}^x", "exp(x)"),
        # trigonometric identities
        (r"\sin(2x)", r"2\sin x\cos x"),
        (r"\sec^2 x", r"1 + \tan^2 x"),
        # plain and LaTeX spellings
        (r"\sqrt{x}", "sqrt(x)"),
        ("x^2", "x**2"),
        (r"\ln x", "log(x)"),
        (r"\frac{\pi}{2}", "pi/2"),
        (r"(x+1)^2", r"\left(x+1\right)^2"),
        ("x^{-1}", "x^-1"),
        # decimals are exact
        (r"\frac{x^2}{2}", "0.5x^2"),
        # equal wherever both are defined
        (r"\frac{x^2-1}{x-1}", "x+1"),
        # a constant of integration
        (r"\sin^2 x + C", r"-\frac{1}{2}\cos(2x) + C"),
    ],
)
def test_equivalent_forms(expected, answer):
    assert check(expected, answer) == {"result": "equivalent"}


def test_an_unproven_real_domain_identity_is_left_to_the_grader():
    # This real-domain identity used to pass only because its sample values agreed.
    assert verdict(r"\ln(x^2)", r"2\ln|x|") == "undecided"


@pytest.mark.parametrize("constant", ["", " + C"])
def test_sample_agreement_does_not_hide_a_counterexample_outside_the_sample_range(constant):
    point = -5
    assert point + 4 == -1
    assert abs(point + 4) == 1
    assert verdict("x+4" + constant, "|x+4|" + constant) == "undecided"


@pytest.mark.parametrize("constant", ["", " + C"])
def test_sample_agreement_does_not_prove_an_aliased_trigonometric_identity(constant):
    point = Fraction(1, 1994)
    assert math.sin(997 * math.pi * point) == pytest.approx(1)
    assert verdict("0" + constant, r"\sin(997\pi x)" + constant) == "undecided"


@pytest.mark.parametrize(
    ("expected", "answer"),
    [
        ("x^2 - 1", "x^2 + 1"),  # a sign
        (r"-\sin x", r"\sin x"),
        ("10(2x+1)^4", "5(2x+1)^4"),  # the chain rule's missing factor
        (r"-6x\sin(3x^2)", r"-\sin(3x^2)"),
        ("2x", "x^2"),
        (r"\ln|x|", r"\ln x"),  # differ for negative x
        ("x", r"\sqrt{x^2}"),
        (r"\frac{x^3}{3} + C", r"\frac{x^3}{3}"),  # the constant left out
        ("Ce^x", "Ce^x + 1"),  # C multiplies: not a constant of integration
    ],
)
def test_near_misses(expected, answer):
    assert check(expected, answer) == {"result": "different"}


@pytest.mark.parametrize(
    ("expected", "answer", "result"),
    [
        ("y = 2x + 1", "2x - y + 1 = 0", "equivalent"),  # a factor of -1
        ("x + 2 = 0", "2x + 4 = 0", "equivalent"),
        ("y = 2x + 1", "y = 2x - 1", "different"),
        ("x = 2", "x^2 = 4", "different"),  # not a constant factor
        ("x = 2", "2", "equivalent"),  # the value of a lone variable
        ("2x", "y = 2x", "equivalent"),
        ("x^2 + y^2 = 1", "x^2 + y^2 - 1", "undecided"),
    ],
)
def test_equations(expected, answer, result):
    assert verdict(expected, answer) == result


@pytest.mark.parametrize("reverse", [False, True])
def test_equations_compare_residuals_without_large_sides_hiding_a_counterexample(reverse):
    point = 1
    assert 1000000000000 + point != 1000000000000
    pair = ("1000000000000+x=1000000000000", "0=0")
    assert verdict(*(pair[::-1] if reverse else pair)) == "different"


@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("equation", ["x=x+1", "x+1=x"])
def test_a_self_referential_equation_does_not_unwrap_to_its_other_side(reverse, equation):
    point = 0
    assert point + 1 == 1
    assert point != point + 1
    pair = ("x+1", equation)
    assert verdict(*(pair[::-1] if reverse else pair)) == "undecided"


@pytest.mark.parametrize(
    ("expected", "answer", "result"),
    [
        ("x=x", "0=0", "equivalent"),
        (r"\sin^2 x + \cos^2 x=1", "0=0", "equivalent"),
        ("0=0", "1=0", "different"),
        ("1=0", "0=0", "different"),
        ("1=0", "2=0", "equivalent"),
        (r"\sin(997\pi x)=0", "0=0", "undecided"),
    ],
)
def test_equation_zero_residuals_and_unproven_ratios(expected, answer, result):
    assert verdict(expected, answer) == result


@pytest.mark.parametrize(
    ("expected", "answer", "result"),
    [
        ("1, -2", "-2, 1", "equivalent"),
        (r"\{1, -2\}", "x = 1, x = -2", "equivalent"),
        (r"\frac{\pi}{2}, \frac{3\pi}{2}", "3pi/2, pi/2", "equivalent"),
        ("1, -2", "1, 2", "different"),
        ("1, -2", "1", "different"),
        ("1, -2", "1, -2, 3", "different"),
    ],
)
def test_lists_compare_as_sets(expected, answer, result):
    assert verdict(expected, answer) == result


@pytest.mark.parametrize(
    ("expected", "answer", "result"),
    [
        (r"\frac{1}{3}", "0.333", "equivalent"),  # three significant figures
        (r"\frac{1}{3}", "0.3333", "equivalent"),
        (r"\frac{1}{3}", "0.33", "different"),  # two
        (r"\frac{1}{3}", "0.334", "different"),  # rounded wrongly
        (r"\pi", "3.14", "equivalent"),
        (r"\pi", "3.15", "different"),
        ("3.14", r"\pi", "equivalent"),  # an expected decimal: the answer rounds to it
        (r"\sqrt{2}", "1.41", "equivalent"),
        ("2.5", r"\frac{5}{2}", "equivalent"),
        (r"\frac{\sqrt{2}}{2}", r"\frac{1}{\sqrt{2}}", "equivalent"),
        ("2^{2000}", "2^{2000} + 1", "different"),  # exact; floating point cannot even hold them
        (r"\infty", r"\infty", "equivalent"),
        (r"\infty", r"-\infty", "different"),
        # The half-unit boundary is exact, with no floating-point padding.
        ("1 + 1/2000", "1.000", "equivalent"),
        ("1 - 1/2000", "1.000", "equivalent"),
        ("1 + 1/2000 + 1/10^{30}", "1.000", "different"),
        ("1 - 1/2000 - 1/10^{30}", "1.000", "different"),
    ],
)
def test_numbers(expected, answer, result):
    assert verdict(expected, answer) == result


@pytest.mark.parametrize("reverse", [False, True])
def test_large_exact_irrational_values_do_not_gain_a_relative_tolerance(reverse):
    assert (10000000000001 - 10000000000000) * math.pi > 3
    pair = ("10000000000000*pi", "10000000000001*pi")
    assert verdict(*(pair[::-1] if reverse else pair)) == "different"


@pytest.mark.parametrize("reverse", [False, True])
def test_large_decimals_keep_the_exact_difference_and_last_digit_tolerance(reverse):
    pair = ("10000000000000000", "10000000000000001.000")
    difference = abs(Decimal(pair[0]) - Decimal(pair[1]))
    assert difference == 1
    assert difference > Decimal("0.0005")
    assert verdict(*(pair[::-1] if reverse else pair)) == "different"


@pytest.mark.parametrize(
    ("expected", "answer", "side"),
    [
        ("x", "x +", "answer"),
        (r"\frac{1}{", "x", "expected"),
        ("x", r"\foo x", "answer"),  # an unknown command, not f*o*o*x
        ("x/2", "1/2x", "answer"),  # x/2 or 1/(2x)
        ("2x", r"\frac{dy}{dx}", "answer"),  # d would be a variable
        ("x", "(1, 2)", "answer"),
        ("x", "x = y = 1", "answer"),
        (r"\int x\,dx", "x", "expected"),
    ],
)
def test_unparsable_sides(expected, answer, side):
    result = check(expected, answer)
    assert result["result"] == "unparsable"
    assert result["side"] == side
    assert result["reason"]


def test_input_meant_to_run_code_is_unparsable_and_not_run(tmp_path):
    marker = tmp_path / "ran"
    for code in ["__import__('os').getcwd()", f"__import__('os').mkdir('{marker}')"]:
        assert check("x", code)["side"] == "answer"
        assert check(code, "x")["side"] == "expected"
        assert check(code)["result"] == "unparsable"
    assert not marker.exists()


@pytest.mark.parametrize(
    ("expected", "answer", "result"),
    [
        (r"\sin^2 x + \cos^2 x", "1", "undecided"),
        (r"\sin(2x)", r"2\sin x\cos x", "undecided"),
        (r"\sin^2 x - \cos^2 x", "1", "different"),
        ("10(2x+1)^4", "5(2x+1)^4", "different"),
        (r"\sin^2 x + C", r"-\frac{1}{2}\cos(2x) + C", "undecided"),
        ("x+2=0", "2x+4=0", "undecided"),
    ],
)
def test_samples_can_disprove_but_cannot_certify_without_simplification(expected, answer, result):
    assert verdict(expected, answer, simplify_seconds=0) == result


def test_a_slow_simplification_gives_way_to_sample_points():
    slow = r"\frac{(e^x + \sin x)^{12}}{(1 + \tan x)^6} - \ln(1 + x^2)^3"  # ~3 s to simplify
    start = time.monotonic()
    assert verdict(slow, "0", simplify_seconds=0.3) == "different"
    assert time.monotonic() - start < 2


def test_a_check_out_of_time_is_undecided():
    result = check(r"\sin^2 x + \cos^2 x", "1", seconds=0)
    assert result["result"] == "undecided"
    assert result["reason"]


def run_script(request):
    # The venv's own Python, isolated: how the engine runs it in its sandbox.
    return subprocess.run(
        [sys.executable, "-I", str(SCRIPT)], input=request, capture_output=True, text=True, timeout=30
    )


def test_the_script_reads_a_request_and_writes_the_result():
    run = run_script(json.dumps({"expected": r"\frac{1}{2}", "answer": "0.5"}))
    assert run.returncode == 0
    assert json.loads(run.stdout) == {"result": "equivalent"}


def test_without_an_answer_the_script_reads_only_the_expected_side():
    assert json.loads(run_script(json.dumps({"expected": "3x^2"})).stdout) == {"result": "parsed"}
    refused = json.loads(run_script(json.dumps({"expected": r"\frac{1}{"})).stdout)
    assert (refused["result"], refused["side"]) == ("unparsable", "expected")


def test_a_number_too_large_to_check_is_refused_at_once():
    # Exact arithmetic on it would run past any time limit, in C, where no alarm stops it.
    run = run_script(json.dumps({"expected": "x", "answer": "10^{10^{10}}"}))
    assert json.loads(run.stdout)["result"] == "unparsable"


@pytest.mark.parametrize("request_text", ["not json", '{"answer": "x"}', '{"expected": 3}'])
def test_a_request_out_of_shape_is_an_error(request_text):
    run = run_script(request_text)
    assert run.returncode == 2
    assert run.stdout == ""
    assert run.stderr
